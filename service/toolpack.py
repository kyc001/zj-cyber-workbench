from __future__ import annotations

import asyncio
import json
import shlex
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import uuid4

import asyncssh

from config import WORKSPACE
from logger import get_logger
from middleware.auth import AuthUser
from schema.action import RiskLevel
from schema.sandbox.containers import SandboxContainerStatus
from schema.system_user.users import SystemUserRole
from schema.toolpack import (
    ExecutionArtifact,
    ExecutionErrorCode,
    ExecutionResult,
    QueryToolpackToolsResponse,
    ToolBackend,
    ToolManifestSchema,
    ToolRunCancelResponse,
    ToolRunRequest,
    ToolRunSnapshot,
    ToolRunStatus,
    ToolSchema,
)
from service.host.hosts import DEFAULT_LOCAL_HOST_ID
from service.sandbox.commands import (
    SandboxContainerCommandResult,
    SandboxContainerCommandTimeoutError,
    cancel_running_process,
    execute_sandbox_container_command,
)
from service.sandbox.local_runtime import portable_tool_environment
from service.sandbox.records import sandbox_container_is_manageable_by_user
from service.sandbox.remote_runtime import resolve_container_host

logger = get_logger(__name__)

_MAX_STRUCTURED_STDOUT = 256 * 1024
_ARTIFACT_ROOT = WORKSPACE / "toolpack" / "artifacts"


@dataclass(frozen=True)
class _ToolDefinition:
    manifest: ToolManifestSchema
    install_hint: str
    build_args: Callable[[dict[str, Any]], list[str]]


@dataclass
class _RunningToolRun:
    snapshot: ToolRunSnapshot
    task: asyncio.Task[None]


_runs: dict[str, _RunningToolRun] = {}
_runs_lock = asyncio.Lock()


def _target_input_schema(required: str = "target") -> dict[str, Any]:
    return {
        "type": "object",
        "required": [required],
        "properties": {
            required: {"type": "string", "minLength": 1, "maxLength": 2048},
            "rps": {"type": "integer", "minimum": 1, "maximum": 50},
            "concurrency": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "additionalProperties": False,
    }


def _base_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "tool_id": {"type": "string"},
            "stdout": {"type": "string"},
            "records": {"type": "array"},
        },
        "required": ["tool_id", "stdout", "records"],
    }


_TOOLS: dict[str, _ToolDefinition] = {
    "local.httpx": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.httpx",
            name="httpx",
            description="Probe HTTP services from the local portable workspace.",
            backend=ToolBackend.LOCAL,
            executable="httpx",
            category="web-probe",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=60,
            max_timeout_seconds=120,
            input_schema=_target_input_schema(),
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "max_concurrency": 20, "requires_scope": True},
        ),
        install_hint="Install ProjectDiscovery httpx into portable-tools or PATH.",
        build_args=lambda payload: ["httpx", "-u", _required_text(payload, "target"), "-silent", "-json"],
    ),
    "local.dnsx": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.dnsx",
            name="dnsx",
            description="Resolve DNS records from the local portable workspace.",
            backend=ToolBackend.LOCAL,
            executable="dnsx",
            category="dns-probe",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=60,
            max_timeout_seconds=120,
            input_schema=_target_input_schema("domain"),
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "max_concurrency": 20, "requires_scope": True},
        ),
        install_hint="Install ProjectDiscovery dnsx into portable-tools or PATH.",
        build_args=lambda payload: ["dnsx", "-d", _required_text(payload, "domain"), "-silent", "-json"],
    ),
    "local.ffuf": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.ffuf",
            name="ffuf",
            description="Run a bounded ffuf content discovery job locally.",
            backend=ToolBackend.LOCAL,
            executable="ffuf",
            category="web-fuzz",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=120,
            max_timeout_seconds=300,
            input_schema={
                "type": "object",
                "required": ["url", "wordlist"],
                "properties": {
                    "url": {"type": "string", "minLength": 1, "maxLength": 2048},
                    "wordlist": {"type": "string", "minLength": 1, "maxLength": 4096},
                    "rps": {"type": "integer", "minimum": 1, "maximum": 50},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "requires_scope": True, "requires_fuzz_marker": True},
        ),
        install_hint="Install ffuf into portable-tools or PATH.",
        build_args=lambda payload: [
            "ffuf",
            "-u",
            _required_text(payload, "url"),
            "-w",
            _required_text(payload, "wordlist"),
            "-json",
            *_optional_rate(payload),
        ],
    ),
    "ssh.nmap": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="ssh.nmap",
            name="nmap",
            description="Run nmap from an SSH Linux workspace.",
            backend=ToolBackend.SSH,
            executable="nmap",
            category="network-scan",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=120,
            max_timeout_seconds=300,
            input_schema=_target_input_schema(),
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "max_concurrency": 20, "requires_scope": True},
        ),
        install_hint="Install nmap on the configured SSH Linux host.",
        build_args=lambda payload: ["nmap", "-oX", "-", _required_text(payload, "target")],
    ),
    "ssh.sqlmap": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="ssh.sqlmap",
            name="sqlmap",
            description="Run a bounded sqlmap probe from an SSH Linux workspace.",
            backend=ToolBackend.SSH,
            executable="sqlmap",
            category="web-sql",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=300,
            max_timeout_seconds=600,
            input_schema=_target_input_schema(),
            output_schema=_base_output_schema(),
            policy={"max_rps": 10, "max_concurrency": 4, "requires_scope": True},
        ),
        install_hint="Install sqlmap on the configured SSH Linux host.",
        build_args=lambda payload: ["sqlmap", "-u", _required_text(payload, "target"), "--batch"],
    ),
}


async def list_toolpack_tools(sandbox_container_id: int | None = None) -> QueryToolpackToolsResponse:
    tools = [
        await _tool_schema(definition, sandbox_container_id=sandbox_container_id)
        for definition in _TOOLS.values()
    ]
    return QueryToolpackToolsResponse(tools=tools)


async def start_tool_run(tool_id: str, request: ToolRunRequest, user: AuthUser) -> ToolRunSnapshot:
    definition = _tool_definition(tool_id)
    await _ensure_container_permission(request.sandbox_container_id, user)
    run_id = uuid4().hex
    now = datetime.now()
    snapshot = ToolRunSnapshot(
        run_id=run_id,
        tool_id=tool_id,
        sandbox_container_id=request.sandbox_container_id,
        status=ToolRunStatus.RUNNING,
        started_at=now,
    )
    task = asyncio.create_task(
        _execute_tool_run(run_id, definition, request, started_at=now),
        name=f"toolpack-run-{run_id}",
    )
    async with _runs_lock:
        _runs[run_id] = _RunningToolRun(snapshot=snapshot, task=task)
    task.add_done_callback(lambda completed: _finish_task(run_id, completed))
    return snapshot


async def get_tool_run(run_id: str) -> ToolRunSnapshot | None:
    async with _runs_lock:
        running = _runs.get(run_id)
        return running.snapshot.model_copy(deep=True) if running is not None else None


async def cancel_tool_run(run_id: str) -> ToolRunCancelResponse:
    async with _runs_lock:
        running = _runs.get(run_id)
    if running is None:
        return ToolRunCancelResponse(run_id=run_id, canceled=False, status=ToolRunStatus.FAILED.value)
    await cancel_running_process(run_id)
    if not running.task.done():
        running.task.cancel()
    await asyncio.gather(running.task, return_exceptions=True)
    async with _runs_lock:
        status = _runs[run_id].snapshot.status if run_id in _runs else ToolRunStatus.CANCELED
    return ToolRunCancelResponse(run_id=run_id, canceled=True, status=status.value)


def resolve_tool_artifact_path(artifact_id: str):
    safe_id = artifact_id.strip()
    if not safe_id or "/" in safe_id or "\\" in safe_id or safe_id in {".", ".."}:
        raise ValueError("invalid artifact id")
    path = (_ARTIFACT_ROOT / f"{safe_id}.txt").resolve()
    root = _ARTIFACT_ROOT.resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise PermissionError("artifact path escapes toolpack artifact root") from exc
    if not path.is_file():
        raise FileNotFoundError("tool artifact not found")
    return path


async def _execute_tool_run(
    run_id: str,
    definition: _ToolDefinition,
    request: ToolRunRequest,
    *,
    started_at: datetime,
) -> None:
    try:
        await _validate_backend(definition, request.sandbox_container_id)
        _validate_policy(definition, request.input)
        if definition.manifest.backend == ToolBackend.LOCAL and not _local_tool_path(definition.manifest.executable):
            await _store_result(
                run_id,
                _error_result(
                    run_id,
                    started_at,
                    ExecutionErrorCode.TOOL_MISSING,
                    f"{definition.manifest.executable} is not installed",
                ),
                ToolRunStatus.FAILED,
            )
            return
        command = _shell_command(definition.build_args(request.input))
        timeout = min(
            request.timeout_seconds or definition.manifest.default_timeout_seconds,
            definition.manifest.max_timeout_seconds,
        )
        command_result = await execute_sandbox_container_command(
            request.sandbox_container_id,
            _with_tool_precheck(definition, command),
            timeout,
            execution_id=run_id,
        )
        result = _result_from_command(
            run_id,
            definition,
            command_result,
            started_at=started_at,
            finished_at=datetime.now(),
        )
        await _store_result(run_id, result, ToolRunStatus.COMPLETED if result.ok else ToolRunStatus.FAILED)
    except asyncio.CancelledError:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.CANCELED, "tool run canceled"),
            ToolRunStatus.CANCELED,
        )
        raise
    except SandboxContainerCommandTimeoutError:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.TIMEOUT, "tool run timed out"),
            ToolRunStatus.FAILED,
        )
    except PermissionError as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.POLICY_DENIED, str(exc)),
            ToolRunStatus.FAILED,
        )
    except NotImplementedError as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.PLATFORM_UNSUPPORTED, str(exc)),
            ToolRunStatus.FAILED,
        )
    except asyncssh.HostKeyNotVerifiable:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.HOST_KEY_CHANGED, "SSH host key is not trusted"),
            ToolRunStatus.FAILED,
        )
    except asyncssh.PermissionDenied:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.AUTH_FAILED, "SSH authentication failed"),
            ToolRunStatus.FAILED,
        )
    except (OSError, asyncssh.Error) as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.CONNECT_FAILED, str(exc) or "connection failed"),
            ToolRunStatus.FAILED,
        )
    except Exception as exc:
        logger.exception("toolpack run failed: %s", run_id)
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.PROCESS_FAILED, str(exc) or "tool run failed"),
            ToolRunStatus.FAILED,
        )


async def _tool_schema(
    definition: _ToolDefinition,
    *,
    sandbox_container_id: int | None,
) -> ToolSchema:
    available: bool | None = None
    message = ""
    if definition.manifest.backend == ToolBackend.LOCAL:
        available = _local_tool_path(definition.manifest.executable) is not None
        message = "available" if available else "missing from portable-tools and PATH"
    elif sandbox_container_id is None:
        message = "availability requires an SSH workspace"
    return ToolSchema(
        id=definition.manifest.id,
        name=definition.manifest.name,
        description=definition.manifest.description,
        backend=definition.manifest.backend,
        category=definition.manifest.category,
        available=available,
        availability_message=message,
        install_hint=definition.install_hint,
        manifest=definition.manifest,
    )


def _tool_definition(tool_id: str) -> _ToolDefinition:
    try:
        return _TOOLS[tool_id]
    except KeyError as exc:
        raise FileNotFoundError("tool not found") from exc


async def _ensure_container_permission(container_id: int, user: AuthUser) -> None:
    manageable = await sandbox_container_is_manageable_by_user(
        id=container_id,
        user_id=user.id,
        user_role=user.role,
    )
    if manageable is None:
        raise FileNotFoundError("portable workspace not found")
    if not manageable and user.role != SystemUserRole.ADMIN:
        raise PermissionError("no permission to use this portable workspace")


async def _validate_backend(definition: _ToolDefinition, container_id: int) -> None:
    container, host = await resolve_container_host(container_id)
    if container.status != SandboxContainerStatus.RUNNING:
        raise PermissionError("portable workspace is not running")
    is_local = host.id == DEFAULT_LOCAL_HOST_ID
    if definition.manifest.backend == ToolBackend.LOCAL and not is_local:
        raise NotImplementedError("local tools must run in a local workspace")
    if definition.manifest.backend == ToolBackend.SSH and is_local:
        raise NotImplementedError("Linux-heavy tools require an SSH workspace")


def _validate_policy(definition: _ToolDefinition, payload: dict[str, Any]) -> None:
    schema = definition.manifest.input_schema
    for field in schema.get("required", []):
        _required_text(payload, str(field))
    max_rps = int(definition.manifest.policy.get("max_rps", 50))
    max_concurrency = int(definition.manifest.policy.get("max_concurrency", 20))
    if int(payload.get("rps") or 1) > max_rps:
        raise PermissionError(f"rps exceeds policy limit {max_rps}")
    if int(payload.get("concurrency") or 1) > max_concurrency:
        raise PermissionError(f"concurrency exceeds policy limit {max_concurrency}")
    if definition.manifest.id == "local.ffuf" and "FUZZ" not in _required_text(payload, "url"):
        raise PermissionError("ffuf url must contain FUZZ marker")


def _required_text(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str):
        raise ValueError(f"{field} is required")
    value = value.strip()
    if not value:
        raise ValueError(f"{field} is required")
    if len(value) > 4096 or any(ord(char) < 32 for char in value):
        raise ValueError(f"{field} is invalid")
    return value


def _optional_rate(payload: dict[str, Any]) -> list[str]:
    rps = payload.get("rps")
    if rps is None:
        return []
    return ["-rate", str(max(1, min(int(rps), 50)))]


def _local_tool_path(executable: str) -> str | None:
    return shutil.which(executable, path=portable_tool_environment().get("PATH"))


def _shell_command(tokens: list[str]) -> str:
    return " ".join(shlex.quote(token) for token in tokens)


def _with_tool_precheck(definition: _ToolDefinition, command: str) -> str:
    executable = shlex.quote(definition.manifest.executable)
    return f"command -v {executable} >/dev/null 2>&1 || exit 127; exec {command}"


def _result_from_command(
    run_id: str,
    definition: _ToolDefinition,
    command_result: SandboxContainerCommandResult,
    *,
    started_at: datetime,
    finished_at: datetime,
) -> ExecutionResult:
    output = command_result.output or ""
    if command_result.exit_code == 127:
        return ExecutionResult(
            ok=False,
            execution_id=run_id,
            summary=f"{definition.manifest.executable} is not installed",
            structured={"tool_id": definition.manifest.id, "records": [], "stdout": ""},
            exit_code=command_result.exit_code,
            started_at=started_at,
            finished_at=finished_at,
            error_code=ExecutionErrorCode.TOOL_MISSING,
        )
    artifact_refs: list[ExecutionArtifact] = []
    truncated = len(output.encode()) > _MAX_STRUCTURED_STDOUT
    structured_stdout = output
    if truncated:
        artifact_refs.append(_write_artifact(run_id, output))
        structured_stdout = output.encode()[:_MAX_STRUCTURED_STDOUT].decode(errors="replace")
    records = _parse_output_records(output)
    ok = command_result.exit_code == 0
    return ExecutionResult(
        ok=ok,
        execution_id=run_id,
        summary="tool completed" if ok else "tool exited with a non-zero status",
        structured={
            "tool_id": definition.manifest.id,
            "stdout": structured_stdout,
            "records": records,
        },
        artifact_refs=artifact_refs,
        exit_code=command_result.exit_code,
        started_at=started_at,
        finished_at=finished_at,
        truncated=truncated,
        error_code=None if ok else ExecutionErrorCode.PROCESS_FAILED,
    )


def _parse_output_records(output: str) -> list[Any]:
    records: list[Any] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            records.append(json.loads(stripped))
        except ValueError:
            records.append({"line": stripped})
    return records


def _write_artifact(run_id: str, output: str) -> ExecutionArtifact:
    _ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    path = _ARTIFACT_ROOT / f"{run_id}.stdout.txt"
    path.write_text(output, encoding="utf-8")
    return ExecutionArtifact(
        id=path.stem,
        path=str(path.relative_to(WORKSPACE)),
        media_type="text/plain",
        size=path.stat().st_size,
    )


def _error_result(
    run_id: str,
    started_at: datetime,
    error_code: ExecutionErrorCode,
    summary: str,
) -> ExecutionResult:
    finished_at = datetime.now()
    return ExecutionResult(
        ok=False,
        execution_id=run_id,
        summary=summary,
        structured={"records": []},
        artifact_refs=[],
        exit_code=None,
        started_at=started_at,
        finished_at=finished_at,
        truncated=False,
        error_code=error_code,
    )


async def _store_result(run_id: str, result: ExecutionResult, status: ToolRunStatus) -> None:
    async with _runs_lock:
        running = _runs.get(run_id)
        if running is None:
            return
        running.snapshot.status = status
        running.snapshot.result = result
        running.snapshot.finished_at = result.finished_at


def _finish_task(run_id: str, task: asyncio.Task[None]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("toolpack task failed: %s", run_id)
