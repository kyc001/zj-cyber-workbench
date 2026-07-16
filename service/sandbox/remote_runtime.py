from __future__ import annotations

import posixpath
import re
import shlex
from collections.abc import Mapping

from database import get_async_session
from model.host.hosts import ManagedHost
from model.sandbox.containers import SandboxContainer
from service.host.connection import connect_managed_host
from service.host.hosts import DEFAULT_LOCAL_HOST_ID


def is_local_host(host: ManagedHost) -> bool:
    return host.id == DEFAULT_LOCAL_HOST_ID


def remote_workspace_relative(container_id: int) -> str:
    if container_id <= 0:
        raise ValueError("workspace id must be positive")
    return f".zj/sandboxes/{container_id}/workspace"


def remote_workspace_shell_path(container_id: int) -> str:
    return f'"$HOME/{remote_workspace_relative(container_id)}"'


def normalize_remote_path(raw_path: str) -> str:
    normalized = (raw_path or "/").replace("\\", "/").lstrip("/")
    parts = [part for part in normalized.split("/") if part not in {"", "."}]
    if any(part == ".." for part in parts):
        raise PermissionError("path escapes the portable workspace")
    return "/".join(parts)


async def resolve_container_host(container_id: int) -> tuple[SandboxContainer, ManagedHost]:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, container_id)
        if container is None:
            raise ValueError("portable workspace not found")
        host = await session.get(ManagedHost, container.host_id)
        if host is None:
            raise ValueError("workspace host not found")
        return container, host


async def ensure_remote_workspace(host: ManagedHost, container_id: int) -> None:
    connection = await connect_managed_host(host)
    try:
        result = await connection.run(
            f"mkdir -p -- {remote_workspace_shell_path(container_id)}",
            check=False,
        )
        if result.exit_status != 0:
            raise RuntimeError(result.stderr.strip() or "failed to create remote workspace")
    finally:
        connection.close()
        await connection.wait_closed()


async def remove_remote_workspace(host: ManagedHost, container_id: int) -> None:
    connection = await connect_managed_host(host)
    try:
        target = f'"$HOME/.zj/sandboxes/{container_id}"'
        result = await connection.run(f"rm -rf -- {target}", check=False)
        if result.exit_status != 0:
            raise RuntimeError(result.stderr.strip() or "failed to remove remote workspace")
    finally:
        connection.close()
        await connection.wait_closed()


async def remote_sftp_root(sftp, container_id: int) -> str:
    home = await sftp.realpath(".")
    root = posixpath.join(home, remote_workspace_relative(container_id))
    await sftp.makedirs(root, exist_ok=True)
    return root


def remote_command(
    container_id: int,
    command: str,
    environment: Mapping[str, str] | None = None,
) -> str:
    workspace = remote_workspace_shell_path(container_id)
    assignments: list[str] = []
    for key, value in (environment or {}).items():
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key) is None:
            raise ValueError(f"invalid remote environment variable: {key}")
        assignments.append(f"{key}={shlex.quote(value)}")
    env_command = "env" + (" " + " ".join(assignments) if assignments else "")
    return (
        f"mkdir -p -- {workspace} && cd -- {workspace} && "
        f"exec {env_command} sh -lc {shlex.quote(command)}"
    )
