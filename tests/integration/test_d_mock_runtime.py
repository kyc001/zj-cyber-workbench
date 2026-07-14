import asyncio
import tempfile
import unittest
from pathlib import Path

from config import AgentConfig, DatabaseConfig, get_config
from core.runtime.session import get_agent_pool, replace_agent_pool
from database import close_engine, create_all_tables, init_engine
from middleware.auth import AuthUser
from schema.agent.events import AgentEventTypeSchema, AgentTextInputPart
from schema.system_user.users import SystemUserRole
from service.agent import runtime as agent_runtime
from service.agent.event_log import fetch_timeline_page
from service.host.hosts import ensure_local_managed_host
from service.system_user.users import create_system_user


class DMockRuntimeIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="zj-d-runtime-")
        self.original_database = get_config().database.model_copy(deep=True)
        self.original_agents = {
            code: agent.model_copy(deep=True)
            for code, agent in get_config().agents.items()
        }

        database_path = Path(self.temp_dir.name) / "runtime.sqlite3"
        get_config().database = DatabaseConfig(
            url=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        )
        get_config().agents = {
            **self.original_agents,
            "cso": AgentConfig(
                code="cso",
                name="ZJ Mock Ops Lead",
                description="Deterministic D-group runtime integration agent",
                base_url="mock://diagnostic_text",
                model="zj-mock",
            ),
        }

        init_engine()
        await create_all_tables()
        await ensure_local_managed_host()
        stored_user = await create_system_user(
            username="d-runtime-tester",
            password="test-only-password",
            role=SystemUserRole.ADMIN,
        )
        self.user = AuthUser(
            id=stored_user.id or 0,
            role=stored_user.role,
            email=stored_user.email,
            username=stored_user.username,
        )
        self.pool = replace_agent_pool()

    async def asyncTearDown(self) -> None:
        await self.pool.stop()
        replace_agent_pool()
        await close_engine()
        get_config().database = self.original_database
        get_config().agents = self.original_agents
        self.temp_dir.cleanup()

    async def test_mock_model_runs_through_session_runtime_and_persists_timeline(self) -> None:
        session_id, initial_events = await agent_runtime.submit_new_chat_turn(
            content=[AgentTextInputPart(text="Inspect the local nginx service using read-only checks.")],
            user=self.user,
            sandbox_container_id=None,
            requested_agent_code="cso",
        )
        self.assertEqual(
            [AgentEventTypeSchema.RUN_STATE, AgentEventTypeSchema.USER_MESSAGE],
            [event.type for event in initial_events],
        )

        timeline = await self._wait_for_completed_timeline(session_id)
        event_types = [item[1]["type"] for item in timeline]
        self.assertIn(AgentEventTypeSchema.USER_MESSAGE, event_types)
        self.assertIn(AgentEventTypeSchema.TEXT_COMPLETE, event_types)
        self.assertNotIn(AgentEventTypeSchema.ERROR, event_types)

        text_events = [
            payload for _, payload in timeline
            if payload["type"] == AgentEventTypeSchema.TEXT_COMPLETE
        ]
        self.assertTrue(text_events)
        self.assertIn("Observation: nginx is unavailable", text_events[-1]["text"])

        await self.pool.stop()
        self.pool = replace_agent_pool()
        persisted, _, _ = await fetch_timeline_page(session_id, before_seq=None, limit=100)
        self.assertEqual(timeline, persisted)

    async def _wait_for_completed_timeline(self, session_id: str):
        for _ in range(100):
            await asyncio.sleep(0.05)
            await get_agent_pool().flush_timeline(session_id)
            items, _, _ = await fetch_timeline_page(session_id, before_seq=None, limit=100)
            types = {payload.get("type") for _, payload in items}
            if AgentEventTypeSchema.TEXT_COMPLETE in types:
                return items
        self.fail("mock Agent Runtime did not persist a completed response")


if __name__ == "__main__":
    unittest.main()
