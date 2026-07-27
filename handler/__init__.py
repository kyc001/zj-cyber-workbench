"""Shared handler utilities."""

import asyncio
from typing import Any

from fastapi import WebSocket
from fastapi import status as ws_status

from logger import get_logger
from middleware.auth import AuthUser, local_desktop_user
from service.auth import (
    bearer_token_from_header,
    ensure_local_user_for_remote,
    remote_auth_enabled,
    resolve_remote_user,
)

logger = get_logger(__name__)


async def cancel_ws_task(task: asyncio.Task | None) -> None:
    """Cancel an asyncio task spawned by a WebSocket handler, draining any result."""
    if task is None:
        return
    if task.done():
        try:
            task.result()
        except (asyncio.CancelledError, Exception):
            pass
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def close_ws_silently(websocket: WebSocket, code: int = ws_status.WS_1011_INTERNAL_ERROR) -> None:
    """Best-effort WebSocket close that never raises."""
    try:
        await websocket.close(code=code)
    except Exception:
        pass


async def finish_ws_reader_task(task: asyncio.Task | None) -> None:
    """Wait briefly for a shell reader task to finish, then cancel if still running."""
    if task is None:
        return
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=1)
    except TimeoutError:
        await cancel_ws_task(task)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.debug("shell reader stopped with error", exc_info=True)


async def authenticate_local_websocket(websocket: WebSocket) -> AuthUser | None:
    """Resolve the single local desktop identity for a WebSocket."""
    if remote_auth_enabled():
        token = websocket.query_params.get("access_token", "")
        if not token:
            token = bearer_token_from_header(websocket.headers.get("authorization"))
        if not token:
            return None
        remote_user = await resolve_remote_user(token)
        current_user = await ensure_local_user_for_remote(remote_user)
        return AuthUser(
            id=current_user.id,
            role=current_user.role,
            email=current_user.email,
            username=current_user.username,
        )
    return await local_desktop_user()


def bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    """Clamp a value to [minimum, maximum], returning default on parse failure."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(number, maximum))
