"""remove overlapping likes and dislikes

Revision ID: 20260424_0007
Revises: 20260423_0006
Create Date: 2026-04-24 14:10:00
"""

from __future__ import annotations

from alembic import op

revision = "20260424_0007"
down_revision = "20260423_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM tweet_reposts
        WHERE EXISTS (
            SELECT 1
            FROM tweet_likes
            WHERE tweet_likes.user_id = tweet_reposts.user_id
              AND tweet_likes.tweet_id = tweet_reposts.tweet_id
        )
        """
    )


def downgrade() -> None:
    pass
