"""product quality and social expansion

Revision ID: 20260404_0003
Revises: 20260404_0002
Create Date: 2026-04-04 21:10:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260404_0003"
down_revision = "20260404_0002"
branch_labels = None
depends_on = None


OLD_NOTIFICATION_TYPE = sa.Enum(
    "follow",
    "like",
    "repost",
    "transcription_ready",
    name="notificationtype",
    native_enum=False,
)

NEW_NOTIFICATION_TYPE = sa.Enum(
    "follow",
    "like",
    "repost",
    "reply",
    "transcription_ready",
    name="notificationtype",
    native_enum=False,
)

REPORT_STATUS = sa.Enum(
    "open",
    "resolved",
    name="reportstatus",
    native_enum=False,
)


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column(
        "users", sa.Column("email_notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column("users", sa.Column("discoverable", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index("ix_users_created_at", "users", ["created_at"], unique=False)

    op.add_column("voice_tweets", sa.Column("parent_tweet_id", sa.Integer(), nullable=True))
    op.add_column("voice_tweets", sa.Column("caption", sa.String(length=280), nullable=True))
    op.add_column("voice_tweets", sa.Column("edited_transcription_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_voice_tweets_parent_tweet_id_voice_tweets",
        "voice_tweets",
        "voice_tweets",
        ["parent_tweet_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_voice_tweets_parent_tweet_id", "voice_tweets", ["parent_tweet_id"], unique=False)
    op.execute(
        "CREATE INDEX ix_voice_tweets_search_document "
        "ON voice_tweets USING gin ("
        "to_tsvector('simple', coalesce(caption, '') || ' ' || coalesce(transcription_text, ''))"
        ")"
    )

    op.alter_column(
        "notifications",
        "type",
        existing_type=OLD_NOTIFICATION_TYPE,
        type_=NEW_NOTIFICATION_TYPE,
        existing_nullable=False,
    )
    op.create_index(
        "ix_notifications_dedupe_lookup",
        "notifications",
        ["user_id", "type", "actor_id", "tweet_id", "is_read"],
        unique=False,
    )

    op.create_table(
        "user_blocks",
        sa.Column("blocker_id", sa.Integer(), nullable=False),
        sa.Column("blocked_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["blocked_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["blocker_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("blocker_id", "blocked_id"),
        sa.UniqueConstraint("blocker_id", "blocked_id", name="uq_user_block_pair"),
    )
    op.create_index("ix_user_blocks_blocked_id", "user_blocks", ["blocked_id"], unique=False)

    op.create_table(
        "user_mutes",
        sa.Column("muter_id", sa.Integer(), nullable=False),
        sa.Column("muted_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["muted_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["muter_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("muter_id", "muted_id"),
        sa.UniqueConstraint("muter_id", "muted_id", name="uq_user_mute_pair"),
    )
    op.create_index("ix_user_mutes_muted_id", "user_mutes", ["muted_id"], unique=False)

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"], unique=False)
    op.create_index("ix_auth_sessions_revoked_at", "auth_sessions", ["revoked_at"], unique=False)
    op.create_index("ix_auth_sessions_created_at", "auth_sessions", ["created_at"], unique=False)

    op.create_table(
        "reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reporter_id", sa.Integer(), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=True),
        sa.Column("tweet_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=100), nullable=False),
        sa.Column("details", sa.Text(), nullable=True),
        sa.Column("status", REPORT_STATUS, nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tweet_id"], ["voice_tweets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reports_id", "reports", ["id"], unique=False)
    op.create_index("ix_reports_reporter_id", "reports", ["reporter_id"], unique=False)
    op.create_index("ix_reports_target_user_id", "reports", ["target_user_id"], unique=False)
    op.create_index("ix_reports_tweet_id", "reports", ["tweet_id"], unique=False)
    op.create_index("ix_reports_status", "reports", ["status"], unique=False)
    op.create_index("ix_reports_created_at", "reports", ["created_at"], unique=False)

    op.alter_column("reports", "status", server_default=None)
    op.alter_column("users", "email_verified", server_default=None)
    op.alter_column("users", "notifications_enabled", server_default=None)
    op.alter_column("users", "email_notifications_enabled", server_default=None)
    op.alter_column("users", "discoverable", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_reports_created_at", table_name="reports")
    op.drop_index("ix_reports_status", table_name="reports")
    op.drop_index("ix_reports_tweet_id", table_name="reports")
    op.drop_index("ix_reports_target_user_id", table_name="reports")
    op.drop_index("ix_reports_reporter_id", table_name="reports")
    op.drop_index("ix_reports_id", table_name="reports")
    op.drop_table("reports")

    op.drop_index("ix_auth_sessions_created_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_revoked_at", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_id", table_name="auth_sessions")
    op.drop_table("auth_sessions")

    op.drop_index("ix_user_mutes_muted_id", table_name="user_mutes")
    op.drop_table("user_mutes")

    op.drop_index("ix_user_blocks_blocked_id", table_name="user_blocks")
    op.drop_table("user_blocks")

    op.drop_index("ix_notifications_dedupe_lookup", table_name="notifications")
    op.alter_column(
        "notifications",
        "type",
        existing_type=NEW_NOTIFICATION_TYPE,
        type_=OLD_NOTIFICATION_TYPE,
        existing_nullable=False,
    )

    op.execute("DROP INDEX IF EXISTS ix_voice_tweets_search_document")
    op.drop_index("ix_voice_tweets_parent_tweet_id", table_name="voice_tweets")
    op.drop_constraint("fk_voice_tweets_parent_tweet_id_voice_tweets", "voice_tweets", type_="foreignkey")
    op.drop_column("voice_tweets", "edited_transcription_at")
    op.drop_column("voice_tweets", "caption")
    op.drop_column("voice_tweets", "parent_tweet_id")

    op.drop_index("ix_users_created_at", table_name="users")
    op.drop_column("users", "discoverable")
    op.drop_column("users", "email_notifications_enabled")
    op.drop_column("users", "notifications_enabled")
    op.drop_column("users", "email_verified")
