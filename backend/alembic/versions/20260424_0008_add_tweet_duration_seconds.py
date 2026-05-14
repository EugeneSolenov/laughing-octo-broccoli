"""add tweet duration seconds

Revision ID: 20260424_0008
Revises: 20260424_0007
Create Date: 2026-04-24 15:05:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260424_0008"
down_revision = "20260424_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("voice_tweets", sa.Column("duration_seconds", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("voice_tweets", "duration_seconds")
