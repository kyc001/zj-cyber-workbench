from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from database import get_async_session
from model.sandbox.containers import SandboxContainer
from schema.sandbox.containers import SandboxContainerStatus
from schema.system_user.users import SystemUserRole
from service.sandbox.records import load_sandbox_container_record
from service.sandbox.types import SandboxContainerRecord, SandboxContainerSelection, SandboxContainerToolBinding


@dataclass(frozen=True)
class ContainerStatusSnapshot:
    id: int
    host_id: int
    container_hash: str
    status: SandboxContainerStatus


_monitor_task: asyncio.Task | None = None
_invalidator: Callable[[int | None], Awaitable[None]] | None = None


def set_agent_tool_binding_invalidator(callback: Callable[[int | None], Awaitable[None]] | None) -> None:
    global _invalidator
    _invalidator = callback


async def save_sandbox_container_status(id: int, status: SandboxContainerStatus) -> SandboxContainerRecord | None:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, id)
        if container is None:
            return None
        container.status = status
        container.updated_at = datetime.now()
        session.add(container)
        await session.commit()
    await invalidate_agent_tool_bindings(id)
    return await load_sandbox_container_record(id)


async def resolve_sandbox_container_status(id: int) -> SandboxContainerStatus | None:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, id)
        return container.status if container is not None else None


def status_generation(container: SandboxContainer) -> int:
    return int(container.updated_at.timestamp() * 1_000_000)


async def invalidate_agent_tool_bindings(container_id: int) -> None:
    if _invalidator is not None:
        await _invalidator(container_id)


async def invalidate_all_agent_tool_bindings() -> None:
    if _invalidator is not None:
        await _invalidator(None)


async def start_sandbox_container_status_monitor() -> None:
    global _monitor_task
    if _monitor_task is None or _monitor_task.done():
        _monitor_task = asyncio.create_task(_monitor_loop(), name="portable-workspace-status-monitor")


async def stop_sandbox_container_status_monitor() -> None:
    global _monitor_task
    task, _monitor_task = _monitor_task, None
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _monitor_loop() -> None:
    while True:
        await asyncio.sleep(10)


async def resolve_sandbox_container_selection(id: int, user_id: int, user_role: SystemUserRole) -> SandboxContainerSelection | None:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, id)
        if container is None or (user_role != SystemUserRole.ADMIN and container.owner_id != user_id):
            return None
        return SandboxContainerSelection(id=id, generation=status_generation(container))


async def resolve_project_sandbox_container_selection(id: int) -> SandboxContainerSelection | None:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, id)
        return SandboxContainerSelection(id=id, generation=status_generation(container)) if container else None


async def resolve_sandbox_container_tool_binding(id: int, user_id: int, user_role: SystemUserRole) -> SandboxContainerToolBinding | None:
    selection = await resolve_sandbox_container_selection(id, user_id, user_role)
    if selection is None:
        return None
    status = await resolve_sandbox_container_status(id)
    return SandboxContainerToolBinding(id=id, generation=selection.generation) if status == SandboxContainerStatus.RUNNING else None


async def resolve_project_sandbox_container_tool_binding(id: int) -> SandboxContainerToolBinding | None:
    selection = await resolve_project_sandbox_container_selection(id)
    if selection is None or await resolve_sandbox_container_status(id) != SandboxContainerStatus.RUNNING:
        return None
    return SandboxContainerToolBinding(id=id, generation=selection.generation)
