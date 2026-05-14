"""text comments and dislike-ready tweet schema

Revision ID: 20260423_0006
Revises: 20260404_0005
Create Date: 2026-04-23 20:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260423_0006"
down_revision = "20260404_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("voice_tweets", "audio_url", existing_type=sa.String(length=512), nullable=True)
    op.alter_column("voice_tweets", "mime_type", existing_type=sa.String(length=100), nullable=True)
    op.alter_column("voice_tweets", "caption", existing_type=sa.String(length=280), type_=sa.String(length=500), nullable=True)


def downgrade() -> None:
    op.alter_column("voice_tweets", "caption", existing_type=sa.String(length=500), type_=sa.String(length=280), nullable=True)
    op.alter_column("voice_tweets", "mime_type", existing_type=sa.String(length=100), nullable=False)
    op.alter_column("voice_tweets", "audio_url", existing_type=sa.String(length=512), nullable=False)
