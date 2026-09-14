"""FastAPI dependency: shared :class:`arq.connections.ArqRedis` pool.

The pool is constructed once per app on first call and stashed on
``app.state.arq`` so subsequent requests reuse it (ARQ's ``ArqRedis`` is a
:class:`redis.asyncio.Redis` subclass with a connection pool — opening a fresh
client per request would burn a TCP connect on the hot path).

The redis URL is resolved from ``SUITEST_REDIS_URL`` (the same env var the WS
gateway + rate limiter consume). Tests inject a fakeredis-backed
:class:`ArqRedis` via ``app.dependency_overrides[get_arq]`` so the create-run
test never opens a real broker.
"""

from __future__ import annotations

import os

from arq.connections import ArqRedis, RedisSettings, create_pool
from fastapi import Request


async def get_arq(request: Request) -> ArqRedis | None:
    """Return a shared :class:`ArqRedis` for ``app.state.arq``, building it on first hit."""
    from fastapi import HTTPException, status

    from suitest_api.settings import get_settings

    if get_settings().mode == "local":
        return None
    existing = getattr(request.app.state, "arq", None)
    if isinstance(existing, ArqRedis):
        return existing
    url = os.environ.get("SUITEST_REDIS_URL", "redis://localhost:6379/0")
    try:
        pool = await create_pool(RedisSettings.from_dsn(url))
        request.app.state.arq = pool
        return pool
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Redis queue unavailable in server mode: {exc}",
        ) from exc
