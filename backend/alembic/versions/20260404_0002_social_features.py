"""social features and notifications

Revision ID: 20260404_0002
Revises: 20260404_0001
Create Date: 2026-04-04 17:30:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260404_0002"
down_revision = "20260404_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.String(length=160), nullable=True))
    op.add_column("users", sa.Column("avatar_url", sa.String(length=512), nullable=True))

    op.create_table(
        "tweet_likes",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tweet_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tweet_id"], ["voice_tweets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "tweet_id"),
        sa.UniqueConstraint("user_id", "tweet_id", name="uq_tweet_like_pair"),
    )
    op.create_index("ix_tweet_likes_tweet_id", "tweet_likes", ["tweet_id"], unique=False)

    op.create_table(
        "tweet_reposts",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("tweet_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tweet_id"], ["voice_tweets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "tweet_id"),
        sa.UniqueConstraint("user_id", "tweet_id", name="uq_tweet_repost_pair"),
    )
    op.create_index("ix_tweet_reposts_tweet_id", "tweet_reposts", ["tweet_id"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("tweet_id", sa.Integer(), nullable=True),
        sa.Column(
            "type",
            sa.Enum(
                "follow",
                "like",
                "repost",
                "transcription_ready",
                name="notificationtype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tweet_id"], ["voice_tweets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notifications_id"), "notifications", ["id"], unique=False)
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"], unique=False)
    op.create_index(op.f("ix_notifications_actor_id"), "notifications", ["actor_id"], unique=False)
    op.create_index(op.f("ix_notifications_tweet_id"), "notifications", ["tweet_id"], unique=False)
    op.create_index(op.f("ix_notifications_type"), "notifications", ["type"], unique=False)
    op.create_index(op.f("ix_notifications_is_read"), "notifications", ["is_read"], unique=False)

    op.create_index("ix_voice_tweets_created_at", "voice_tweets", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_voice_tweets_created_at", table_name="voice_tweets")

    op.drop_index(op.f("ix_notifications_is_read"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_type"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_tweet_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_actor_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_user_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_id"), table_name="notifications")
    op.drop_table("notifications")

    op.drop_index("ix_tweet_reposts_tweet_id", table_name="tweet_reposts")
    op.drop_table("tweet_reposts")

    op.drop_index("ix_tweet_likes_tweet_id", table_name="tweet_likes")
    op.drop_table("tweet_likes")

    op.drop_column("users", "avatar_url")
    op.drop_column("users", "bio")
