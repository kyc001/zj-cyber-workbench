from __future__ import annotations

import re
from dataclasses import replace

from agents import RunContextWrapper, function_tool

from config import BUNDLED_SKILLS_DIR
from core.execution_guard import authorize_local_diagnostic
from core.runtime.context import AgentRuntimeContext
from core.sandbox import command_output
from core.sandbox.command_jobs import cancel_async_sandbox_command, start_async_sandbox_command
from schema.common.tool_results import ToolResultSchema, ToolResultStatusSchema, ToolResultTypeSchema
from schema.sandbox.async_jobs import SandboxAsyncJobStatus
from service.sandbox import async_jobs as sandbox_async_jobs
from service.sandbox.commands import SandboxContainerCommandTimeoutError, execute_sandbox_container_command
from service.sandbox.remote_runtime import is_local_host, resolve_container_host

_SYNC_COMMAND_TIMEOUT_SECONDS = 30
_ASYNC_COMMAND_TIMEOUT_SECONDS = 300
_MAX_OUTPUT_BYTES = 256 * 1024
_ASYNC_COMMAND_CONCURRENCY_LIMIT = 3
_SKILL_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
SKILLS_DIR = BUNDLED_SKILLS_DIR
_BLOCKED_COMMAND_PATTERNS = (
    r"\brm\s+-rf\b", r"\bdel\s+/[sq]\b", r"remove-item\s+.*-recurse", r"\bformat(-volume)?\b",
    r"\bshutdown\b", r"\breboot\b", r"\breg\s+(add|delete)\b", r"\bnet\s+user\b",
    r"\bsc\s+(delete|config|create)\b", r"\bchmod\s+777\b", r"\bmkfs\b",
)
_WINDOWS_NATIVE_SKILLS = {
    "agent-browser-cli", "amass", "archive-file-triage", "dns-whois", "dnsx",
    "ffuf", "gobuster", "httpx", "observer-ward", "sandbox-shell", "subfinder",
    "uv-python",
}
_LINUX_WORKSPACE_SKILLS = {
    "apktool", "binwalk", "checksec", "gdb-pwndbg", "ghidra", "hydra", "jadx",
    "nmap", "openssl", "pwntools", "seclists", "sqlmap", "strace-ltrace",
}


def _clamp_timeout(timeout_seconds: int | None, maximum: int) -> int:
    try:
        value = int(timeout_seconds or maximum)
    except (TypeError, ValueError):
        value = maximum
    return min(max(value, 1), maximum)


def _validate_command(command: str) -> str:
    value = command.strip()
    if not value:
        raise ValueError("命令不能为空")
    if len(value) > 32_000:
        raise ValueError("命令长度超过限制")
    lowered = value.lower()
    if any(re.search(pattern, lowered) for pattern in _BLOCKED_COMMAND_PATTERNS):
        raise ValueError("便携执行器已阻止潜在破坏性命令；请改用受控 Action")
    return value


def _ensure_container(context: AgentRuntimeContext) -> int:
    if context.sandbox_container_id is None:
        raise ValueError("本机会话尚未建立执行工作区")
    return context.sandbox_container_id


def _write_output(output_file: str, content: str) -> tuple[int, int]:
    clipped = content[:_MAX_OUTPUT_BYTES]
    path = command_output.local_output_path(output_file)
    path.write_text(clipped, encoding="utf-8")
    return len(clipped.encode()), len(clipped.splitlines())


def _command_result(*, status: SandboxAsyncJobStatus, output_file: str | None = None, output_bytes: int = 0, output_lines: int = 0, exit_code: int | None = None, run_id: str | None = None, error: str | None = None) -> str:
    return command_output.result_metadata(status=status, output_file=output_file, output_bytes=output_bytes, output_lines=output_lines, exit_code=exit_code, run_id=run_id, error=error).model_dump_json(exclude_none=True, exclude_defaults=True)


@function_tool
async def execute_sync_command(ctx: RunContextWrapper[AgentRuntimeContext], command: str, timeout_seconds: int = _SYNC_COMMAND_TIMEOUT_SECONDS) -> str:
    """在当前项目的便携本机工作区执行短时、只读诊断命令。"""
    try:
        command = _validate_command(command)
        authorize_local_diagnostic(ctx.context)
        container_id = _ensure_container(ctx.context)
        output_file = command_output.output_path_for_run(command_output.new_run_id())
        result = await execute_sandbox_container_command(container_id, command, _clamp_timeout(timeout_seconds, _SYNC_COMMAND_TIMEOUT_SECONDS))
        output_bytes, output_lines = _write_output(output_file, result.output)
        return _command_result(status=SandboxAsyncJobStatus.COMPLETED if result.exit_code == 0 else SandboxAsyncJobStatus.FAILED, output_file=output_file, output_bytes=output_bytes, output_lines=output_lines, exit_code=result.exit_code)
    except SandboxContainerCommandTimeoutError:
        return _command_result(status=SandboxAsyncJobStatus.FAILED, error="命令执行超时")
    except Exception as exc:
        return _command_result(status=SandboxAsyncJobStatus.FAILED, error=str(exc) or "命令执行失败")


@function_tool
async def execute_async_command(ctx: RunContextWrapper[AgentRuntimeContext], command: str, timeout_seconds: int = _ASYNC_COMMAND_TIMEOUT_SECONDS) -> str:
    """在当前项目工作区启动受控异步命令。"""
    try:
        command = _validate_command(command)
        authorize_local_diagnostic(ctx.context)
        _ensure_container(ctx.context)
        if not ctx.context.agent_instance_id:
            raise ValueError("异步命令需要有效的 Agent 实例")
        running_jobs = await sandbox_async_jobs.count_running_async_jobs_for_agent(
            session_id=ctx.context.session_id,
            agent_instance_id=ctx.context.agent_instance_id,
        )
        if running_jobs >= _ASYNC_COMMAND_CONCURRENCY_LIMIT:
            raise ValueError(f"每个 Agent 最多并发 {_ASYNC_COMMAND_CONCURRENCY_LIMIT} 个异步命令")
        run_id = command_output.new_run_id()
        output_file = command_output.output_path_for_run(run_id)
        await start_async_sandbox_command(
            run_id=run_id,
            context=replace(ctx.context),
            command=command,
            output_file=output_file,
            timeout_seconds=_clamp_timeout(timeout_seconds, _ASYNC_COMMAND_TIMEOUT_SECONDS),
        )
        return _command_result(status=SandboxAsyncJobStatus.RUNNING, output_file=output_file, run_id=run_id)
    except Exception as exc:
        return _command_result(status=SandboxAsyncJobStatus.FAILED, error=str(exc) or "异步命令启动失败")


@function_tool
async def read_sandbox_command_output(ctx: RunContextWrapper[AgentRuntimeContext], output_file: str, start_line: int = 1, line_count: int = 200) -> str:
    """读取命令输出文件的有限行片段。"""
    del ctx
    try:
        start, count, _ = command_output.normalize_read_range(start_line, line_count)
        lines = command_output.local_output_path(output_file).read_text(encoding="utf-8", errors="replace").splitlines()
        content = "\n".join(lines[start - 1:start - 1 + count])
        return command_output.output_chunk(output_file=output_file, start_line=start, line_count=count, content=content).model_dump_json()
    except Exception as exc:
        return _command_result(status=SandboxAsyncJobStatus.FAILED, error=str(exc) or "输出读取失败")


@function_tool
async def cancel_sandbox_async_job(ctx: RunContextWrapper[AgentRuntimeContext], run_id: str) -> str:
    """取消当前会话拥有的异步命令。"""
    snapshot = await sandbox_async_jobs.get_async_job(run_id.strip(), session_id=ctx.context.session_id)
    if snapshot is None or snapshot.agent_instance_id != ctx.context.agent_instance_id:
        return _command_result(status=SandboxAsyncJobStatus.FAILED, error="异步任务不存在")
    await cancel_async_sandbox_command(snapshot.run_id)
    latest = await sandbox_async_jobs.get_async_job(snapshot.run_id, session_id=ctx.context.session_id)
    return command_output.result_metadata_from_snapshot(latest or snapshot).model_dump_json(
        exclude_none=True,
        exclude_defaults=True,
    )


def _skill_result(status: ToolResultStatusSchema, output: str) -> str:
    return ToolResultSchema(status=status, type=ToolResultTypeSchema.SKILL_DETAIL, output=output).model_dump_json()


@function_tool
async def load_skill(ctx: RunContextWrapper[AgentRuntimeContext], name: str) -> str:
    """读取已随程序发布的工具技能说明和资源清单。"""
    skill_name = name.strip()
    if not _SKILL_NAME_PATTERN.fullmatch(skill_name):
        return _skill_result(ToolResultStatusSchema.ERROR, "技能名称格式无效")
    skill_root = SKILLS_DIR / skill_name
    skill_file = skill_root / "SKILL.md"
    if not skill_file.is_file():
        return _skill_result(ToolResultStatusSchema.ERROR, f"未找到技能：{skill_name}")
    body = skill_file.read_text(encoding="utf-8")
    resources = [str(path.relative_to(skill_root)).replace("\\", "/") for path in skill_root.rglob("*") if path.is_file() and path.name != "SKILL.md"]
    runtime_note = await _skill_runtime_note(ctx.context, skill_name)
    output = (
        f"## ZJ Execution Runtime\n\n{runtime_note}\n\n"
        f"## Skill Resource Root\n\n`skills/{skill_name}`\n\n"
        "## Skill Resource Files\n\n"
        + ("\n".join(f"- `{item}`" for item in sorted(resources)) or "None.")
        + f"\n\n{body}"
    )
    return _skill_result(ToolResultStatusSchema.SUCCESS, output)


async def _skill_runtime_note(context: AgentRuntimeContext, skill_name: str) -> str:
    container_id = context.sandbox_container_id
    if container_id is None:
        return "No execution workspace is selected. Select or create a workspace before running commands."
    try:
        _, host = await resolve_container_host(container_id)
    except Exception:
        return "The selected execution workspace is unavailable. Do not claim that commands were executed."
    if not is_local_host(host):
        return (
            f"This session uses the SSH Linux workspace on `{host.ip_address}`. "
            "Command tools execute there automatically in an isolated project directory. "
            "Confirm the required CLI is installed with `command -v` before using the examples below."
        )
    if skill_name in _LINUX_WORKSPACE_SKILLS:
        return (
            "This skill is not bundled in the Windows-local runtime. Create/select an SSH Linux "
            "execution workspace with this tool installed; do not attempt Linux commands in PowerShell "
            "and do not report a scan as completed from documentation alone."
        )
    if skill_name in _WINDOWS_NATIVE_SKILLS:
        return (
            "This session uses the Windows-local portable runtime. Command tools run in PowerShell; "
            "the CLI is added to PATH, but POSIX-only path and shell examples below must be translated "
            "to PowerShell syntax. Check `<tool> --help` before execution."
        )
    return (
        "This session uses the Windows-local portable runtime. Verify every referenced executable with "
        "`Get-Command` before use; switch to an SSH Linux workspace when the required CLI is unavailable."
    )
