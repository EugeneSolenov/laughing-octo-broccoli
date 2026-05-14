from __future__ import annotations

from app.models import AuthSession, Notification, NotificationType, Report, User, VoiceTweet
from app.schemas import (
    AuthSessionRead,
    FeedCursor,
    FeedResponse,
    NotificationRead,
    ProfileResponse,
    PublicProfileResponse,
    ReportRead,
    UserProfileRead,
    UserPublic,
    UserRead,
    VoiceTweetRead,
)
from app.social import TweetRenderContext
from app.storage import storage


def serialize_user_public(user: User, *, is_following: bool = False) -> UserPublic:
    return UserPublic(
        id=user.id,
        username=user.username,
        bio=user.bio,
        avatar_url=user.avatar_url,
        role=user.role,
        is_following=is_following,
    )


def serialize_user_profile(
    user: User,
    *,
    is_following: bool = False,
    is_muted: bool = False,
    is_self: bool = False,
) -> UserProfileRead:
    return UserProfileRead(
        id=user.id,
        username=user.username,
        bio=user.bio,
        avatar_url=user.avatar_url,
        role=user.role,
        is_following=is_following,
        is_muted=is_muted,
        is_self=is_self,
        created_at=user.created_at,
    )


def serialize_user(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        bio=user.bio,
        avatar_url=user.avatar_url,
        email_verified=user.email_verified,
        notifications_enabled=user.notifications_enabled,
        email_notifications_enabled=user.email_notifications_enabled,
        discoverable=user.discoverable,
        role=user.role,
        is_banned=user.is_banned,
        created_at=user.created_at,
    )


def serialize_tweet(tweet: VoiceTweet, *, context: TweetRenderContext | None = None) -> VoiceTweetRead:
    context = context or TweetRenderContext()

    return VoiceTweetRead(
        id=tweet.id,
        audio_url=storage.resolve_public_url(tweet.audio_url or ""),
        duration_seconds=tweet.duration_seconds,
        caption=tweet.caption,
        transcription_text=tweet.transcription_text,
        status=tweet.status,
        mime_type=tweet.mime_type,
        error_message=tweet.error_message,
        likes_count=context.like_counts.get(tweet.id, 0),
        dislikes_count=context.repost_counts.get(tweet.id, 0),
        reposts_count=context.repost_counts.get(tweet.id, 0),
        reply_count=context.reply_counts.get(tweet.id, 0),
        liked_by_viewer=tweet.id in context.liked_tweet_ids,
        disliked_by_viewer=tweet.id in context.reposted_tweet_ids,
        reposted_by_viewer=tweet.id in context.reposted_tweet_ids,
        created_at=tweet.created_at,
        parent_tweet_id=tweet.parent_tweet_id,
        user=serialize_user_public(
            tweet.user,
            is_following=tweet.user.id in context.followed_user_ids,
        ),
    )


def serialize_feed(items: list[VoiceTweetRead], next_cursor: FeedCursor | None) -> FeedResponse:
    return FeedResponse(items=items, next_cursor=next_cursor)


def serialize_profile(
    user: User,
    tweets: list[VoiceTweetRead],
    follower_count: int,
    following_count: int,
    *,
    blocked_count: int = 0,
    muted_count: int = 0,
) -> ProfileResponse:
    return ProfileResponse(
        user=serialize_user(user),
        tweets=tweets,
        follower_count=follower_count,
        following_count=following_count,
        blocked_count=blocked_count,
        muted_count=muted_count,
    )


def serialize_public_profile(
    user: User,
    tweets: list[VoiceTweetRead],
    follower_count: int,
    following_count: int,
    *,
    is_following: bool = False,
    is_muted: bool = False,
    is_self: bool = False,
) -> PublicProfileResponse:
    return PublicProfileResponse(
        user=serialize_user_profile(
            user,
            is_following=is_following,
            is_muted=is_muted,
            is_self=is_self,
        ),
        tweets=tweets,
        follower_count=follower_count,
        following_count=following_count,
    )


def _notification_message(notification: Notification) -> str:
    actor_name = notification.actor.username if notification.actor else "Кто-то"

    if notification.type == NotificationType.follow:
        return f"{actor_name} подписался(ась) на вас."
    if notification.type == NotificationType.like:
        return f"{actor_name} оценил(а) вашу запись."
    if notification.type == NotificationType.repost:
        return f"{actor_name} поделился(ась) вашей записью."
    if notification.type == NotificationType.reply:
        return f"{actor_name} ответил(а) на вашу запись."
    if notification.type == NotificationType.transcription_ready:
        return "Транскрипция вашей записи готова."
    return "У вас новое уведомление."


def _notification_path(notification: Notification) -> str | None:
    if notification.tweet_id:
        return f"/post/{notification.tweet_id}"
    if notification.actor_id:
        return f"/profile/{notification.actor_id}"
    return None


def _truncate_notification_preview(value: str, limit: int = 140) -> str:
    compact = " ".join(value.strip().split())
    if len(compact) <= limit:
        return compact

    trimmed = compact[: limit + 1].rsplit(" ", 1)[0] or compact[:limit]
    return f"{trimmed.rstrip('.,;:!?- ')}..."


def _notification_preview(notification: Notification) -> str | None:
    if notification.tweet is None:
        return None

    preview_source = (
        notification.tweet.caption or notification.tweet.transcription_text or notification.tweet.error_message
    )
    if not preview_source:
        return None
    return _truncate_notification_preview(preview_source)


def serialize_notification(notification: Notification) -> NotificationRead:
    return NotificationRead(
        id=notification.id,
        type=notification.type,
        is_read=notification.is_read,
        created_at=notification.created_at,
        message=_notification_message(notification),
        actor=serialize_user_public(notification.actor) if notification.actor else None,
        tweet_id=notification.tweet_id,
        tweet_preview=_notification_preview(notification),
        path=_notification_path(notification),
    )


def serialize_session(session: AuthSession, *, current: bool = False) -> AuthSessionRead:
    return AuthSessionRead(
        id=session.id,
        user_agent=session.user_agent,
        ip_address=session.ip_address,
        created_at=session.created_at,
        last_seen_at=session.last_seen_at,
        revoked_at=session.revoked_at,
        current=current,
    )


def serialize_report(report: Report, *, tweet_context: TweetRenderContext | None = None) -> ReportRead:
    return ReportRead(
        id=report.id,
        reason=report.reason,
        details=report.details,
        status=report.status,
        created_at=report.created_at,
        reporter=serialize_user_public(report.reporter),
        target_user=serialize_user_public(report.target_user) if report.target_user else None,
        tweet=serialize_tweet(report.tweet, context=tweet_context) if report.tweet else None,
    )
