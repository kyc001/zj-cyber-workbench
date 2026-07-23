from __future__ import annotations

import asyncio
import logging
import time

from skill_hub.config import get_skill_hub_settings

logger = logging.getLogger(__name__)

_redis_client = None
_memory_lock = asyncio.Lock()
_memory_windows: dict[str, tuple[float, int]] = {}


async def start_redis_runtime() -> None:
    global _redis_client
    redis_url = get_skill_hub_settings().redis_url
    if not redis_url:
        return
    try:
        from redis.asyncio import Redis

        client = Redis.from_url(
            redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
        await client.ping()
        _redis_client = client
        logger.info("Skill Hub Redis runtime connected")
    except Exception:
        _redis_client = None
        logger.warning("Skill Hub Redis unavailable; using process-local rate limits", exc_info=True)


async def stop_redis_runtime() -> None:
    global _redis_client
    client, _redis_client = _redis_client, None
    if client is not None:
        await client.aclose()


async def consume_rate_limit(key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
    if _redis_client is not None:
        try:
            redis_key = f"zj-skill-hub:rate:{key}"
            async with _redis_client.pipeline(transaction=True) as pipeline:
                pipeline.incr(redis_key)
                pipeline.ttl(redis_key)
                count, ttl = await pipeline.execute()
            if count == 1 or ttl < 0:
                await _redis_client.expire(redis_key, window_seconds)
                ttl = window_seconds
            return count <= limit, max(int(ttl), 1)
        except Exception:
            logger.warning("Redis rate limit failed; falling back to process-local limit", exc_info=True)
    return await _consume_memory_rate_limit(key, limit=limit, window_seconds=window_seconds)


async def _consume_memory_rate_limit(
    key: str,
    *,
    limit: int,
    window_seconds: int,
) -> tuple[bool, int]:
    now = time.monotonic()
    async with _memory_lock:
        expires_at, count = _memory_windows.get(key, (now + window_seconds, 0))
        if expires_at <= now:
            expires_at, count = now + window_seconds, 0
        count += 1
        _memory_windows[key] = (expires_at, count)
        if len(_memory_windows) > 10_000:
            for stale_key, (expiry, _) in list(_memory_windows.items()):
                if expiry <= now:
                    _memory_windows.pop(stale_key, None)
        return count <= limit, max(int(expires_at - now), 1)


def reset_memory_rate_limits() -> None:
    _memory_windows.clear()
