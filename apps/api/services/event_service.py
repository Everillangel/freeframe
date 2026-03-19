"""Redis-backed SSE event bus for cross-process real-time events."""
import asyncio
import json
from typing import AsyncGenerator
import redis.asyncio as aioredis
from ..config import settings


def _get_redis():
    return aioredis.from_url(settings.redis_url, decode_responses=True)


async def publish(project_id: str, event_type: str, payload: dict) -> None:
    """Publish an event to a Redis channel for the project."""
    r = _get_redis()
    try:
        message = json.dumps({"type": event_type, "payload": payload})
        await r.publish(f"project:{project_id}", message)
    finally:
        await r.aclose()


async def event_stream(project_id: str) -> AsyncGenerator[str, None]:
    """Subscribe to a Redis channel and yield SSE messages."""
    r = _get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(f"project:{project_id}")
    try:
        while True:
            try:
                message = await asyncio.wait_for(pubsub.get_message(ignore_subscribe_messages=True), timeout=30.0)
                if message and message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                else:
                    yield ": keepalive\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        await pubsub.unsubscribe(f"project:{project_id}")
        await r.aclose()
