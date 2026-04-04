from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import redis
import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

PUBLIC_EVENTS_CHANNEL = "voice_x:events:public"
_SYNC_CLIENT: redis.Redis | None = None


def user_events_channel(user_id: int) -> str:
    return f"voice_x:events:user:{user_id}"


def _sync_client() -> redis.Redis:
    global _SYNC_CLIENT
    if _SYNC_CLIENT is None:
        _SYNC_CLIENT = redis.Redis.from_url(settings.redis_url)
    return _SYNC_CLIENT


def _build_event_payload(event_type: str, **payload) -> str:
    return json.dumps(
        {
            "type": event_type,
            "timestamp": datetime.now(UTC).isoformat(),
            **payload,
        },
        default=str,
    )


def _publish(channel: str, event_type: str, **payload) -> None:
    try:
        _sync_client().publish(channel, _build_event_payload(event_type, **payload))
    except Exception:
        logger.exception("Failed to publish realtime event", extra={"channel": channel, "event_type": event_type})


def publish_public_event(event_type: str, **payload) -> None:
    _publish(PUBLIC_EVENTS_CHANNEL, event_type, **payload)


def publish_user_event(user_id: int, event_type: str, **payload) -> None:
    _publish(user_events_channel(user_id), event_type, **payload)


async def open_event_pubsub(*channels: str) -> tuple[aioredis.Redis, aioredis.client.PubSub]:
    client = aioredis.Redis.from_url(settings.redis_url)
    pubsub = client.pubsub()
    await pubsub.subscribe(*channels)
    return client, pubsub
