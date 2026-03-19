"""In-memory SSE event bus for pushing real-time events to connected clients."""
import asyncio
import json
from typing import AsyncGenerator
from collections import defaultdict

# project_id -> list of asyncio.Queue
_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


def subscribe(project_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers[project_id].append(q)
    return q


def unsubscribe(project_id: str, q: asyncio.Queue) -> None:
    try:
        _subscribers[project_id].remove(q)
    except ValueError:
        pass


async def publish(project_id: str, event_type: str, payload: dict) -> None:
    """Publish an event to all subscribers of a project."""
    message = json.dumps({"type": event_type, "payload": payload})
    dead = []
    for q in _subscribers.get(project_id, []):
        try:
            q.put_nowait(message)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        unsubscribe(project_id, q)


async def event_stream(project_id: str) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted messages for a project."""
    q = subscribe(project_id)
    try:
        while True:
            try:
                message = await asyncio.wait_for(q.get(), timeout=30.0)
                yield f"data: {message}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        unsubscribe(project_id, q)
