from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from middleware.auth import AuthUser
from schema.sandbox.containers import SandboxContainerStatus
from schema.system_user.users import SystemUserRole
from schema.toolpack import ExecutionErrorCode, ToolRunRequest, ToolRunStatus
from service import toolpack
from service.host.hosts import DEFAULT_LOCAL_HOST_ID
from service.sandbox.commands import SandboxContainerCommandResult


class ToolpackTests(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self) -> None:
        runs = list(toolpack._runs.values())
        toolpack._runs.clear()
        for run in runs:
            if not run.task.done():
                run.task.cancel()
        if runs:
            await asyncio.gather(*(run.task for run in runs), return_exceptions=True)

    def user(self) -> AuthUser:
        return AuthUser(
            id=1,
            role=SystemUserRole.ADMIN,
            email="desktop@localhost",
            username="desktop",
        )

    async def wait_for_terminal(self, run_id: str):
        terminal = {ToolRunStatus.COMPLETED, ToolRunStatus.FAILED, ToolRunStatus.CANCELED}
        for _ in range(50):
            snapshot = await toolpack.get_tool_run(run_id)
            if snapshot is not None and snapshot.status in terminal:
                return snapshot
            await asyncio.sleep(0.01)
        self.fail("tool run did not finish")

    async def test_list_tools_exposes_minimum_manifest_contract(self) -> None:
        response = await toolpack.list_toolpack_tools()

        ids = {item.id for item in response.tools}
        self.assertEqual(
            {
                "local.webcheck",
                "local.tls.inspect",
                "local.port.scan",
                "local.httpx",
                "local.dnsx",
                "local.ffuf",
                "ssh.nmap",
                "ssh.sqlmap",
            },
            ids,
        )
        httpx = next(item for item in response.tools if item.id == "local.httpx")
        self.assertEqual("httpx", httpx.manifest.executable)
        self.assertIn("input_schema", type(httpx.manifest).model_fields)
        self.assertIn("policy", type(httpx.manifest).model_fields)

    async def test_ssh_tools_are_marked_unavailable_for_local_workspace(self) -> None:
        with self.local_workspace_patches():
            response = await toolpack.list_toolpack_tools(sandbox_container_id=1)

        nmap = next(item for item in response.tools if item.id == "ssh.nmap")
        sqlmap = next(item for item in response.tools if item.id == "ssh.sqlmap")
        self.assertFalse(nmap.available)
        self.assertFalse(sqlmap.available)
        self.assertEqual("Linux-heavy tools require an SSH workspace", nmap.availability_message)

    async def test_missing_local_tool_finishes_with_tool_missing(self) -> None:
        with self.local_workspace_patches(), patch.object(toolpack, "_local_tool_path", return_value=None):
            snapshot = await toolpack.start_tool_run(
                "local.httpx",
                ToolRunRequest(sandbox_container_id=1, input={"target": "http://example.test/"}),
                self.user(),
            )
            finished = await self.wait_for_terminal(snapshot.run_id)

        self.assertEqual(ToolRunStatus.FAILED, finished.status)
        self.assertIsNotNone(finished.result)
        self.assertEqual(ExecutionErrorCode.TOOL_MISSING, finished.result.error_code)

    async def test_successful_tool_run_returns_structured_records(self) -> None:
        command_result = SandboxContainerCommandResult(
            output='{"url":"http://example.test/","status_code":200}\n',
            exit_code=0,
        )
        execute = AsyncMock(return_value=command_result)
        with (
            self.local_workspace_patches(),
            patch.object(toolpack, "_local_tool_path", return_value="/tmp/httpx"),
            patch.object(toolpack, "execute_sandbox_container_command", execute),
        ):
            snapshot = await toolpack.start_tool_run(
                "local.httpx",
                ToolRunRequest(sandbox_container_id=1, input={"target": "http://example.test/"}),
                self.user(),
            )
            finished = await self.wait_for_terminal(snapshot.run_id)

        self.assertEqual(ToolRunStatus.COMPLETED, finished.status)
        self.assertIsNotNone(finished.result)
        self.assertTrue(finished.result.ok)
        self.assertEqual("http://example.test/", finished.result.structured["records"][0]["url"])
        command = execute.await_args.args[1]
        if os.name == "nt":
            self.assertIn("Get-Command 'httpx'", command)
            self.assertIn("'http://example.test/'", command)
        else:
            self.assertIn("command -v httpx", command)
            self.assertIn("-u http://example.test/", command)

    async def test_ffuf_policy_requires_fuzz_marker(self) -> None:
        with self.local_workspace_patches(), patch.object(toolpack, "_local_tool_path", return_value="/tmp/ffuf"):
            snapshot = await toolpack.start_tool_run(
                "local.ffuf",
                ToolRunRequest(
                    sandbox_container_id=1,
                    input={"url": "http://example.test/", "wordlist": "/wordlists/common.txt"},
                ),
                self.user(),
            )
            finished = await self.wait_for_terminal(snapshot.run_id)

        self.assertEqual(ToolRunStatus.FAILED, finished.status)
        self.assertIsNotNone(finished.result)
        self.assertEqual(ExecutionErrorCode.POLICY_DENIED, finished.result.error_code)

    async def test_port_scan_policy_limits_port_count(self) -> None:
        ports = ",".join(str(port) for port in range(1, 34))
        with self.local_workspace_patches(), patch.object(toolpack, "_local_tool_path", return_value="/tmp/python"):
            snapshot = await toolpack.start_tool_run(
                "local.port.scan",
                ToolRunRequest(sandbox_container_id=1, input={"host": "127.0.0.1", "ports": ports}),
                self.user(),
            )
            finished = await self.wait_for_terminal(snapshot.run_id)

        self.assertEqual(ToolRunStatus.FAILED, finished.status)
        self.assertIsNotNone(finished.result)
        self.assertEqual(ExecutionErrorCode.POLICY_DENIED, finished.result.error_code)
        self.assertEqual("port count exceeds policy limit 32", finished.result.summary)

    async def test_webcheck_tool_run_uses_python_runtime_and_parses_record(self) -> None:
        command_result = SandboxContainerCommandResult(
            output='{"url":"http://example.test/","status_code":200,"ok":true}\n',
            exit_code=0,
        )
        execute = AsyncMock(return_value=command_result)
        with (
            self.local_workspace_patches(),
            patch.object(toolpack, "_local_tool_path", return_value="/tmp/python"),
            patch.object(toolpack, "execute_sandbox_container_command", execute),
        ):
            snapshot = await toolpack.start_tool_run(
                "local.webcheck",
                ToolRunRequest(sandbox_container_id=1, input={"url": "http://example.test/"}),
                self.user(),
            )
            finished = await self.wait_for_terminal(snapshot.run_id)

        self.assertEqual(ToolRunStatus.COMPLETED, finished.status)
        self.assertIsNotNone(finished.result)
        self.assertEqual("http://example.test/", finished.result.structured["records"][0]["url"])
        command = execute.await_args.args[1]
        self.assertIn("python", command)

    async def test_ssh_tool_on_local_workspace_is_platform_unsupported(self) -> None:
        with self.local_workspace_patches():
            snapshot = await toolpack.start_tool_run(
                "ssh.nmap",
                ToolRunRequest(sandbox_container_id=1, input={"target": "example.test"}),
                self.user(),
            )
            finished = await self.wait_for_terminal(snapshot.run_id)

        self.assertEqual(ToolRunStatus.FAILED, finished.status)
        self.assertIsNotNone(finished.result)
        self.assertEqual(ExecutionErrorCode.PLATFORM_UNSUPPORTED, finished.result.error_code)

    def test_large_output_is_truncated_and_written_as_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            artifact_root = workspace / "toolpack" / "artifacts"
            with (
                patch.object(toolpack, "WORKSPACE", workspace),
                patch.object(toolpack, "_ARTIFACT_ROOT", artifact_root),
            ):
                result = toolpack._result_from_command(
                    "run-a",
                    toolpack._TOOLS["local.httpx"],
                    SandboxContainerCommandResult(output="x" * (toolpack._MAX_STRUCTURED_STDOUT + 10), exit_code=0),
                    started_at=toolpack.datetime.now(),
                    finished_at=toolpack.datetime.now(),
                )

        self.assertTrue(result.truncated)
        self.assertEqual(1, len(result.artifact_refs))
        self.assertLessEqual(len(result.structured["stdout"].encode()), toolpack._MAX_STRUCTURED_STDOUT)

    def local_workspace_patches(self):
        container = SimpleNamespace(status=SandboxContainerStatus.RUNNING)
        host = SimpleNamespace(id=DEFAULT_LOCAL_HOST_ID)
        return patch.multiple(
            toolpack,
            sandbox_container_is_manageable_by_user=AsyncMock(return_value=True),
            resolve_container_host=AsyncMock(return_value=(container, host)),
        )


if __name__ == "__main__":
    unittest.main()
