"""query and list performance indexes

Revision ID: 20260404_0004
Revises: 20260404_0003
Create Date: 2026-04-04 22:40:00
"""

from __future__ import annotations

from alembic import op

revision = "20260404_0004"
down_revision = "20260404_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_voice_tweets_user_created_at",
        "voice_tweets",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_users_discoverable_created_at",
        "users",
        ["discoverable", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_user_created_at",
        "notifications",
        ["user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_reports_status_created_at",
        "reports",
        ["status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_reports_status_created_at", table_name="reports")
    op.drop_index("ix_notifications_user_created_at", table_name="notifications")
    op.drop_index("ix_users_discoverable_created_at", table_name="users")
    op.drop_index("ix_voice_tweets_user_created_at", table_name="voice_tweets")
