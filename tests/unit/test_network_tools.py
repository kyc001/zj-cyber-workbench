import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from core.runtime.context import AgentRuntimeContext
from core.tools.network import _resolve_ssh_credential_for_context, _same_ssh_endpoint, _ssh_target_host_port


class NetworkToolTests(unittest.IsolatedAsyncioTestCase):
    def test_ssh_target_host_port_accepts_plain_host_and_port_argument(self) -> None:
        self.assertEqual(("127.0.0.1", 2222), _ssh_target_host_port("127.0.0.1", 2222))

    def test_ssh_target_host_port_accepts_ssh_url(self) -> None:
        self.assertEqual(("127.0.0.1", 2222), _ssh_target_host_port("ssh://127.0.0.1:2222", 22))

    def test_ssh_target_host_port_rejects_non_ssh_scheme(self) -> None:
        with self.assertRaises(ValueError):
            _ssh_target_host_port("http://127.0.0.1:2222", 22)

    def test_same_ssh_endpoint_accepts_localhost_alias(self) -> None:
        self.assertTrue(_same_ssh_endpoint("localhost", 2222, "127.0.0.1", 2222))

    async def test_ssh_context_uses_current_workspace_managed_host(self) -> None:
        context = _agent_context(sandbox_container_id=7)
        host = SimpleNamespace(
            id=2,
            ip_address="127.0.0.1",
            ssh_port=2222,
            host_account="zj_sandbox",
            host_password="secret-value",
        )
        with patch(
            "service.sandbox.remote_runtime.resolve_container_host",
            new=AsyncMock(return_value=(SimpleNamespace(id=7), host)),
        ):
            result = await _resolve_ssh_credential_for_context(
                context,
                target_host="localhost",
                target_port=2222,
                username="",
                credential_ref="",
            )

        self.assertEqual(("127.0.0.1", 2222, "zj_sandbox", {"password": "secret-value"}, "managed_host"), result)

    async def test_ssh_context_defaults_target_to_current_workspace_host(self) -> None:
        context = _agent_context(sandbox_container_id=7)
        host = SimpleNamespace(
            id=2,
            ip_address="127.0.0.1",
            ssh_port=2222,
            host_account="zj_sandbox",
            host_password="secret-value",
        )
        with patch(
            "service.sandbox.remote_runtime.resolve_container_host",
            new=AsyncMock(return_value=(SimpleNamespace(id=7), host)),
        ):
            result = await _resolve_ssh_credential_for_context(
                context,
                target_host=None,
                target_port=None,
                username="",
                credential_ref="",
            )

        self.assertEqual(("127.0.0.1", 2222, "zj_sandbox", {"password": "secret-value"}, "managed_host"), result)

    async def test_ssh_context_rejects_workspace_host_mismatch_without_leaking_password(self) -> None:
        context = _agent_context(sandbox_container_id=7)
        host = SimpleNamespace(
            id=2,
            ip_address="127.0.0.1",
            ssh_port=2222,
            host_account="zj_sandbox",
            host_password="secret-value",
        )
        with patch(
            "service.sandbox.remote_runtime.resolve_container_host",
            new=AsyncMock(return_value=(SimpleNamespace(id=7), host)),
        ):
            with self.assertRaises(ValueError) as exc:
                await _resolve_ssh_credential_for_context(
                    context,
                    target_host="192.0.2.10",
                    target_port=2222,
                    username="",
                    credential_ref="",
                )

        self.assertNotIn("secret-value", str(exc.exception))


def _agent_context(sandbox_container_id: int | None = None) -> AgentRuntimeContext:
    return AgentRuntimeContext(
        session_id="test-session",
        user=SimpleNamespace(id=1, username="tester", email="tester@example.test", role="admin"),
        sandbox_container_id=sandbox_container_id,
    )


if __name__ == "__main__":
    unittest.main()
