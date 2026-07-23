from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from skill_hub.config import get_skill_hub_settings
from skill_hub.models import Base

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_skill_hub_database() -> None:
    global _engine, _session_factory
    if _engine is not None:
        return
    settings = get_skill_hub_settings()
    backend = make_url(settings.database_url).get_backend_name()
    if backend not in {"sqlite", "mysql"}:
        raise RuntimeError("Skill Hub supports only SQLite and MySQL")
    connect_args = {"timeout": 30} if backend == "sqlite" else {}
    _engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    if backend == "sqlite":
        @event.listens_for(_engine.sync_engine, "connect")
        def _configure_sqlite(connection, _) -> None:
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys = ON")
                cursor.execute("PRAGMA journal_mode = WAL")
            finally:
                cursor.close()
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def create_skill_hub_tables() -> None:
    if _engine is None:
        raise RuntimeError("Skill Hub database is not initialized")
    async with _engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def close_skill_hub_database() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_skill_hub_session() -> AsyncIterator[AsyncSession]:
    if _session_factory is None:
        raise RuntimeError("Skill Hub database is not initialized")
    async with _session_factory() as session:
        yield session


def skill_hub_session_factory() -> async_sessionmaker[AsyncSession]:
    if _session_factory is None:
        raise RuntimeError("Skill Hub database is not initialized")
    return _session_factory
