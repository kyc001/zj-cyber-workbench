import asyncio
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, patch

from core.runtime.context import AgentRuntimeContext, AgentUserContext
from core.runtime.session import _context_for_notification
from core.sandbox import command_jobs
from schema.agent.notifications import AgentNotificationKind, AgentNotificationSnapshot, AgentNotificationStatus
from schema.system_user.users import SystemUserRole


class AsyncCommandRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        jobs = list(command_jobs._jobs.values())
        command_jobs._jobs.clear()
        for job in jobs:
            if not job.task.done():
                job.task.cancel()
        if jobs:
            await asyncio.gather(*(job.task for job in jobs), return_exceptions=True)

    async def test_cancel_runtime_jobs_only_cancels_matching_agent(self) -> None:
        first = asyncio.create_task(asyncio.Event().wait())
        second = asyncio.create_task(asyncio.Event().wait())
        command_jobs._jobs.update({
            "first": command_jobs._AsyncCommandJob(
                task=first,
                session_id="session-a",
                agent_instance_id="agent-a",
                container_id=1,
            ),
            "second": command_jobs._AsyncCommandJob(
                task=second,
                session_id="session-b",
                agent_instance_id="agent-b",
                container_id=1,
            ),
        })

        with patch.object(command_jobs, "cancel_running_process", new=AsyncMock(return_value=True)) as cancel:
            canceled = await command_jobs._cancel_runtime_jobs(
                lambda _, job: job.session_id == "session-a" and job.agent_instance_id == "agent-a"
            )

        self.assertTrue(canceled)
        self.assertTrue(first.cancelled())
        self.assertFalse(second.done())
        self.assertNotIn("first", command_jobs._jobs)
        self.assertIn("second", command_jobs._jobs)
        cancel.assert_awaited_once_with("first")

    async def test_notification_resume_restores_authorization_scope(self) -> None:
        base = AgentRuntimeContext(
            session_id="session-a",
            user=AgentUserContext(
                id=1,
                username="desktop",
                email="desktop@localhost",
                role=SystemUserRole.ADMIN,
            ),
            agent_code="cso",
        )
        notification = AgentNotificationSnapshot(
            id="notification-a",
            session_id="session-a",
            target_agent_code="cso",
            target_agent_instance_id="main:session-a:1:cso",
            kind=AgentNotificationKind.SUBAGENT_FINISHED,
            status=AgentNotificationStatus.PENDING,
            allowed_targets=("http://example.test/",),
            allowed_action_types=("security.web.scan",),
            scope_id="session:session-a",
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )

        resumed = _context_for_notification(base, notification)

        self.assertEqual(("http://example.test/",), resumed.allowed_targets)
        self.assertEqual(("security.web.scan",), resumed.allowed_action_types)
        self.assertEqual("session:session-a", resumed.scope_id)


if __name__ == "__main__":
    unittest.main()
