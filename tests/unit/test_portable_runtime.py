import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from core.execution_guard import authorize_network_action
from core.runtime.context import AgentRuntimeContext, AgentUserContext
from core.tools import sandbox as sandbox_tools
from model.egress_proxy.proxies import EgressProxy
from schema.egress_proxy.proxies import EgressProxyType
from schema.sandbox.containers import SandboxContainerEgressMode
from schema.system_user.users import SystemUserRole
from service.sandbox import files as sandbox_files
from service.sandbox import local_runtime, remote_files, remote_runtime
from service.sandbox.egress import SandboxEgressSelection, sandbox_portable_process_environment
from service.sandbox.files import ContainerUploadSource
from tests.unit._network_addresses import LOOPBACK_HOST


class PortableRuntimeTests(unittest.TestCase):
    def context(self, *, targets: tuple[str, ...]) -> AgentRuntimeContext:
        return AgentRuntimeContext(
            session_id="test-session",
            user=AgentUserContext(
                id=1,
                username="tester",
                email="tester@localhost",
                role=SystemUserRole.ADMIN,
            ),
            agent_code="cso",
            allowed_targets=targets,
            allowed_action_types=("security.web.scan",),
            scope_id="scope:test",
        )

    def test_workspace_path_cannot_escape_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "sandboxes"
            with patch.object(local_runtime, "SANDBOX_ROOT", root):
                safe = local_runtime.resolve_sandbox_path(1, "/notes/report.txt")
                self.assertTrue(safe.is_relative_to(root.resolve()))
                with self.assertRaises(PermissionError):
                    local_runtime.resolve_sandbox_path(1, "../../outside.txt")

    def test_network_scope_rejects_scheme_change(self) -> None:
        context = self.context(targets=("http://example.test/",))
        authorize_network_action(
            context,
            action_type="security.web.scan",
            target="http://example.test/health",
        )
        with self.assertRaises(PermissionError):
            authorize_network_action(
                context,
                action_type="security.web.scan",
                target="https://example.test/",
            )

    def test_network_decisions_are_audited(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            with patch("core.execution_guard._AUDIT_PATH", audit_path):
                context = self.context(targets=("http://example.test/",))
                authorize_network_action(
                    context,
                    action_type="security.web.scan",
                    target="http://example.test/",
                )
            record = json.loads(audit_path.read_text(encoding="utf-8").splitlines()[-1])
            self.assertEqual("allow", record["effect"])
            self.assertEqual("scope:test", record["scope_id"])

    def test_remote_workspace_paths_cannot_escape_root(self) -> None:
        self.assertEqual("reports/finding.txt", remote_runtime.normalize_remote_path("/reports/finding.txt"))
        with self.assertRaises(PermissionError):
            remote_runtime.normalize_remote_path("../../etc/passwd")

    def test_direct_egress_clears_inherited_proxy_environment(self) -> None:
        environment = sandbox_portable_process_environment(
            SandboxEgressSelection(SandboxContainerEgressMode.DIRECT)
        )
        self.assertEqual("", environment["HTTP_PROXY"])
        self.assertEqual("", environment["all_proxy"])
        self.assertIn(LOOPBACK_HOST, environment["NO_PROXY"])

    def test_managed_proxy_egress_builds_authenticated_process_environment(self) -> None:
        proxy = EgressProxy(
            proxy_type=EgressProxyType.SOCKS5,
            proxy_host="proxy.example",
            proxy_port=1080,
            proxy_account="test user",
            proxy_password="p@ss",
        )
        environment = sandbox_portable_process_environment(
            SandboxEgressSelection(SandboxContainerEgressMode.PROXY, proxy)
        )
        expected = "socks5h://test%20user:p%40ss@proxy.example:1080"
        self.assertEqual(expected, environment["HTTP_PROXY"])
        self.assertEqual(expected, environment["ALL_PROXY"])

    def test_remote_command_quotes_environment_and_rejects_invalid_keys(self) -> None:
        command = remote_runtime.remote_command(
            7,
            "printf test",
            {"HTTP_PROXY": "http://user:p@ss@proxy.example:8080", "EMPTY": ""},
        )
        self.assertIn("HTTP_PROXY=", command)
        self.assertIn("EMPTY=''", command)
        self.assertIn(".zj/sandboxes/7/workspace", command)
        with self.assertRaises(ValueError):
            remote_runtime.remote_command(7, "true", {"BAD-NAME": "value"})

    def test_all_bundled_skills_have_an_execution_backend(self) -> None:
        skills_root = Path(__file__).resolve().parents[2] / "skills"
        bundled = {path.name for path in skills_root.iterdir() if (path / "SKILL.md").is_file()}
        classified = sandbox_tools._WINDOWS_NATIVE_SKILLS | sandbox_tools._LINUX_WORKSPACE_SKILLS
        self.assertEqual(bundled, classified)


class RemoteFileRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_sftp_session_reuses_the_open_client_for_workspace_root(self) -> None:
        sftp = MagicMock()
        sftp.realpath = AsyncMock(return_value="/home/tester")
        sftp.makedirs = AsyncMock()
        connection = MagicMock()
        connection.start_sftp_client = AsyncMock(return_value=sftp)
        connection.wait_closed = AsyncMock()
        host = MagicMock()

        with patch.object(remote_files, "connect_managed_host", new=AsyncMock(return_value=connection)):
            async with remote_files._sftp_session(host, 9) as (_, opened_sftp, root):
                self.assertIs(sftp, opened_sftp)
                self.assertEqual("/home/tester/.zj/sandboxes/9/workspace", root)

        connection.start_sftp_client.assert_awaited_once()
        sftp.realpath.assert_awaited_once_with(".")
        connection.close.assert_called_once()
        connection.wait_closed.assert_awaited_once()


class LocalFileRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_write_file_uses_backup_and_atomic_replace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "sandboxes"
            with (
                patch.object(local_runtime, "SANDBOX_ROOT", root),
                patch.object(sandbox_files, "_remote_host", new=AsyncMock(return_value=None)),
            ):
                target = local_runtime.resolve_sandbox_path(1, "/notes.txt")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("old", encoding="utf-8")

                await sandbox_files.write_container_file(1, "/notes.txt", "new")

                self.assertEqual("new", target.read_text(encoding="utf-8"))
                backups = list(local_runtime.resolve_sandbox_path(1, "/.zj-backups").glob("*-notes.txt"))
                self.assertEqual(1, len(backups))
                self.assertEqual("old", backups[0].read_text(encoding="utf-8"))
                self.assertFalse(list(target.parent.glob(".zj-upload-*.tmp")))

    async def test_upload_file_reports_sha256_and_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "sandboxes"
            with (
                patch.object(local_runtime, "SANDBOX_ROOT", root),
                patch.object(sandbox_files, "_remote_host", new=AsyncMock(return_value=None)),
            ):
                target = local_runtime.resolve_sandbox_path(1, "/upload.txt")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("old", encoding="utf-8")

                uploaded = await sandbox_files.upload_container_files(
                    1,
                    "/",
                    [ContainerUploadSource(filename="upload.txt", stream=BytesIO(b"new"))],
                    overwrite=True,
                )

                self.assertEqual("new", target.read_text(encoding="utf-8"))
                self.assertEqual(1, len(uploaded))
                self.assertEqual("11507a0e2f5e69d5dfa40a62a1bd7b6ee57e6bcd85c67c9b8431b36fff21c437", uploaded[0].sha256)
                self.assertTrue(uploaded[0].backup_path.startswith("/.zj-backups/"))


if __name__ == "__main__":
    unittest.main()
