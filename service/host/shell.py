from __future__ import annotations

import asyncio
import inspect
import os
from dataclasses import dataclass
from typing import Any

from config import WORKSPACE
from model.host.hosts import ManagedHost
from service.host.connection import connect_managed_host
from service.host.hosts import DEFAULT_LOCAL_HOST_ID, query_managed_host_by_id
from service.sandbox.local_runtime import portable_tool_environment


_DEFAULT_SHELL_ROWS = 24
_DEFAULT_SHELL_COLS = 80


@dataclass
class HostShellSession:
    connection: Any
    process: Any
    closed: bool = False

    def shutdown(self) -> None:
        if not self.closed:
            self.process.close()

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self.process.close()
            await self.process.wait_closed()
        finally:
            self.connection.close()
            await self.connection.wait_closed()


@dataclass
class LocalShellSession:
    process: asyncio.subprocess.Process
    closed: bool = False

    def shutdown(self) -> None:
        if self.process.returncode is None:
            self.process.terminate()

    async def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        if self.process.returncode is None:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=2)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()


ShellSession = HostShellSession | LocalShellSession


async def resolve_shell_host(id: int) -> ManagedHost | None:
    return await query_managed_host_by_id(id)


async def open_host_shell(
    host: ManagedHost,
    rows: int = _DEFAULT_SHELL_ROWS,
    cols: int = _DEFAULT_SHELL_COLS,
) -> ShellSession:
    if host.id == DEFAULT_LOCAL_HOST_ID:
        shell = "powershell.exe" if os.name == "nt" else os.environ.get("SHELL", "/bin/sh")
        args = ["-NoLogo", "-NoProfile"] if os.name == "nt" else []
        process = await asyncio.create_subprocess_exec(
            shell,
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=WORKSPACE,
            env={**os.environ, **portable_tool_environment()},
        )
        return LocalShellSession(process=process)
    return await _open_ssh_shell(host, rows, cols)


async def _open_ssh_shell(host: ManagedHost, rows: int, cols: int) -> HostShellSession:
    connection = await connect_managed_host(host)
    try:
        process = await connection.create_process(
            request_pty=True,
            term_type="xterm-256color",
            term_size=(cols, rows),
            encoding=None,
        )
    except Exception:
        connection.close()
        await connection.wait_closed()
        raise
    return HostShellSession(connection=connection, process=process)


async def resize_host_shell(session: ShellSession, rows: int, cols: int) -> None:
    if isinstance(session, HostShellSession):
        session.process.change_terminal_size(max(1, min(cols, 500)), max(1, min(rows, 300)))


async def read_host_shell(session: ShellSession) -> bytes:
    try:
        if isinstance(session, LocalShellSession):
            if session.process.stdout is None:
                return b""
            return await session.process.stdout.read(4096)
        data = await session.process.stdout.read(4096)
        return data.encode() if isinstance(data, str) else (data or b"")
    except (OSError, ValueError):
        return b""


async def write_host_shell(session: ShellSession, data: str) -> None:
    if not data:
        return
    payload = data.encode()
    stream = session.process.stdin
    if stream is None:
        return
    stream.write(payload)
    drain = getattr(stream, "drain", None)
    if callable(drain):
        result = drain()
        if inspect.isawaitable(result):
            await result
