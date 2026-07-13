import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from config import DatabaseConfig, get_config
from database import close_engine, create_all_tables, get_async_session, get_engine, init_engine
from model.agent.sessions import AgentSessionMeta
from model.system_user.users import SystemUser
from model.work_project.projects import WorkProject, WorkProjectOwner
from schema.agent.sessions import SessionType
from schema.system_user.users import SystemUserRole
from service.agent.event_log import fetch_timeline_page, upsert_timeline_events
from service.agent.sessions import ensure_sdk_session_row


class SQLiteDatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="zj-sqlite-test-")
        self.original_database = get_config().database.model_copy(deep=True)
        database_path = Path(self.temp_dir.name) / "test.sqlite3"
        get_config().database = DatabaseConfig(
            url=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        )
        init_engine()
        await create_all_tables()

    async def asyncTearDown(self) -> None:
        await close_engine()
        get_config().database = self.original_database
        self.temp_dir.cleanup()

    async def test_cold_start_project_session_and_timeline_upsert(self) -> None:
        async with get_engine().connect() as connection:
            foreign_keys = (await connection.exec_driver_sql("PRAGMA foreign_keys")).scalar_one()
            journal_mode = (await connection.exec_driver_sql("PRAGMA journal_mode")).scalar_one()
        self.assertEqual(1, foreign_keys)
        self.assertEqual("wal", str(journal_mode).lower())

        async with get_async_session() as session:
            user = SystemUser(
                username="admin",
                password="test-only",
                role=SystemUserRole.ADMIN,
            )
            session.add(user)
            await session.flush()

            project = WorkProject(
                name="Portable smoke",
                tasks=[{"id": "boot", "title": "Boot", "status": "todo", "progress": 0}],
            )
            session.add(project)
            await session.flush()
            session.add(WorkProjectOwner(project_id=project.id, user_id=user.id))

            await ensure_sdk_session_row(session, "portable-session")
            session.add(AgentSessionMeta(
                session_id="portable-session",
                session_type=SessionType.PROJECT,
                owner_id=user.id,
                project_id=project.id,
            ))
            await session.commit()

        now = datetime.now()
        await upsert_timeline_events(
            "portable-session",
            [("item", 1, json.dumps({"value": "first"}), now)],
        )
        await upsert_timeline_events(
            "portable-session",
            [("item", 99, json.dumps({"value": "second"}), now)],
        )

        items, has_more, cursor = await fetch_timeline_page(
            "portable-session",
            before_seq=None,
            limit=10,
        )
        self.assertEqual([(1, {"value": "second"})], items)
        self.assertFalse(has_more)
        self.assertIsNone(cursor)


if __name__ == "__main__":
    unittest.main()
