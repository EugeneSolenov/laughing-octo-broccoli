from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Notification, NotificationType, follows, tweet_likes, tweet_reposts, user_blocks, user_mutes, VoiceTweet


@dataclass(slots=True)
class TweetRenderContext:
    like_counts: dict[int, int] = field(default_factory=dict)
    repost_counts: dict[int, int] = field(default_factory=dict)
    reply_counts: dict[int, int] = field(default_factory=dict)
    liked_tweet_ids: set[int] = field(default_factory=set)
    reposted_tweet_ids: set[int] = field(default_factory=set)
    followed_user_ids: set[int] = field(default_factory=set)


def build_tweet_render_context(
    db: Session,
    *,
    tweet_ids: Sequence[int],
    author_ids: Sequence[int],
    viewer_id: int | None,
) -> TweetRenderContext:
    if not tweet_ids:
        return TweetRenderContext()

    like_counts = dict(
        db.execute(
            select(tweet_likes.c.tweet_id, func.count())
            .where(tweet_likes.c.tweet_id.in_(tweet_ids))
            .group_by(tweet_likes.c.tweet_id)
        ).all()
    )
    repost_counts = dict(
        db.execute(
            select(tweet_reposts.c.tweet_id, func.count())
            .where(tweet_reposts.c.tweet_id.in_(tweet_ids))
            .group_by(tweet_reposts.c.tweet_id)
        ).all()
    )
    reply_counts = dict(
        db.execute(
            select(VoiceTweet.parent_tweet_id, func.count())
            .where(VoiceTweet.parent_tweet_id.in_(tweet_ids))
            .group_by(VoiceTweet.parent_tweet_id)
        ).all()
    )

    context = TweetRenderContext(
        like_counts=like_counts,
        repost_counts=repost_counts,
        reply_counts=reply_counts,
    )

    if viewer_id is None:
        return context

    context.liked_tweet_ids = set(
        db.scalars(
            select(tweet_likes.c.tweet_id).where(
                tweet_likes.c.user_id == viewer_id,
                tweet_likes.c.tweet_id.in_(tweet_ids),
            )
        ).all()
    )
    context.reposted_tweet_ids = set(
        db.scalars(
            select(tweet_reposts.c.tweet_id).where(
                tweet_reposts.c.user_id == viewer_id,
                tweet_reposts.c.tweet_id.in_(tweet_ids),
            )
        ).all()
    )
    if author_ids:
        context.followed_user_ids = set(
            db.scalars(
                select(follows.c.followed_id).where(
                    follows.c.follower_id == viewer_id,
                    follows.c.followed_id.in_(author_ids),
                )
            ).all()
        )

    return context


def get_blocked_user_ids(db: Session, viewer_id: int) -> set[int]:
    outgoing = db.scalars(select(user_blocks.c.blocked_id).where(user_blocks.c.blocker_id == viewer_id)).all()
    incoming = db.scalars(select(user_blocks.c.blocker_id).where(user_blocks.c.blocked_id == viewer_id)).all()
    return set(outgoing) | set(incoming)


def get_muted_user_ids(db: Session, viewer_id: int) -> set[int]:
    return set(db.scalars(select(user_mutes.c.muted_id).where(user_mutes.c.muter_id == viewer_id)).all())


def create_notification(
    db: Session,
    *,
    user_id: int,
    notification_type: NotificationType,
    actor_id: int | None = None,
    tweet_id: int | None = None,
) -> Notification | None:
    if actor_id is not None and actor_id == user_id:
        return None

    notification = db.scalar(
        select(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.type == notification_type,
            Notification.actor_id.is_(actor_id) if actor_id is None else Notification.actor_id == actor_id,
            Notification.tweet_id.is_(tweet_id) if tweet_id is None else Notification.tweet_id == tweet_id,
        )
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    if notification is not None:
        notification.is_read = False
        notification.created_at = datetime.now(UTC)
        db.add(notification)
        db.flush()
        return notification

    notification = Notification(
        user_id=user_id,
        actor_id=actor_id,
        tweet_id=tweet_id,
        type=notification_type,
        is_read=False,
    )
    db.add(notification)
    db.flush()
    return notification


def count_unread_notifications(db: Session, user_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.user_id == user_id, Notification.is_read.is_(False))
        )
        or 0
    )
