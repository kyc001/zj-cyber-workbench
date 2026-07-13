import os

from agents.extensions.memory import SQLAlchemySession
from sqlalchemy import event, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from config import WORKSPACE, get_config
from logger import get_logger
from model.agent.context_compactions import AgentContextCompaction
from model.agent.event_log import AgentEventLog
from model.agent.message_meta import AgentMessageMeta
from model.agent.notifications import AgentNotification
from model.agent.sessions import AgentSessionMeta
from model.agent.subordinates import AgentSubordinateTask
from model.system_user.users import SystemUser
from model.work_project.assets import WorkProjectAsset
from model.work_project.findings import WorkProjectFinding
from model.work_project.graph import (
    WorkProjectAttackPath,
    WorkProjectAttackPathStep,
    WorkProjectGraphEdge,
)
from model.work_project.projects import WorkProject, WorkProjectOwner
from utils.sdk_tables import BOOTSTRAP_SESSION_ID

logger = get_logger(__name__)

# registered so SQLModel.metadata picks every table up at create_all time
_registered_models = [
    SystemUser, WorkProject, WorkProjectOwner,
    WorkProjectAsset, WorkProjectFinding,
    WorkProjectGraphEdge, WorkProjectAttackPath, WorkProjectAttackPathStep,
    AgentSessionMeta, AgentMessageMeta, AgentContextCompaction,
    AgentSubordinateTask, AgentNotification, AgentEventLog,
]

_engine: AsyncEngine | None = None


async def create_all_tables() -> None:
    global _engine
    if _engine is None:
        raise RuntimeError("database engine is not initialized")

    # SDK manages its own metadata; bootstrap a throwaway session to obtain it
    sdk_metadata = SQLAlchemySession(session_id=BOOTSTRAP_SESSION_ID, engine=_engine)._metadata

    # SDK tables first; some app tables (e.g. AgentMessageMeta) FK into them
    async with _engine.begin() as conn:
        await conn.run_sync(sdk_metadata.create_all)
        await conn.run_sync(SQLModel.metadata.create_all)

    logger.info("all tables created")


async def close_engine() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None


def init_engine() -> None:
    global _engine
    if _engine is not None:
        return

    cfg = get_config()
    db = cfg.database
    dsn = os.environ.get("ZJ_DATABASE_URL", db.url).strip()
    if not dsn:
        database_path = (WORKSPACE / db.filename).resolve()
        database_path.parent.mkdir(parents=True, exist_ok=True)
        dsn = f"sqlite+aiosqlite:///{database_path.as_posix()}"
    if make_url(dsn).get_backend_name() != "sqlite":
        raise RuntimeError("portable ZJ only supports SQLite database URLs")

    _engine = create_async_engine(
        url=dsn,
        pool_pre_ping=db.pool_pre_ping,
        connect_args={"timeout": db.busy_timeout_ms / 1000},
    )

    @event.listens_for(_engine.sync_engine, "connect")
    def _configure_sqlite(dbapi_connection, _) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute(f"PRAGMA busy_timeout = {db.busy_timeout_ms}")
            cursor.execute("PRAGMA journal_mode = WAL")
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.execute("PRAGMA synchronous = NORMAL")
        finally:
            cursor.close()

    logger.info("async SQLite engine initialized: %s", dsn)


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        raise RuntimeError("database engine is not initialized")
    return _engine


def get_async_session() -> AsyncSession:
    return AsyncSession(get_engine())
