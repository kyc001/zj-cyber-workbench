from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import asyncssh

from database import get_async_session
from model.sandbox.containers import SandboxContainer
from schema.sandbox.containers import SandboxContainerStatus
from service.sandbox.egress import resolve_portable_process_environment
from service.sandbox.local_runtime import (
    interactive_shell_invocation,
    portable_tool_environment,
    sandbox_workspace,
)
from service.sandbox.remote_runtime import connect_managed_host, is_local_host, remote_command, resolve_container_host


@dataclass
class ContainerShellSession:
    process: Any
    connection: Any | None = None
    remote: bool = False
    closed: bool = False

    def shutdown(self) -> None:
        if getattr(self.process, "returncode", None) is None and getattr(self.process, "exit_status", None) is None:
            self.process.terminate()

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.shutdown()
        try:
            wait_closed = getattr(self.process, "wait_closed", None)
            waiter = wait_closed() if callable(wait_closed) else self.process.wait()
            await asyncio.wait_for(waiter, timeout=2)
        except TimeoutError:
            self.process.kill()
        finally:
            if self.connection is not None:
                self.connection.close()
                await self.connection.wait_closed()


async def resolve_shell_container(id: int) -> SandboxContainer | None:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, id)
        return container if container is not None and container.status == SandboxContainerStatus.RUNNING else None


async def open_container_shell(id: int, rows: int = 24, cols: int = 80) -> ContainerShellSession:
    container, host = await resolve_container_host(id)
    if container.status != SandboxContainerStatus.RUNNING:
        raise ValueError("portable workspace not found or not running")
    egress_environment = await resolve_portable_process_environment(container)
    if is_local_host(host):
        process = await asyncio.create_subprocess_exec(
            *interactive_shell_invocation(),
            cwd=sandbox_workspace(id),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={
                **os.environ,
                **portable_tool_environment(),
                **egress_environment,
                "ZJ_SANDBOX_ID": str(id),
            },
        )
        return ContainerShellSession(process=process)
    connection = await connect_managed_host(host)
    try:
        process = await connection.create_process(
            remote_command(
                id,
                'exec "${SHELL:-/bin/sh}" -i',
                {**egress_environment, "ZJ_SANDBOX_ID": str(id)},
            ),
            request_pty=True,
            term_type="xterm-256color",
            term_size=(cols, rows),
            encoding=None,
            stderr=asyncssh.STDOUT,
        )
    except Exception:
        connection.close()
        await connection.wait_closed()
        raise
    return ContainerShellSession(process=process, connection=connection, remote=True)


async def resize_container_shell(session: ContainerShellSession, rows: int, cols: int) -> None:
    if session.remote:
        session.process.change_terminal_size(max(1, min(cols, 500)), max(1, min(rows, 300)))


async def read_container_shell(session: ContainerShellSession) -> bytes:
    if session.process.stdout is None:
        return b""
    try:
        data = await session.process.stdout.read(4096)
        return data.encode() if isinstance(data, str) else (data or b"")
    except (OSError, ValueError, asyncio.CancelledError):
        return b""


async def write_container_shell(session: ContainerShellSession, data: str) -> None:
    if session.process.stdin is None or not data:
        return
    session.process.stdin.write(data.encode())
    drain = getattr(session.process.stdin, "drain", None)
    if callable(drain):
        await drain()
