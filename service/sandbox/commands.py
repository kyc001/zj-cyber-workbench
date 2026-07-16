from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import asyncssh

from schema.sandbox.containers import SandboxContainerStatus
from service.sandbox.egress import resolve_portable_process_environment
from service.sandbox.local_runtime import portable_tool_environment, sandbox_workspace, shell_invocation
from service.sandbox.remote_runtime import connect_managed_host, is_local_host, remote_command, resolve_container_host


class SandboxContainerCommandTimeoutError(TimeoutError):
    def __init__(self, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(f"portable workspace command timed out after {timeout_seconds:g} seconds")


@dataclass(frozen=True)
class SandboxContainerCommandResult:
    output: str
    exit_code: int


@dataclass(frozen=True)
class _RunningProcess:
    container_id: int
    process: Any
    connection: Any | None = None


_running_processes: dict[str, _RunningProcess] = {}


async def execute_sandbox_container_command(
    id: int,
    command: str,
    timeout_seconds: float,
    *,
    execution_id: str | None = None,
) -> SandboxContainerCommandResult:
    command = command.strip()
    if not command:
        raise ValueError("portable workspace command is required")
    if len(command) > 32_000:
        raise ValueError("portable workspace command is too long")
    container, host = await resolve_container_host(id)
    if container.status != SandboxContainerStatus.RUNNING:
        raise ValueError("portable workspace is not running")
    egress_environment = await resolve_portable_process_environment(container)
    connection = None
    if is_local_host(host):
        process = await asyncio.create_subprocess_exec(
            *shell_invocation(command),
            cwd=sandbox_workspace(id),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={
                **os.environ,
                **portable_tool_environment(),
                **egress_environment,
                "ZJ_SANDBOX_ID": str(id),
            },
        )
    else:
        connection = await connect_managed_host(host)
        process = await connection.create_process(
            remote_command(id, command, {**egress_environment, "ZJ_SANDBOX_ID": str(id)}),
            stdin=asyncssh.DEVNULL,
            stdout=asyncssh.PIPE,
            stderr=asyncssh.STDOUT,
            encoding=None,
        )
    process_id = execution_id or uuid4().hex
    _running_processes[process_id] = _RunningProcess(container_id=id, process=process, connection=connection)
    try:
        try:
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=float(timeout_seconds))
        except TimeoutError as exc:
            process.kill()
            await _wait_process(process)
            raise SandboxContainerCommandTimeoutError(float(timeout_seconds)) from exc
        exit_code = process.returncode if is_local_host(host) else process.exit_status
        return SandboxContainerCommandResult(output=(stdout or b"").decode(errors="replace"), exit_code=exit_code or 0)
    finally:
        running = _running_processes.get(process_id)
        if running is not None and running.process is process:
            _running_processes.pop(process_id, None)
        if connection is not None:
            connection.close()
            await connection.wait_closed()


async def cancel_running_process(execution_id: str) -> bool:
    running = _running_processes.get(execution_id)
    if running is None:
        return False
    process = running.process
    if getattr(process, "returncode", None) is None and getattr(process, "exit_status", None) is None:
        process.kill()
        await _wait_process(process)
    if running.connection is not None:
        running.connection.close()
        await running.connection.wait_closed()
    return True


async def _wait_process(process: Any) -> None:
    wait_closed = getattr(process, "wait_closed", None)
    if callable(wait_closed):
        await wait_closed()
        return
    await process.wait()


async def cancel_running_processes_for_container(container_id: int) -> bool:
    selected = [
        execution_id
        for execution_id, running in _running_processes.items()
        if running.container_id == container_id
    ]
    results = await asyncio.gather(
        *(cancel_running_process(execution_id) for execution_id in selected),
        return_exceptions=True,
    )
    return any(result is True for result in results)
