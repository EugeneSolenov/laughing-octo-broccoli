from __future__ import annotations

import logging
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from sqlalchemy import and_, delete, func, insert, or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth import AuthenticatedUser, OptionalUser
from app.config import settings
from app.database import get_db
from app.events import publish_public_event, publish_user_event
from app.media import MediaProcessingError, probe_audio_duration, trim_audio_clip
from app.models import NotificationType, TweetStatus, User, UserRole, VoiceTweet, follows, tweet_likes, tweet_reposts
from app.rate_limit import limiter
from app.schemas import FeedCursor, FeedResponse, PostDetailResponse, TweetUpdateRequest, VoiceTweetRead
from app.serializers import serialize_feed, serialize_tweet
from app.social import (
    build_tweet_render_context,
    create_notification,
    get_blocked_user_ids,
    get_muted_user_ids,
)
from app.storage import storage
from app.transcription import queue_transcription

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_AUDIO_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/ogg": ".ogg",
    "application/ogg": ".ogg",
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
}

EXTENSION_TO_AUDIO_TYPE = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".webm": "audio/webm",
    ".wav": "audio/wav",
}


def _sniff_audio_type(audio: UploadFile) -> str | None:
    current_position = audio.file.tell()
    try:
        header = audio.file.read(16)
        if header.startswith(b"OggS"):
            return "audio/ogg"
        if header.startswith(b"\x1a\x45\xdf\xa3"):
            return "audio/webm"
        if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
            return "audio/wav"
        if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0):
            return "audio/mpeg"
        if len(header) >= 12 and header[4:8] == b"ftyp":
            return "audio/mp4"
        return None
    finally:
        audio.file.seek(current_position)


def _resolve_audio_type(audio: UploadFile) -> tuple[str, str]:
    content_type = (audio.content_type or "").lower()
    if content_type in ALLOWED_AUDIO_TYPES:
        return content_type, ALLOWED_AUDIO_TYPES[content_type]

    filename_extension = Path(audio.filename or "").suffix.lower()
    if filename_extension in EXTENSION_TO_AUDIO_TYPE:
        resolved_content_type = EXTENSION_TO_AUDIO_TYPE[filename_extension]
        return resolved_content_type, ALLOWED_AUDIO_TYPES[resolved_content_type]

    sniffed_content_type = _sniff_audio_type(audio)
    if sniffed_content_type in ALLOWED_AUDIO_TYPES:
        return sniffed_content_type, ALLOWED_AUDIO_TYPES[sniffed_content_type]

    raise HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail="Only MP3, M4A, OGG, WebM, and WAV audio uploads are supported.",
    )


def _persist_upload(
    audio: UploadFile,
    *,
    user_id: int,
    trim_start_seconds: float | None = None,
    trim_end_seconds: float | None = None,
) -> tuple[str, str, float]:
    resolved_content_type, extension = _resolve_audio_type(audio)
    filename = f"{uuid4().hex}{extension}"
    bytes_written = 0

    with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as temporary_file:
        temp_path = Path(temporary_file.name)

    try:
        with temp_path.open("wb") as buffer:
            while chunk := audio.file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > settings.max_upload_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Audio uploads are limited to 10 MB.",
                    )
                buffer.write(chunk)

        trimmed_path = trim_audio_clip(temp_path, start_seconds=trim_start_seconds, end_seconds=trim_end_seconds)
        duration_seconds = probe_audio_duration(trimmed_path)
        if duration_seconds > settings.max_audio_seconds:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Audio duration must be {settings.max_audio_seconds} seconds or less.",
            )

        stored_reference = storage.save_file(
            trimmed_path,
            user_id=user_id,
            filename=filename,
            content_type=resolved_content_type,
        )
        return stored_reference, resolved_content_type, duration_seconds
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _apply_feed_search(db: Session, statement, search_query: str | None):
    if not search_query or not search_query.strip():
        return statement

    normalized_query = search_query.strip()
    transcription_document = func.coalesce(VoiceTweet.caption, "") + " " + func.coalesce(VoiceTweet.transcription_text, "")
    if db.bind and db.bind.dialect.name == "postgresql":
        tsquery = func.websearch_to_tsquery("simple", normalized_query)
        return statement.where(
            or_(
                func.to_tsvector("simple", transcription_document).op("@@")(tsquery),
                User.username.ilike(f"%{normalized_query}%"),
                VoiceTweet.caption.ilike(f"%{normalized_query}%"),
                VoiceTweet.transcription_text.ilike(f"%{normalized_query}%"),
            )
        )

    return statement.where(
        or_(
            User.username.ilike(f"%{normalized_query}%"),
            VoiceTweet.caption.ilike(f"%{normalized_query}%"),
            VoiceTweet.transcription_text.ilike(f"%{normalized_query}%"),
        )
    )


def _serialize_tweets(db: Session, tweets: list[VoiceTweet], viewer: User | None) -> list[VoiceTweetRead]:
    context = build_tweet_render_context(
        db,
        tweet_ids=[tweet.id for tweet in tweets],
        author_ids=[tweet.user_id for tweet in tweets],
        viewer_id=viewer.id if viewer else None,
    )
    return [serialize_tweet(tweet, context=context) for tweet in tweets]


def _load_tweet_or_404(db: Session, tweet_id: int) -> VoiceTweet:
    tweet = db.scalar(
        select(VoiceTweet)
        .options(selectinload(VoiceTweet.user), selectinload(VoiceTweet.parent).selectinload(VoiceTweet.user))
        .where(VoiceTweet.id == tweet_id)
    )
    if tweet is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tweet not found.")
    return tweet


def _assert_viewer_can_access_tweet(db: Session, *, tweet: VoiceTweet, viewer: User | None) -> None:
    if viewer is None:
        return
    blocked_ids = get_blocked_user_ids(db, viewer.id)
    if tweet.user_id in blocked_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tweet not found.")


def _create_tweet_and_enqueue(
    *,
    db: Session,
    current_user: User,
    audio: UploadFile | None,
    caption: str | None,
    parent_tweet_id: int | None,
    trim_start_seconds: float | None,
    trim_end_seconds: float | None,
) -> VoiceTweet:
    normalized_caption = caption.strip() if caption and caption.strip() else None
    audio_url: str | None = None
    resolved_content_type: str | None = None
    duration_seconds: float | None = None

    parent_tweet = None
    if parent_tweet_id is not None:
        parent_tweet = _load_tweet_or_404(db, parent_tweet_id)
        _assert_viewer_can_access_tweet(db, tweet=parent_tweet, viewer=current_user)
        if parent_tweet.parent_tweet_id is not None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Replies to comments are disabled.")

    if audio is not None:
        try:
            audio_url, resolved_content_type, duration_seconds = _persist_upload(
                audio,
                user_id=current_user.id,
                trim_start_seconds=trim_start_seconds,
                trim_end_seconds=trim_end_seconds,
            )
        except MediaProcessingError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    elif parent_tweet_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Audio is required for a new post.")
    elif not normalized_caption:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Comment text is required.")

    tweet = VoiceTweet(
        user_id=current_user.id,
        parent_tweet_id=parent_tweet_id,
        audio_url=audio_url,
        duration_seconds=duration_seconds,
        caption=normalized_caption,
        mime_type=resolved_content_type,
        status=TweetStatus.processing if audio_url else TweetStatus.completed,
    )
    db.add(tweet)
    db.commit()
    db.refresh(tweet)

    if audio_url:
        try:
            queue_transcription(tweet.id)
        except Exception:
            logger.exception("Failed to enqueue transcription task", extra={"tweet_id": tweet.id})
            tweet.status = TweetStatus.error
            tweet.error_message = "Failed to enqueue transcription task."
            db.add(tweet)
            db.commit()
            db.refresh(tweet)

    if parent_tweet is None:
        publish_public_event("tweet.created", tweet_id=tweet.id, user_id=current_user.id)
        return tweet

    if parent_tweet.user_id != current_user.id and parent_tweet.user.notifications_enabled:
        notification = create_notification(
            db,
            user_id=parent_tweet.user_id,
            notification_type=NotificationType.reply,
            actor_id=current_user.id,
            tweet_id=parent_tweet.id,
        )
        db.commit()
        if notification:
            publish_user_event(
                parent_tweet.user_id,
                "notification.created",
                notification_id=notification.id,
                notification_type=notification.type.value,
                tweet_id=parent_tweet.id,
            )
    publish_public_event("tweet.reply_created", tweet_id=parent_tweet.id, reply_id=tweet.id, user_id=current_user.id)
    publish_public_event("tweet.created", tweet_id=tweet.id, user_id=current_user.id)
    return tweet


def _tweet_context_for_single(db: Session, *, tweet: VoiceTweet, viewer: User | None):
    return build_tweet_render_context(
        db,
        tweet_ids=[tweet.id],
        author_ids=[tweet.user_id],
        viewer_id=viewer.id if viewer else None,
    )


@router.get("/tweets/feed", response_model=FeedResponse)
def get_feed(
    limit: int = Query(default=25, ge=1, le=100),
    cursor_created_at: datetime | None = Query(default=None),
    cursor_id: int | None = Query(default=None, ge=1),
    q: str | None = Query(default=None, min_length=1, max_length=120),
    scope: str = Query(default="all", pattern="^(all|following)$"),
    viewer: OptionalUser = None,
    db: Session = Depends(get_db),
) -> FeedResponse:
    if (cursor_created_at is None) ^ (cursor_id is None):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Cursor must include both created_at and id.")

    statement = (
        select(VoiceTweet)
        .join(VoiceTweet.user)
        .options(selectinload(VoiceTweet.user))
        .where(VoiceTweet.parent_tweet_id.is_(None))
        .order_by(VoiceTweet.created_at.desc(), VoiceTweet.id.desc())
    )

    if viewer is not None:
        blocked_ids = get_blocked_user_ids(db, viewer.id)
        muted_ids = get_muted_user_ids(db, viewer.id)
        excluded_ids = blocked_ids | muted_ids
        if excluded_ids:
            statement = statement.where(VoiceTweet.user_id.not_in(excluded_ids))

    if scope == "following":
        if viewer is None:
            return serialize_feed([], None)
        followed_users = select(follows.c.followed_id).where(follows.c.follower_id == viewer.id)
        statement = statement.where(
            or_(
                VoiceTweet.user_id == viewer.id,
                VoiceTweet.user_id.in_(followed_users),
            )
        )

    if cursor_created_at and cursor_id:
        statement = statement.where(
            or_(
                VoiceTweet.created_at < cursor_created_at,
                and_(VoiceTweet.created_at == cursor_created_at, VoiceTweet.id < cursor_id),
            )
        )

    statement = _apply_feed_search(db, statement, q)
    tweets = db.scalars(statement.limit(limit + 1)).all()
    next_cursor = None

    if len(tweets) > limit:
        tweets = tweets[:limit]
        last_visible = tweets[-1]
        next_cursor = FeedCursor(created_at=last_visible.created_at, id=last_visible.id)

    return serialize_feed(_serialize_tweets(db, tweets, viewer), next_cursor)


@router.get("/tweets/{tweet_id}", response_model=PostDetailResponse)
def get_tweet_detail(tweet_id: int, viewer: OptionalUser = None, db: Session = Depends(get_db)) -> PostDetailResponse:
    tweet = _load_tweet_or_404(db, tweet_id)
    _assert_viewer_can_access_tweet(db, tweet=tweet, viewer=viewer)

    replies_statement = (
        select(VoiceTweet)
        .options(selectinload(VoiceTweet.user))
        .where(VoiceTweet.parent_tweet_id == tweet.id)
        .order_by(VoiceTweet.created_at.asc(), VoiceTweet.id.asc())
    )
    if viewer is not None:
        blocked_ids = get_blocked_user_ids(db, viewer.id)
        muted_ids = get_muted_user_ids(db, viewer.id)
        excluded_ids = blocked_ids | muted_ids
        if excluded_ids:
            replies_statement = replies_statement.where(VoiceTweet.user_id.not_in(excluded_ids))

    replies = db.scalars(replies_statement).all()
    all_tweets = [tweet, *replies]
    if tweet.parent is not None:
        all_tweets.append(tweet.parent)
    context = build_tweet_render_context(
        db,
        tweet_ids=[item.id for item in all_tweets],
        author_ids=[item.user_id for item in all_tweets],
        viewer_id=viewer.id if viewer else None,
    )
    return PostDetailResponse(
        tweet=serialize_tweet(tweet, context=context),
        parent=serialize_tweet(tweet.parent, context=context) if tweet.parent else None,
        replies=[serialize_tweet(reply, context=context) for reply in replies],
    )


@router.post("/tweets/create", response_model=VoiceTweetRead, status_code=status.HTTP_202_ACCEPTED)
@router.post("/tweets/upload", response_model=VoiceTweetRead, status_code=status.HTTP_202_ACCEPTED, include_in_schema=False)
@limiter.limit(settings.tweet_create_rate_limit)
def create_tweet(
    request: Request,
    response: Response,
    current_user: AuthenticatedUser,
    audio: UploadFile = File(...),
    caption: str | None = Form(default=None),
    parent_tweet_id: int | None = Form(default=None),
    trim_start_seconds: float | None = Form(default=None),
    trim_end_seconds: float | None = Form(default=None),
    db: Session = Depends(get_db),
) -> VoiceTweetRead:
    tweet = _create_tweet_and_enqueue(
        db=db,
        current_user=current_user,
        audio=audio,
        caption=caption,
        parent_tweet_id=parent_tweet_id,
        trim_start_seconds=trim_start_seconds,
        trim_end_seconds=trim_end_seconds,
    )
    created_tweet = _load_tweet_or_404(db, tweet.id)
    return serialize_tweet(created_tweet, context=_tweet_context_for_single(db, tweet=created_tweet, viewer=current_user))


@router.post("/tweets/{tweet_id}/reply", response_model=VoiceTweetRead, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit(settings.tweet_create_rate_limit)
def reply_to_tweet(
    request: Request,
    response: Response,
    tweet_id: int,
    current_user: AuthenticatedUser,
    audio: UploadFile | None = File(default=None),
    caption: str | None = Form(default=None),
    trim_start_seconds: float | None = Form(default=None),
    trim_end_seconds: float | None = Form(default=None),
    db: Session = Depends(get_db),
) -> VoiceTweetRead:
    reply = _create_tweet_and_enqueue(
        db=db,
        current_user=current_user,
        audio=audio,
        caption=caption,
        parent_tweet_id=tweet_id,
        trim_start_seconds=trim_start_seconds,
        trim_end_seconds=trim_end_seconds,
    )
    created_reply = _load_tweet_or_404(db, reply.id)
    return serialize_tweet(created_reply, context=_tweet_context_for_single(db, tweet=created_reply, viewer=current_user))


@router.patch("/tweets/{tweet_id}", response_model=VoiceTweetRead)
def update_tweet(
    tweet_id: int,
    payload: TweetUpdateRequest,
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> VoiceTweetRead:
    tweet = _load_tweet_or_404(db, tweet_id)
    is_owner = tweet.user_id == current_user.id
    is_admin = current_user.role == UserRole.admin
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit your own tweets.")

    if payload.caption is not None:
        tweet.caption = payload.caption.strip() if payload.caption and payload.caption.strip() else None
    if payload.transcription_text is not None:
        tweet.transcription_text = payload.transcription_text.strip() if payload.transcription_text and payload.transcription_text.strip() else None
        tweet.edited_transcription_at = datetime.now(UTC)
        tweet.status = TweetStatus.completed
        tweet.error_message = None
    db.add(tweet)
    db.commit()
    db.refresh(tweet)
    publish_public_event("tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value, user_id=tweet.user_id)
    return serialize_tweet(tweet, context=_tweet_context_for_single(db, tweet=tweet, viewer=current_user))


@router.post("/tweets/{tweet_id}/rerun-transcription", response_model=VoiceTweetRead)
def rerun_transcription(tweet_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> VoiceTweetRead:
    tweet = _load_tweet_or_404(db, tweet_id)
    is_owner = tweet.user_id == current_user.id
    is_admin = current_user.role == UserRole.admin
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only retry your own tweets.")

    tweet.status = TweetStatus.processing
    tweet.error_message = None
    tweet.transcription_text = None
    tweet.edited_transcription_at = None
    db.add(tweet)
    db.commit()
    queue_transcription(tweet.id)
    publish_public_event("tweet.transcription_updated", tweet_id=tweet.id, status=tweet.status.value, user_id=tweet.user_id)
    return serialize_tweet(tweet, context=_tweet_context_for_single(db, tweet=tweet, viewer=current_user))


@router.delete("/tweets/{tweet_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(settings.tweet_delete_rate_limit)
def delete_tweet(
    request: Request,
    response: Response,
    tweet_id: int,
    current_user: AuthenticatedUser,
    db: Session = Depends(get_db),
) -> None:
    tweet = _load_tweet_or_404(db, tweet_id)

    is_owner = tweet.user_id == current_user.id
    is_admin = current_user.role == UserRole.admin
    if not is_owner and not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only delete your own tweets.")

    audio_reference = tweet.audio_url
    db.delete(tweet)
    db.commit()

    storage.delete(audio_reference)
    publish_public_event("tweet.deleted", tweet_id=tweet_id, user_id=current_user.id)


@router.post("/tweets/{tweet_id}/like", response_model=VoiceTweetRead)
def like_tweet(tweet_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> VoiceTweetRead:
    tweet = _load_tweet_or_404(db, tweet_id)
    _assert_viewer_can_access_tweet(db, tweet=tweet, viewer=current_user)
    db.execute(
        delete(tweet_reposts).where(
            tweet_reposts.c.user_id == current_user.id,
            tweet_reposts.c.tweet_id == tweet_id,
        )
    )
    already_liked = db.scalar(
        select(tweet_likes.c.tweet_id).where(
            tweet_likes.c.user_id == current_user.id,
            tweet_likes.c.tweet_id == tweet_id,
        )
    )
    if already_liked is None:
        db.execute(insert(tweet_likes).values(user_id=current_user.id, tweet_id=tweet_id))
        notification = None
        if tweet.user.notifications_enabled:
            notification = create_notification(
                db,
                user_id=tweet.user_id,
                notification_type=NotificationType.like,
                actor_id=current_user.id,
                tweet_id=tweet_id,
            )
        db.commit()
        if notification:
            publish_user_event(
                tweet.user_id,
                "notification.created",
                notification_id=notification.id,
                notification_type=notification.type.value,
                tweet_id=tweet_id,
            )
    context = _tweet_context_for_single(db, tweet=tweet, viewer=current_user)
    publish_public_event("tweet.engagement_updated", tweet_id=tweet_id, user_id=current_user.id)
    return serialize_tweet(tweet, context=context)


@router.delete("/tweets/{tweet_id}/like", response_model=VoiceTweetRead)
def unlike_tweet(tweet_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> VoiceTweetRead:
    tweet = _load_tweet_or_404(db, tweet_id)
    db.execute(
        delete(tweet_likes).where(
            tweet_likes.c.user_id == current_user.id,
            tweet_likes.c.tweet_id == tweet_id,
        )
    )
    db.commit()
    context = _tweet_context_for_single(db, tweet=tweet, viewer=current_user)
    publish_public_event("tweet.engagement_updated", tweet_id=tweet_id, user_id=current_user.id)
    return serialize_tweet(tweet, context=context)


@router.post("/tweets/{tweet_id}/dislike", response_model=VoiceTweetRead)
@router.post("/tweets/{tweet_id}/repost", response_model=VoiceTweetRead, include_in_schema=False)
def dislike_tweet(tweet_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> VoiceTweetRead:
    tweet = _load_tweet_or_404(db, tweet_id)
    _assert_viewer_can_access_tweet(db, tweet=tweet, viewer=current_user)
    db.execute(
        delete(tweet_likes).where(
            tweet_likes.c.user_id == current_user.id,
            tweet_likes.c.tweet_id == tweet_id,
        )
    )
    already_reposted = db.scalar(
        select(tweet_reposts.c.tweet_id).where(
            tweet_reposts.c.user_id == current_user.id,
            tweet_reposts.c.tweet_id == tweet_id,
        )
    )
    if already_reposted is None:
        db.execute(insert(tweet_reposts).values(user_id=current_user.id, tweet_id=tweet_id))
        db.commit()
    context = _tweet_context_for_single(db, tweet=tweet, viewer=current_user)
    publish_public_event("tweet.engagement_updated", tweet_id=tweet_id, user_id=current_user.id)
    return serialize_tweet(tweet, context=context)


@router.delete("/tweets/{tweet_id}/dislike", response_model=VoiceTweetRead)
@router.delete("/tweets/{tweet_id}/repost", response_model=VoiceTweetRead, include_in_schema=False)
def undislike_tweet(tweet_id: int, current_user: AuthenticatedUser, db: Session = Depends(get_db)) -> VoiceTweetRead:
    tweet = _load_tweet_or_404(db, tweet_id)
    db.execute(
        delete(tweet_reposts).where(
            tweet_reposts.c.user_id == current_user.id,
            tweet_reposts.c.tweet_id == tweet_id,
        )
    )
    db.commit()
    context = _tweet_context_for_single(db, tweet=tweet, viewer=current_user)
    publish_public_event("tweet.engagement_updated", tweet_id=tweet_id, user_id=current_user.id)
    return serialize_tweet(tweet, context=context)
