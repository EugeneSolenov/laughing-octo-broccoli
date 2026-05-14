from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, Float, ForeignKey, String, Table, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserRole(str, enum.Enum):
    guest = "guest"
    user = "user"
    admin = "admin"


class TweetStatus(str, enum.Enum):
    processing = "processing"
    completed = "completed"
    error = "error"


class NotificationType(str, enum.Enum):
    follow = "follow"
    like = "like"
    repost = "repost"
    reply = "reply"
    transcription_ready = "transcription_ready"


class ReportStatus(str, enum.Enum):
    open = "open"
    resolved = "resolved"


follows = Table(
    "follows",
    Base.metadata,
    Column("follower_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("followed_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    UniqueConstraint("follower_id", "followed_id", name="uq_follow_pair"),
)

tweet_likes = Table(
    "tweet_likes",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("tweet_id", ForeignKey("voice_tweets.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    UniqueConstraint("user_id", "tweet_id", name="uq_tweet_like_pair"),
)

tweet_reposts = Table(
    "tweet_reposts",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("tweet_id", ForeignKey("voice_tweets.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    UniqueConstraint("user_id", "tweet_id", name="uq_tweet_repost_pair"),
)

user_blocks = Table(
    "user_blocks",
    Base.metadata,
    Column("blocker_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("blocked_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    UniqueConstraint("blocker_id", "blocked_id", name="uq_user_block_pair"),
)

user_mutes = Table(
    "user_mutes",
    Base.metadata,
    Column("muter_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("muted_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    UniqueConstraint("muter_id", "muted_id", name="uq_user_mute_pair"),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(30), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    bio: Mapped[str | None] = mapped_column(String(160), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    discoverable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False),
        default=UserRole.user,
        nullable=False,
    )
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    tweets: Mapped[list["VoiceTweet"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
        foreign_keys="VoiceTweet.user_id",
    )
    following: Mapped[list["User"]] = relationship(
        "User",
        secondary=follows,
        primaryjoin=id == follows.c.follower_id,
        secondaryjoin=id == follows.c.followed_id,
        back_populates="followers",
    )
    followers: Mapped[list["User"]] = relationship(
        "User",
        secondary=follows,
        primaryjoin=id == follows.c.followed_id,
        secondaryjoin=id == follows.c.follower_id,
        back_populates="following",
    )
    blocked_users: Mapped[list["User"]] = relationship(
        "User",
        secondary=user_blocks,
        primaryjoin=id == user_blocks.c.blocker_id,
        secondaryjoin=id == user_blocks.c.blocked_id,
        back_populates="blocked_by_users",
    )
    blocked_by_users: Mapped[list["User"]] = relationship(
        "User",
        secondary=user_blocks,
        primaryjoin=id == user_blocks.c.blocked_id,
        secondaryjoin=id == user_blocks.c.blocker_id,
        back_populates="blocked_users",
    )
    muted_users: Mapped[list["User"]] = relationship(
        "User",
        secondary=user_mutes,
        primaryjoin=id == user_mutes.c.muter_id,
        secondaryjoin=id == user_mutes.c.muted_id,
        back_populates="muted_by_users",
    )
    muted_by_users: Mapped[list["User"]] = relationship(
        "User",
        secondary=user_mutes,
        primaryjoin=id == user_mutes.c.muted_id,
        secondaryjoin=id == user_mutes.c.muter_id,
        back_populates="muted_users",
    )
    liked_tweets: Mapped[list["VoiceTweet"]] = relationship(
        "VoiceTweet",
        secondary=tweet_likes,
        back_populates="liked_by",
    )
    reposted_tweets: Mapped[list["VoiceTweet"]] = relationship(
        "VoiceTweet",
        secondary=tweet_reposts,
        back_populates="reposted_by",
    )
    received_notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        foreign_keys="Notification.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    sent_notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        foreign_keys="Notification.actor_id",
        back_populates="actor",
    )
    sessions: Mapped[list["AuthSession"]] = relationship(
        "AuthSession",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    filed_reports: Mapped[list["Report"]] = relationship(
        "Report",
        foreign_keys="Report.reporter_id",
        back_populates="reporter",
        cascade="all, delete-orphan",
    )
    reports_against: Mapped[list["Report"]] = relationship(
        "Report",
        foreign_keys="Report.target_user_id",
        back_populates="target_user",
    )


class VoiceTweet(Base):
    __tablename__ = "voice_tweets"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_tweet_id: Mapped[int | None] = mapped_column(
        ForeignKey("voice_tweets.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    audio_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    transcription_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    edited_transcription_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[TweetStatus] = mapped_column(
        Enum(TweetStatus, native_enum=False),
        default=TweetStatus.processing,
        nullable=False,
        index=True,
    )
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship(back_populates="tweets", foreign_keys=[user_id])
    parent: Mapped["VoiceTweet | None"] = relationship(
        "VoiceTweet",
        remote_side="VoiceTweet.id",
        back_populates="replies",
        foreign_keys=[parent_tweet_id],
    )
    replies: Mapped[list["VoiceTweet"]] = relationship(
        "VoiceTweet",
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="VoiceTweet.created_at.asc()",
    )
    liked_by: Mapped[list[User]] = relationship(
        "User",
        secondary=tweet_likes,
        back_populates="liked_tweets",
    )
    reposted_by: Mapped[list[User]] = relationship(
        "User",
        secondary=tweet_reposts,
        back_populates="reposted_tweets",
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        back_populates="tweet",
        cascade="all, delete-orphan",
    )
    reports: Mapped[list["Report"]] = relationship(
        "Report",
        back_populates="tweet",
        cascade="all, delete-orphan",
    )


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    tweet_id: Mapped[int | None] = mapped_column(
        ForeignKey("voice_tweets.id", ondelete="CASCADE"), nullable=True, index=True
    )
    type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, native_enum=False),
        nullable=False,
        index=True,
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship(
        "User",
        foreign_keys=[user_id],
        back_populates="received_notifications",
    )
    actor: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[actor_id],
        back_populates="sent_notifications",
    )
    tweet: Mapped[VoiceTweet | None] = relationship(
        "VoiceTweet",
        back_populates="notifications",
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship("User", back_populates="sessions")


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tweet_id: Mapped[int | None] = mapped_column(
        ForeignKey("voice_tweets.id", ondelete="CASCADE"), nullable=True, index=True
    )
    reason: Mapped[str] = mapped_column(String(100), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, native_enum=False),
        default=ReportStatus.open,
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    reporter: Mapped[User] = relationship(
        "User",
        foreign_keys=[reporter_id],
        back_populates="filed_reports",
    )
    target_user: Mapped[User | None] = relationship(
        "User",
        foreign_keys=[target_user_id],
        back_populates="reports_against",
    )
    tweet: Mapped[VoiceTweet | None] = relationship("VoiceTweet", back_populates="reports")
