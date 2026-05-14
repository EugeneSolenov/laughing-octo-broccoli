"""feed search and thread performance indexes

Revision ID: 20260404_0005
Revises: 20260404_0004
Create Date: 2026-04-04 23:20:00
"""

from __future__ import annotations

from alembic import op


revision = "20260404_0005"
down_revision = "20260404_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name != "postgresql":
        return

    with op.get_context().autocommit_block():
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_voice_tweets_fts_simple
            ON voice_tweets
            USING gin (
              to_tsvector(
                'simple',
                coalesce(caption, '') || ' ' || coalesce(transcription_text, '')
              )
            )
            """
        )
        op.execute(
            """
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_voice_tweets_feed_cursor
            ON voice_tweets (created_at DESC, id DESC)
            WHERE parent_tweet_id IS NULL
            """
        )


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_voice_tweets_feed_cursor")
            op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_voice_tweets_fts_simple")
