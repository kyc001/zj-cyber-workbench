import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config import PermissionConfig, PermissionMode, get_config
from core.execution_guard import authorize_network_action_runtime
from core.runtime.context import AgentRuntimeContext, AgentUserContext
from schema.action import RiskLevel
from schema.runtime_permissions import RuntimePermissionDecision
from schema.system_user.users import SystemUserRole
from service import runtime_permissions


class RuntimePermissionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.original = get_config().permissions.model_copy(deep=True)
        get_config().permissions = PermissionConfig(mode=PermissionMode.NORMAL, approval_timeout_seconds=30)
        runtime_permissions._pending.clear()
        self.temp_dir = tempfile.TemporaryDirectory(prefix="zj-permissions-")
        root = Path(self.temp_dir.name)
        self.rules_patch = patch.object(runtime_permissions, "_RULES_PATH", root / "always.json")
        self.audit_patch = patch.object(runtime_permissions, "_AUDIT_PATH", root / "audit.jsonl")
        self.rules_patch.start()
        self.audit_patch.start()

    async def asyncTearDown(self) -> None:
        for pending in runtime_permissions._pending.values():
            pending.decision = RuntimePermissionDecision.REJECT
            pending.event.set()
        runtime_permissions._pending.clear()
        get_config().permissions = self.original
        self.rules_patch.stop()
        self.audit_patch.stop()
        self.temp_dir.cleanup()

    def context(self) -> AgentRuntimeContext:
        return AgentRuntimeContext(
            session_id="permission-session",
            user=AgentUserContext(
                id=1,
                username="desktop",
                email="desktop@localhost",
                role=SystemUserRole.ADMIN,
            ),
            agent_code="cso",
        )

    async def test_normal_mode_waits_for_allow_once(self) -> None:
        task = asyncio.create_task(
            runtime_permissions.require_permission(
                self.context(),
                action_type="workspace.command.execute",
                target="workspace://1",
                reason="run command",
                risk_level=RiskLevel.L2,
                details={"command": "whoami"},
            )
        )
        await asyncio.sleep(0)
        requests = await runtime_permissions.list_pending(requester_id=1)
        self.assertEqual(1, len(requests))
        await runtime_permissions.decide(
            requests[0].id,
            requester_id=1,
            decision=RuntimePermissionDecision.ALLOW_ONCE,
        )
        await task
        self.assertEqual([], await runtime_permissions.list_pending(requester_id=1))

    async def test_always_allow_rule_skips_next_prompt(self) -> None:
        first = asyncio.create_task(
            runtime_permissions.require_permission(
                self.context(),
                action_type="security.web.scan",
                target="https://example.test",
                reason="scan",
                risk_level=RiskLevel.L2,
            )
        )
        await asyncio.sleep(0)
        request = (await runtime_permissions.list_pending(requester_id=1))[0]
        await runtime_permissions.decide(
            request.id,
            requester_id=1,
            decision=RuntimePermissionDecision.ALWAYS_ALLOW,
        )
        await first
        await runtime_permissions.require_permission(
            self.context(),
            action_type="security.web.scan",
            target="https://example.test",
            reason="scan again",
            risk_level=RiskLevel.L2,
        )
        self.assertEqual([], await runtime_permissions.list_pending(requester_id=1))

    async def test_full_access_neither_prompts_nor_audits(self) -> None:
        get_config().permissions.mode = PermissionMode.FULL_ACCESS
        await runtime_permissions.require_permission(
            self.context(),
            action_type="workspace.command.execute",
            target="workspace://1",
            reason="run command",
            risk_level=RiskLevel.L3,
        )
        self.assertEqual([], await runtime_permissions.list_pending(requester_id=1))
        self.assertFalse(runtime_permissions._AUDIT_PATH.exists())

    async def test_full_access_bypasses_network_scope_without_audit(self) -> None:
        get_config().permissions.mode = PermissionMode.FULL_ACCESS
        with patch("core.execution_guard._AUDIT_PATH", runtime_permissions._AUDIT_PATH):
            await authorize_network_action_runtime(
                self.context(),
                action_type="network.port.probe",
                target="https://outside.example",
                risk=RiskLevel.L3,
            )
        self.assertFalse(runtime_permissions._AUDIT_PATH.exists())

    async def test_switching_to_full_access_releases_pending_without_audit(self) -> None:
        with patch("core.execution_guard._AUDIT_PATH", runtime_permissions._AUDIT_PATH):
            task = asyncio.create_task(
                authorize_network_action_runtime(
                    self.context(),
                    action_type="network.port.probe",
                    target="https://outside.example",
                    risk=RiskLevel.L3,
                )
            )
            await asyncio.sleep(0)
            file_config = get_config().model_copy(deep=True)
            with (
                patch.object(runtime_permissions, "read_config_file", return_value=file_config),
                patch.object(runtime_permissions, "write_config_file"),
            ):
                await runtime_permissions.update_mode(PermissionMode.FULL_ACCESS)
            await task

        self.assertEqual([], await runtime_permissions.list_pending(requester_id=1))
        self.assertFalse(runtime_permissions._AUDIT_PATH.exists())


if __name__ == "__main__":
    unittest.main()
