from __future__ import annotations

import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, func, insert, or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth import AdminUser, AuthenticatedUser, OptionalUser
from app.database import get_db
from app.events import publish_user_event
from app.models import NotificationType, Report, User, VoiceTweet, follows, user_blocks, user_mutes
from app.schemas import (
    BanUserRequest,
    FollowResponse,
    PublicProfileResponse,
    ProfileResponse,
    ProfileUpdateRequest,
    ReportCreateRequest,
    SettingsPreferencesRead,
    SettingsPreferencesUpdateRequest,
    UserRead,
    UserRelationResponse,
    UserSearchResponse,
)
from app.serializers import serialize_profile, serialize_public_profile, serialize_user, serialize_user_public, serialize_tweet
from app.social import build_tweet_render_context, create_notification, get_blocked_user_ids, get_muted_user_ids
from app.storage import storage

router = APIRouter()

IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_AVATAR_BYTES = 5 * 1024 * 1024


def _load_profile_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


def _profile_tweet_statement(user_id: int, q: str | None):
    statement = (
        select(VoiceTweet)
        .options(selectinload(VoiceTweet.user))
        .where(VoiceTweet.user_id == user_id)
        .order_by(VoiceTweet.created_at.desc(), VoiceTweet.id.desc())
    )
    if q and q.strip():
        normalized_query = q.strip()
        statement = statement.where(
            or_(
                VoiceTweet.caption.ilike(f"%{normalized_query}%"),
                VoiceTweet.transcription_text.ilike(f"%{normalized_query}%"),
                VoiceTweet.error_message.ilike(f"%{normalized_query}%"),
            )
        )
    return statement


def _load_profile_tweets(
    db: Session,
    *,
    user_id: int,
    q: str | None,
    limit: int,
    offset: int,
) -> list[VoiceTweet]:
    return db.scalars(_profile_tweet_statement(user_id, q).limit(limit).offset(offset)).all()


def _serialize_profile_tweets(db: Session, *, tweets: list[VoiceTweet], viewer_id: int | None):
    context = build_tweet_render_context(
        db,
        tweet_ids=[tweet.id for tweet in tweets],
        author_ids=[tweet.user_id for tweet in tweets],
        viewer_id=viewer_id,
    )
    return [serialize_tweet(tweet, context=context) for tweet in tweets]


def _following_state(db: Session, *, viewer_id: int, target_ids: set[int] | None = None) -> set[int]:
    statement = select(follows.c.followed_id).where(follows.c.follower_id == viewer_id)
    if target_ids:
        statement = statement.where(follows.c.followed_id.in_(target_ids))
    return set(db.scalars(statement).all())


def _profile_counts(db: Session, *, user_id: int) -> tuple[int, int, int, int]:
    follower_count = db.scalar(select(func.count()).select_from(follows).where(follows.c.followed_id == user_id)) or 0
    following_count = db.scalar(select(func.count()).select_from(follows).where(follows.c.follower_id == user_id)) or 0
    blocked_count = db.scalar(select(func.count()).select_from(user_blocks).where(user_blocks.c.blocker_id == user_id)) or 0
    muted_count = db.scalar(select(func.count()).select_from(user_mutes).where(user_mutes.c.muter_id == user_id)) or 0
    return follower_count, following_count, blocked_count, muted_count


def _serialize_profile_response(
    db: Session,
    *,
    user: User,
    viewer_id: int,
    q: str | None,
    limit: int,
    offset: int,
) -> ProfileResponse:
    tweets = _load_profile_tweets(db, user_id=user.id, q=q, limit=limit, offset=offset)
    serialized_tweets = _serialize_profile_tweets(db, tweets=tweets, viewer_id=viewer_id)
    follower_count, following_count, blocked_count, muted_count = _profile_counts(db, user_id=user.id)
    return serialize_profile(
        user=user,
        tweets=serialized_tweets,
        follower_count=follower_count,
        following_count=following_count,
        blocked_count=blocked_count,
        muted_count=muted_count,
    )


def _serialize_public_profile_response(
    db: Session,
    *,
    user: User,
    viewer: User | None,
    q: str | None,
    limit: int,
    offset: int,
) -> PublicProfileResponse:
    tweets = _load_profile_tweets(db, user_id=user.id, q=q, limit=limit, offset=offset)
    serialized_tweets = _serialize_profile_tweets(db, tweets=tweets, viewer_id=viewer.id if viewer else None)
    follower_count, following_count, _, _ = _profile_counts(db, user_id=user.id)
    following_ids = _following_state(db, viewer_id=viewer.id, target_ids={user.id}) if viewer else set()
    muted_ids = get_muted_user_ids(db, viewer.id) if viewer else set()
    return serialize_public_profile(
        user=user,
        tweets=serialized_tweets,
        follower_count=follower_count,
        following_count=following_count,
        is_following=user.id in following_ids,
        is_muted=user.id in muted_ids,
        is_self=viewer.id == user.id if viewer else False,
    )


def _persist_avatar_upload(file: UploadFile, user_id: int) -> str:
    content_type = (file.content_type or "").lower()
    if content_type not in IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG, WebP, and GIF avatars are supported.",
        )

    extension = IMAGE_TYPES[content_type]
    with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as temporary_file:
        temp_path = Path(temporary_file.name)

    bytes_written = 0
    try:
        with temp_path.open("wb") as buffer:
            while chunk := file.file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > MAX_AVATAR_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Avatar uploads are limited to 5 MB.")
                buffer.write(chunk)
        return storage.save_file(
            temp_path,
            user_id=user_id,
            filename=f"avatar-{uuid4().hex}{extension}",
            content_type=content_type,
        )
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _assert_no_block_relationship(db: Session, *, viewer_id: int, target_id: int) -> None:
    existing = db.execute(
        select(user_blocks.c.blocker_id).where(
            or_(
                (user_blocks.c.blocker_id == viewer_id) & (user_blocks.c.blocked_id == target_id),
                (user_blocks.c.blocker_id == target_id) & (user_blocks.c.blocked_id == viewer_id),
            )
        )
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This action is unavailable for blocked users.")


@router.get("/profile", response_model=ProfileResponse)
def get_profile(
    current_user: AuthenticatedUser,
    q: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    user = _load_profile_user(db, current_user.id)
    return _serialize_profile_response(db, user=user, viewer_id=current_user.id, q=q, limit=limit, offset=offset)


@router.patch("/profile", response_model=ProfileResponse)
def update_profile(
    payload: ProfileUpdateRequest,
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> ProfileResponse:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    user.bio = payload.bio.strip() if payload.bio and payload.bio.strip() else None
    user.avatar_url = payload.avatar_url.strip() if payload.avatar_url and payload.avatar_url.strip() else None
    db.add(user)
    db.commit()

    refreshed_user = _load_profile_user(db, current_user.id)
    return _serialize_profile_response(db, user=refreshed_user, viewer_id=current_user.id, q=None, limit=25, offset=0)


@router.post("/profile/avatar", response_model=ProfileResponse)
def upload_avatar(
    current_user: AuthenticatedUser,
    avatar: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    new_avatar_reference = _persist_avatar_upload(avatar, current_user.id)
    old_reference = user.avatar_url
    user.avatar_url = new_avatar_reference
    db.add(user)
    db.commit()
    if old_reference and (old_reference.startswith("/uploads/") or old_reference.startswith("s3://")):
        storage.delete(old_reference)

    refreshed_user = _load_profile_user(db, current_user.id)
    return _serialize_profile_response(db, user=refreshed_user, viewer_id=current_user.id, q=None, limit=25, offset=0)


@router.get("/settings/preferences", response_model=SettingsPreferencesRead)
def get_settings_preferences(current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> SettingsPreferencesRead:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return SettingsPreferencesRead(
        notifications_enabled=user.notifications_enabled,
        email_notifications_enabled=user.email_notifications_enabled,
        discoverable=user.discoverable,
    )


@router.patch("/settings/preferences", response_model=SettingsPreferencesRead)
def update_settings_preferences(
    payload: SettingsPreferencesUpdateRequest,
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> SettingsPreferencesRead:
    user = db.get(User, current_user.id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    if payload.notifications_enabled is not None:
        user.notifications_enabled = payload.notifications_enabled
    if payload.email_notifications_enabled is not None:
        user.email_notifications_enabled = payload.email_notifications_enabled
    if payload.discoverable is not None:
        user.discoverable = payload.discoverable
    db.add(user)
    db.commit()

    return SettingsPreferencesRead(
        notifications_enabled=user.notifications_enabled,
        email_notifications_enabled=user.email_notifications_enabled,
        discoverable=user.discoverable,
    )


@router.get("/users/search", response_model=UserSearchResponse)
def search_users(
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=8, ge=1, le=25),
    viewer: OptionalUser = None,
    db: Session = Depends(get_db),
) -> UserSearchResponse:
    blocked_ids = get_blocked_user_ids(db, viewer.id) if viewer else set()
    following_ids = set()
    statement = (
        select(User)
        .where(
            User.discoverable.is_(True),
            User.is_banned.is_(False),
            or_(User.username.ilike(f"%{q.strip()}%"), User.bio.ilike(f"%{q.strip()}%")),
        )
        .order_by(User.created_at.desc())
        .limit(limit)
    )
    if viewer:
        statement = statement.where(User.id != viewer.id)
    if blocked_ids:
        statement = statement.where(User.id.not_in(blocked_ids))

    users = db.scalars(statement).all()
    if viewer and users:
        following_ids = _following_state(db, viewer_id=viewer.id, target_ids={user.id for user in users})
    return UserSearchResponse(items=[serialize_user_public(user, is_following=user.id in following_ids) for user in users])


@router.get("/users/suggestions", response_model=UserSearchResponse)
def suggest_users(
    limit: int = Query(default=6, ge=1, le=20),
    viewer: OptionalUser = None,
    db: Session = Depends(get_db),
) -> UserSearchResponse:
    blocked_ids = get_blocked_user_ids(db, viewer.id) if viewer else set()
    followed_ids = _following_state(db, viewer_id=viewer.id) if viewer else set()

    activity_subquery = (
        select(
            User.id.label("user_id"),
            func.count(VoiceTweet.id).label("tweet_count"),
        )
        .outerjoin(VoiceTweet, VoiceTweet.user_id == User.id)
        .where(User.discoverable.is_(True), User.is_banned.is_(False))
        .group_by(User.id)
        .subquery()
    )

    statement = (
        select(User)
        .join(activity_subquery, activity_subquery.c.user_id == User.id)
        .where(User.discoverable.is_(True), User.is_banned.is_(False))
        .order_by(activity_subquery.c.tweet_count.desc(), User.created_at.desc())
        .limit(limit)
    )
    if viewer:
        excluded_ids = blocked_ids | followed_ids | {viewer.id}
        if excluded_ids:
            statement = statement.where(User.id.not_in(excluded_ids))

    users = db.scalars(statement).all()
    return UserSearchResponse(items=[serialize_user_public(user, is_following=user.id in followed_ids) for user in users])


@router.get("/users/{user_id}", response_model=PublicProfileResponse)
def get_public_profile(
    user_id: int,
    q: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    viewer: OptionalUser = None,
    db: Session = Depends(get_db),
) -> PublicProfileResponse:
    user = _load_profile_user(db, user_id)
    if user.is_banned:
        raise HTTPException(status_code=404, detail="User not found.")
    if viewer and user.id in get_blocked_user_ids(db, viewer.id):
        raise HTTPException(status_code=404, detail="User not found.")
    if not user.discoverable and (viewer is None or viewer.id != user.id):
        raise HTTPException(status_code=404, detail="User not found.")
    return _serialize_public_profile_response(db, user=user, viewer=viewer, q=q, limit=limit, offset=offset)


@router.post("/users/{user_id}/follow", response_model=FollowResponse)
def follow_user(user_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> FollowResponse:
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself.")

    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    _assert_no_block_relationship(db, viewer_id=current_user.id, target_id=user_id)

    already_following = db.scalar(
        select(follows.c.followed_id).where(
            follows.c.follower_id == current_user.id,
            follows.c.followed_id == user_id,
        )
    )
    if already_following is None:
        db.execute(insert(follows).values(follower_id=current_user.id, followed_id=user_id))
        notification = create_notification(
            db,
            user_id=user_id,
            notification_type=NotificationType.follow,
            actor_id=current_user.id,
        )
        db.commit()
        if notification and target_user.notifications_enabled:
            publish_user_event(
                user_id,
                "notification.created",
                notification_id=notification.id,
                notification_type=notification.type.value,
            )

    follower_count = db.scalar(select(func.count()).select_from(follows).where(follows.c.followed_id == user_id)) or 0
    return FollowResponse(user_id=user_id, is_following=True, follower_count=follower_count)


@router.delete("/users/{user_id}/follow", response_model=FollowResponse)
def unfollow_user(user_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> FollowResponse:
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot unfollow yourself.")

    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    db.execute(
        delete(follows).where(
            follows.c.follower_id == current_user.id,
            follows.c.followed_id == user_id,
        )
    )
    db.commit()

    follower_count = db.scalar(select(func.count()).select_from(follows).where(follows.c.followed_id == user_id)) or 0
    return FollowResponse(user_id=user_id, is_following=False, follower_count=follower_count)


@router.post("/users/{user_id}/block", response_model=UserRelationResponse)
def block_user(user_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> UserRelationResponse:
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot block yourself.")
    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    already_blocked = db.scalar(
        select(user_blocks.c.blocked_id).where(
            user_blocks.c.blocker_id == current_user.id,
            user_blocks.c.blocked_id == user_id,
        )
    )
    if already_blocked is None:
        db.execute(insert(user_blocks).values(blocker_id=current_user.id, blocked_id=user_id))
        db.execute(
            delete(follows).where(
                or_(
                    (follows.c.follower_id == current_user.id) & (follows.c.followed_id == user_id),
                    (follows.c.follower_id == user_id) & (follows.c.followed_id == current_user.id),
                )
            )
        )
        db.execute(
            delete(user_mutes).where(
                user_mutes.c.muter_id == current_user.id,
                user_mutes.c.muted_id == user_id,
            )
        )
        db.commit()
    return UserRelationResponse(user_id=user_id, active=True, detail="User blocked.")


@router.delete("/users/{user_id}/block", response_model=UserRelationResponse)
def unblock_user(user_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> UserRelationResponse:
    db.execute(
        delete(user_blocks).where(
            user_blocks.c.blocker_id == current_user.id,
            user_blocks.c.blocked_id == user_id,
        )
    )
    db.commit()
    return UserRelationResponse(user_id=user_id, active=False, detail="User unblocked.")


@router.post("/users/{user_id}/mute", response_model=UserRelationResponse)
def mute_user(user_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> UserRelationResponse:
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot mute yourself.")
    target_user = db.get(User, user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    _assert_no_block_relationship(db, viewer_id=current_user.id, target_id=user_id)

    already_muted = db.scalar(
        select(user_mutes.c.muted_id).where(
            user_mutes.c.muter_id == current_user.id,
            user_mutes.c.muted_id == user_id,
        )
    )
    if already_muted is None:
        db.execute(insert(user_mutes).values(muter_id=current_user.id, muted_id=user_id))
        db.commit()
    return UserRelationResponse(user_id=user_id, active=True, detail="User muted.")


@router.delete("/users/{user_id}/mute", response_model=UserRelationResponse)
def unmute_user(user_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> UserRelationResponse:
    db.execute(
        delete(user_mutes).where(
            user_mutes.c.muter_id == current_user.id,
            user_mutes.c.muted_id == user_id,
        )
    )
    db.commit()
    return UserRelationResponse(user_id=user_id, active=False, detail="User unmuted.")


@router.post("/reports", response_model=UserRelationResponse, status_code=status.HTTP_201_CREATED)
def create_report(payload: ReportCreateRequest, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> UserRelationResponse:
    if payload.tweet_id is None and payload.target_user_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A report must target a user or a post.")

    target_user_id = payload.target_user_id
    if payload.tweet_id is not None:
        tweet = db.scalar(select(VoiceTweet).options(selectinload(VoiceTweet.user)).where(VoiceTweet.id == payload.tweet_id))
        if tweet is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tweet not found.")
        target_user_id = target_user_id or tweet.user_id
    elif target_user_id is not None and db.get(User, target_user_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    report = Report(
        reporter_id=current_user.id,
        target_user_id=target_user_id,
        tweet_id=payload.tweet_id,
        reason=payload.reason.strip(),
        details=payload.details.strip() if payload.details and payload.details.strip() else None,
    )
    db.add(report)
    db.commit()
    return UserRelationResponse(user_id=target_user_id or 0, active=True, detail="Report submitted.")


@router.patch("/users/{user_id}/ban", response_model=UserRead)
def ban_user(
    user_id: int,
    payload: BanUserRequest,
    admin_user: AdminUser,
    db: Session = Depends(get_db),
) -> UserRead:
    if admin_user.id == user_id and payload.is_banned:
        raise HTTPException(status_code=400, detail="Admins cannot ban themselves.")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    user.is_banned = payload.is_banned
    db.add(user)
    db.commit()
    db.refresh(user)
    return serialize_user(user)
