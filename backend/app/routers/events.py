from __future__ import annotations

import json
from contextlib import suppress
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.auth import OptionalUser
from app.events import PUBLIC_EVENTS_CHANNEL, open_event_pubsub, user_events_channel

router = APIRouter()


def _format_sse(event_type: str, payload: dict[str, object]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(payload, default=str)}\n\n"


@router.get("/events/stream")
async def stream_events(request: Request, current_user: OptionalUser = None) -> StreamingResponse:
    channels = [PUBLIC_EVENTS_CHANNEL]
    if current_user is not None:
        channels.append(user_events_channel(current_user.id))

    async def event_stream():
        client, pubsub = await open_event_pubsub(*channels)
        try:
            yield _format_sse("ready", {"timestamp": datetime.now(UTC).isoformat()})
            while True:
                if await request.is_disconnected():
                    break

                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
                if message is None:
                    yield _format_sse("heartbeat", {"timestamp": datetime.now(UTC).isoformat()})
                    continue

                raw_payload = message.get("data")
                if isinstance(raw_payload, bytes):
                    raw_payload = raw_payload.decode("utf-8", errors="ignore")
                try:
                    payload = json.loads(raw_payload)
                except (TypeError, json.JSONDecodeError):
                    continue

                event_type = str(payload.get("type", "message"))
                yield _format_sse(event_type, payload)
        finally:
            with suppress(Exception):
                await pubsub.unsubscribe(*channels)
            with suppress(Exception):
                await pubsub.close()
            with suppress(Exception):
                await client.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
