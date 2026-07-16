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
from model.egress_proxy.proxies import EgressProxy
from model.host.hosts import ManagedHost
from model.sandbox.async_jobs import SandboxAsyncJob
from model.sandbox.containers import SandboxContainer
from model.sandbox.images import SandboxImage
from model.system_user.users import SystemUser
from model.work_project.assets import WorkProjectAsset
from model.work_project.findings import WorkProjectFinding
from model.work_project.graph import (
    WorkProjectAttackPath,
    WorkProjectAttackPathStep,
    WorkProjectGraphEdge,
)
from model.work_project.projects import WorkProject, WorkProjectOwner, WorkProjectSandboxContainer
from utils.sdk_tables import BOOTSTRAP_SESSION_ID

logger = get_logger(__name__)

# registered so SQLModel.metadata picks every table up at create_all time
_registered_models = [
    SystemUser, WorkProject, WorkProjectOwner, WorkProjectSandboxContainer,
    WorkProjectAsset, WorkProjectFinding,
    WorkProjectGraphEdge, WorkProjectAttackPath, WorkProjectAttackPathStep,
    AgentSessionMeta, AgentMessageMeta, AgentContextCompaction,
    AgentSubordinateTask, AgentNotification, AgentEventLog, SandboxAsyncJob,
    ManagedHost, EgressProxy, SandboxImage, SandboxContainer,
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
        await _upgrade_portable_schema(conn)

    logger.info("all tables created")


async def _upgrade_portable_schema(conn) -> None:
    """Apply additive SQLite upgrades for existing portable workspaces."""
    columns = {
        row[1]
        for row in (await conn.exec_driver_sql("PRAGMA table_info(agent_session_meta)")).fetchall()
    }
    additions = {
        "selected_sandbox_container_id": "INTEGER",
        "selected_sandbox_container_generation": "BIGINT NOT NULL DEFAULT 0",
        "runtime_sandbox_container_id": "INTEGER",
        "runtime_sandbox_container_generation": "BIGINT NOT NULL DEFAULT 0",
    }
    for name, definition in additions.items():
        if name not in columns:
            await conn.exec_driver_sql(
                f"ALTER TABLE agent_session_meta ADD COLUMN {name} {definition}"
            )

    notification_columns = {
        row[1]
        for row in (await conn.exec_driver_sql("PRAGMA table_info(agent_notifications)")).fetchall()
    }
    notification_additions = {
        "sandbox_container_id": "INTEGER",
        "sandbox_container_generation": "BIGINT NOT NULL DEFAULT 0",
        "sandbox_skill_metadata": "JSON NOT NULL DEFAULT '[]'",
    }
    for name, definition in notification_additions.items():
        if name not in notification_columns:
            await conn.exec_driver_sql(
                f"ALTER TABLE agent_notifications ADD COLUMN {name} {definition}"
            )

    finding_columns = {
        row[1]
        for row in (await conn.exec_driver_sql("PRAGMA table_info(work_project_findings)")).fetchall()
    }
    finding_additions = {
        "finding_type": "VARCHAR(32) NOT NULL DEFAULT 'general'",
        "cve_id": "VARCHAR(32) NOT NULL DEFAULT ''",
        "confidence": "VARCHAR(32) NOT NULL DEFAULT 'low'",
        "cvss_score": "FLOAT",
        "cvss_vector": "VARCHAR NOT NULL DEFAULT ''",
        "cwes": "JSON NOT NULL DEFAULT '[]'",
        "references": "JSON NOT NULL DEFAULT '[]'",
        "evidence": "VARCHAR NOT NULL DEFAULT ''",
        "remediation": "VARCHAR NOT NULL DEFAULT ''",
        "source": "VARCHAR NOT NULL DEFAULT ''",
        "known_exploited": "BOOLEAN NOT NULL DEFAULT 0",
        "epss_score": "FLOAT",
        "epss_percentile": "FLOAT",
        "affected_version": "VARCHAR NOT NULL DEFAULT ''",
        "fixed_versions": "JSON NOT NULL DEFAULT '[]'",
    }
    for name, definition in finding_additions.items():
        if name not in finding_columns:
            await conn.exec_driver_sql(
                f"ALTER TABLE work_project_findings ADD COLUMN {name} {definition}"
            )

    managed_host_columns = {
        row[1]
        for row in (await conn.exec_driver_sql("PRAGMA table_info(managed_hosts)")).fetchall()
    }
    managed_host_additions = {
        "display_name": "VARCHAR NOT NULL DEFAULT ''",
    }
    for name, definition in managed_host_additions.items():
        if name not in managed_host_columns:
            await conn.exec_driver_sql(
                f"ALTER TABLE managed_hosts ADD COLUMN {name} {definition}"
            )
    await conn.exec_driver_sql(
        """
        UPDATE managed_hosts
        SET display_name = CASE WHEN id = 1 THEN '本机' ELSE 'WSL测试机' END
        WHERE display_name IS NULL OR TRIM(display_name) = ''
        """
    )

    await conn.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_work_project_findings_cve_id ON work_project_findings (cve_id)"
    )
    await conn.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_work_project_findings_finding_type ON work_project_findings (finding_type)"
    )


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
