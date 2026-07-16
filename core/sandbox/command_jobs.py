from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass

from core.runtime.context import AgentRuntimeContext
from core.sandbox import command_output
from logger import get_logger
from service.sandbox import async_jobs as sandbox_async_jobs
from service.sandbox.commands import (
    SandboxContainerCommandTimeoutError,
    cancel_running_process,
    cancel_running_processes_for_container,
    execute_sandbox_container_command,
)


logger = get_logger(__name__)


@dataclass
class _AsyncCommandJob:
    task: asyncio.Task[None]
    session_id: str
    agent_instance_id: str
    container_id: int


_jobs: dict[str, _AsyncCommandJob] = {}
_jobs_lock = asyncio.Lock()
_AsyncCommandJobPredicate = Callable[[str, _AsyncCommandJob], bool]


async def start_async_sandbox_runtime() -> None:
    await sandbox_async_jobs.mark_stale_running_async_jobs_failed()


async def start_async_sandbox_command(
    *,
    run_id: str,
    context: AgentRuntimeContext,
    command: str,
    output_file: str,
    timeout_seconds: int,
    wrapped_command: str | None = None,
    stat_command: str | None = None,
) -> None:
    if context.sandbox_container_id is None:
        raise ValueError("本机会话尚未建立执行工作区")
    await sandbox_async_jobs.create_async_job(
        run_id=run_id, session_id=context.session_id, agent_code=context.agent_code,
        agent_instance_id=context.agent_instance_id, command=command, output_file=output_file,
        nested_for_agent_code=context.nested_for_agent_code, nested_call_id=context.nested_call_id,
        sandbox_container_id=context.sandbox_container_id, sandbox_container_generation=context.sandbox_container_generation,
        sandbox_skill_metadata=context.sandbox_skill_metadata,
        allowed_targets=context.allowed_targets, allowed_action_types=context.allowed_action_types,
        scope_id=context.scope_id,
    )
    task = asyncio.create_task(_run_async(run_id, context, command, output_file, timeout_seconds), name=f"portable-async-command-{run_id}")
    async with _jobs_lock:
        _jobs[run_id] = _AsyncCommandJob(
            task=task,
            session_id=context.session_id,
            agent_instance_id=context.agent_instance_id,
            container_id=context.sandbox_container_id,
        )
    task.add_done_callback(lambda completed: _finish_async_job(run_id, completed))


async def _run_async(run_id: str, context: AgentRuntimeContext, command: str, output_file: str, timeout_seconds: int) -> None:
    container_id = context.sandbox_container_id
    if container_id is None:
        await sandbox_async_jobs.fail_async_job(run_id, "本机会话尚未建立执行工作区")
        return
    try:
        result = await execute_sandbox_container_command(
            container_id,
            command,
            timeout_seconds,
            execution_id=run_id,
        )
        output_bytes, output_lines = _write_output(output_file, result.output)
        snapshot = await sandbox_async_jobs.complete_async_job(run_id, exit_code=result.exit_code, output_bytes=output_bytes, output_lines=output_lines)
        await _resume_owner(snapshot)
    except asyncio.CancelledError:
        await cancel_running_process(run_id)
        snapshot = await sandbox_async_jobs.cancel_async_job(run_id, "任务已取消")
        await _resume_owner(snapshot)
        raise
    except SandboxContainerCommandTimeoutError:
        snapshot = await sandbox_async_jobs.fail_async_job(run_id, "命令执行超时")
        await _resume_owner(snapshot)
    except Exception as exc:
        logger.exception("portable async command failed: %s", run_id)
        snapshot = await sandbox_async_jobs.fail_async_job(run_id, str(exc) or "异步命令失败")
        await _resume_owner(snapshot)


def _write_output(output_file: str, content: str) -> tuple[int, int]:
    path = command_output.local_output_path(output_file)
    clipped = content[:256 * 1024]
    path.write_text(clipped, encoding="utf-8")
    return len(clipped.encode()), len(clipped.splitlines())


async def _resume_owner(snapshot) -> None:
    if snapshot is None:
        return
    try:
        from core.delegation.subagents import resume_target_instance
        await resume_target_instance(snapshot.session_id, snapshot.agent_instance_id)
    except Exception:
        logger.debug("owner resume skipped for async job", exc_info=True)


async def cancel_async_sandbox_command(run_id: str) -> bool:
    runtime_canceled = await _cancel_runtime_jobs(lambda candidate, _: candidate == run_id)
    if runtime_canceled:
        return True
    return await sandbox_async_jobs.cancel_async_job(run_id, "任务已取消") is not None


async def cancel_agent_async_sandbox_commands(*, session_id: str, agent_instance_id: str) -> bool:
    runtime_canceled = await _cancel_runtime_jobs(
        lambda _, job: job.session_id == session_id and job.agent_instance_id == agent_instance_id
    )
    snapshots = await sandbox_async_jobs.cancel_running_async_jobs_for_agent(session_id=session_id, agent_instance_id=agent_instance_id, error="任务已取消")
    return runtime_canceled or bool(snapshots)


async def cancel_sandbox_async_commands(container_id: int) -> bool:
    runtime_canceled = await _cancel_runtime_jobs(lambda _, job: job.container_id == container_id)
    await cancel_running_processes_for_container(container_id)
    snapshots = await sandbox_async_jobs.cancel_running_async_jobs_for_container(container_id, "任务已取消")
    return runtime_canceled or bool(snapshots)


async def cancel_session_async_sandbox_commands(session_id: str) -> bool:
    runtime_canceled = await _cancel_runtime_jobs(lambda _, job: job.session_id == session_id)
    snapshots = await sandbox_async_jobs.cancel_running_async_jobs_for_session(session_id, "任务已取消")
    return runtime_canceled or bool(snapshots)


async def stop_async_sandbox_commands() -> None:
    await _cancel_runtime_jobs(lambda _, __: True)
    await sandbox_async_jobs.cancel_running_async_jobs("后端停止，任务已取消")


async def _cancel_runtime_jobs(predicate: _AsyncCommandJobPredicate) -> bool:
    async with _jobs_lock:
        selected = [
            (run_id, job)
            for run_id, job in _jobs.items()
            if predicate(run_id, job)
        ]
        for run_id, _ in selected:
            _jobs.pop(run_id, None)
    if not selected:
        return False
    for run_id, job in selected:
        await cancel_running_process(run_id)
        if not job.task.done():
            job.task.cancel()
    await asyncio.gather(*(job.task for _, job in selected), return_exceptions=True)
    return True


def _finish_async_job(run_id: str, task: asyncio.Task[None]) -> None:
    _jobs.pop(run_id, None)
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("portable async command task failed: %s", run_id)
