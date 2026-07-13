from __future__ import annotations

import os
from pathlib import Path

from config import BUNDLED_TOOLS_DIR, WORKSPACE


SANDBOX_ROOT = WORKSPACE / "sandboxes"
AGENT_WORKSPACE_ROOT = WORKSPACE / "agent-workspaces"
PORTABLE_TOOLS_ROOT = WORKSPACE / "tools"


def sandbox_workspace(container_id: int) -> Path:
    if container_id <= 0:
        raise ValueError("sandbox container id must be positive")
    path = SANDBOX_ROOT / str(container_id) / "workspace"
    path.mkdir(parents=True, exist_ok=True)
    return path


def agent_workspace(session_id: str) -> Path:
    safe_id = "".join(char for char in session_id if char.isalnum() or char in "-_")[:128]
    if not safe_id:
        raise ValueError("invalid agent session id")
    path = AGENT_WORKSPACE_ROOT / safe_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_sandbox_path(container_id: int, raw_path: str, *, must_exist: bool = False) -> Path:
    root = sandbox_workspace(container_id).resolve()
    normalized = (raw_path or "/").replace("\\", "/")
    relative = normalized.lstrip("/")
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise PermissionError("path escapes the portable workspace") from exc
    if must_exist and not candidate.exists():
        raise FileNotFoundError(raw_path)
    return candidate


def display_sandbox_path(container_id: int, path: Path) -> str:
    root = sandbox_workspace(container_id).resolve()
    relative = path.resolve().relative_to(root).as_posix()
    return f"/{relative}" if relative else "/"


def shell_invocation(command: str) -> tuple[str, ...]:
    if os.name == "nt":
        return ("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command)
    return ("/bin/sh", "-lc", command)


def interactive_shell_invocation() -> tuple[str, ...]:
    if os.name == "nt":
        return ("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-")
    return ("/bin/sh", "-i")


def portable_tool_environment() -> dict[str, str]:
    directories: list[str] = []
    chrome_bin = ""
    extension_dir = ""
    for root in (PORTABLE_TOOLS_ROOT, BUNDLED_TOOLS_DIR):
        if root.is_dir():
            directories.append(str(root))
            directories.extend(str(path) for path in sorted(root.iterdir()) if path.is_dir())
            if not chrome_bin:
                chrome = next(root.glob("chrome/**/chrome.exe"), None)
                chrome_bin = str(chrome) if chrome is not None else ""
            if not extension_dir:
                manifest = next(root.glob("agent-browser-cli/**/manifest.json"), None)
                extension_dir = str(manifest.parent) if manifest is not None else ""
    existing = os.environ.get("PATH", "")
    environment = {
        "PATH": os.pathsep.join([*directories, existing]) if directories else existing,
        "PYTHONUTF8": "1",
    }
    if chrome_bin:
        environment["CHROME_BIN"] = chrome_bin
    if extension_dir:
        environment["ZJ_CHROME_EXTENSION_DIR"] = extension_dir
    return environment
