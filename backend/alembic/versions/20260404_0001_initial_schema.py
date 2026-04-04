"""initial schema

Revision ID: 20260404_0001
Revises: None
Create Date: 2026-04-04 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260404_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=30), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("role", sa.Enum("guest", "user", "admin", name="userrole", native_enum=False), nullable=False),
        sa.Column("is_banned", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    op.create_table(
        "follows",
        sa.Column("follower_id", sa.Integer(), nullable=False),
        sa.Column("followed_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["followed_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["follower_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("follower_id", "followed_id"),
        sa.UniqueConstraint("follower_id", "followed_id", name="uq_follow_pair"),
    )

    op.create_table(
        "voice_tweets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("audio_url", sa.String(length=512), nullable=False),
        sa.Column("transcription_text", sa.Text(), nullable=True),
        sa.Column("status", sa.Enum("processing", "completed", "error", name="tweetstatus", native_enum=False), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_voice_tweets_id"), "voice_tweets", ["id"], unique=False)
    op.create_index(op.f("ix_voice_tweets_status"), "voice_tweets", ["status"], unique=False)
    op.create_index(op.f("ix_voice_tweets_user_id"), "voice_tweets", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_voice_tweets_user_id"), table_name="voice_tweets")
    op.drop_index(op.f("ix_voice_tweets_status"), table_name="voice_tweets")
    op.drop_index(op.f("ix_voice_tweets_id"), table_name="voice_tweets")
    op.drop_table("voice_tweets")
    op.drop_table("follows")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
