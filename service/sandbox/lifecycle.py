from __future__ import annotations

import re
import secrets
import shutil
from datetime import datetime

from sqlmodel import select

from database import get_async_session
from model.egress_proxy.proxies import EgressProxy
from model.host.hosts import ManagedHost
from model.sandbox.containers import SandboxContainer
from model.sandbox.images import SandboxImage
from model.system_user.users import SystemUser
from schema.sandbox.containers import SandboxContainerEgressMode, SandboxContainerPortMapping, SandboxContainerStatus
from service.sandbox.local_runtime import SANDBOX_ROOT, sandbox_workspace
from service.sandbox.remote_runtime import (
    ensure_remote_workspace,
    is_local_host,
    remove_remote_workspace,
    resolve_container_host,
)
from service.sandbox.records import load_sandbox_container_record
from service.sandbox.types import SandboxContainerMutationResult


DEFAULT_PORTABLE_IMAGE_NAME = "zj-portable-tools"


def _container_name_prefix(image_name: str) -> str:
    short_name = image_name.rsplit("/", 1)[-1].split("@", 1)[0].split(":", 1)[0]
    normalized = re.sub(r"[^a-zA-Z0-9_.-]+", "-", short_name).strip("-.")
    return normalized or "workspace"


async def create_sandbox_container(
    host_id: int,
    image_id: int,
    egress_mode: SandboxContainerEgressMode,
    egress_proxy_id: int | None,
    owner_id: int,
    port_mappings: list[SandboxContainerPortMapping],
) -> SandboxContainerMutationResult:
    async with get_async_session() as session:
        host = await session.get(ManagedHost, host_id)
        image = await session.get(SandboxImage, image_id)
        owner = await session.get(SystemUser, owner_id)
        if host is None:
            return _missing("managed host not found")
        if image is None:
            return _missing("sandbox image not found")
        if owner is None:
            return _missing("system user not found")
        if egress_mode == SandboxContainerEgressMode.PROXY:
            proxy = await session.get(EgressProxy, egress_proxy_id) if egress_proxy_id else None
            if proxy is None:
                return _failed("egress proxy not found")
        elif egress_proxy_id is not None:
            return _failed("egress proxy is only valid in proxy mode")

        now = datetime.now()
        record = SandboxContainer(
            host_id=host_id,
            container_name=f"{_container_name_prefix(image.image_name)}-{secrets.token_hex(4)}",
            container_hash=secrets.token_hex(16),
            owner_id=owner_id,
            image_id=image_id,
            egress_mode=egress_mode,
            egress_proxy_id=egress_proxy_id,
            control_proxy_host_port=0,
            control_proxy_token=secrets.token_urlsafe(32),
            port_mappings=[mapping.model_dump() for mapping in port_mappings],
            status=SandboxContainerStatus.RUNNING,
            created_at=now,
            updated_at=now,
        )
        session.add(record)
        await session.commit()
        await session.refresh(record)
    if record.id is None:
        raise RuntimeError("portable workspace id was not generated")
    try:
        await _ensure_workspace(record.id)
    except Exception as exc:
        await _set_status(record.id, SandboxContainerStatus.ERROR, "workspace initialization failed")
        return await _mutation(record.id, False, str(exc) or "workspace initialization failed")
    return await _mutation(record.id, True, "portable workspace created")


async def start_sandbox_container(id: int) -> SandboxContainerMutationResult:
    return await _set_status(id, SandboxContainerStatus.RUNNING, "portable workspace started")


async def stop_sandbox_container(id: int) -> SandboxContainerMutationResult:
    return await _set_status(id, SandboxContainerStatus.STOPPED, "portable workspace stopped")


async def pause_sandbox_container(id: int) -> SandboxContainerMutationResult:
    return await _set_status(id, SandboxContainerStatus.PAUSED, "portable workspace paused")


async def resume_sandbox_container(id: int) -> SandboxContainerMutationResult:
    return await _set_status(id, SandboxContainerStatus.RUNNING, "portable workspace resumed")


async def update_sandbox_container_egress(
    id: int,
    *,
    egress_mode: SandboxContainerEgressMode,
    egress_proxy_id: int | None,
) -> SandboxContainerMutationResult:
    async with get_async_session() as session:
        record = await session.get(SandboxContainer, id)
        if record is None:
            return _missing("portable workspace not found")
        if egress_mode == SandboxContainerEgressMode.PROXY:
            if egress_proxy_id is None or await session.get(EgressProxy, egress_proxy_id) is None:
                return _failed("egress proxy not found")
        elif egress_proxy_id is not None:
            return _failed("egress proxy is only valid in proxy mode")
        record.egress_mode = egress_mode
        record.egress_proxy_id = egress_proxy_id
        record.updated_at = datetime.now()
        session.add(record)
        await session.commit()
    return await _mutation(id, True, "workspace egress updated")


async def delete_sandbox_container(id: int) -> bool:
    try:
        _, host = await resolve_container_host(id)
    except ValueError:
        return False
    if not is_local_host(host):
        await remove_remote_workspace(host, id)
    async with get_async_session() as session:
        record = await session.get(SandboxContainer, id)
        if record is None:
            return False
        await session.delete(record)
        await session.commit()
    shutil.rmtree(SANDBOX_ROOT / str(id), ignore_errors=True)
    return True


async def ensure_default_portable_workspace(owner_id: int) -> int:
    async with get_async_session() as session:
        host = await session.get(ManagedHost, 1)
        if host is None:
            raise RuntimeError("local managed host is missing")
        image = (await session.exec(select(SandboxImage).where(SandboxImage.image_name == DEFAULT_PORTABLE_IMAGE_NAME))).first()
        if image is None:
            now = datetime.now()
            image = SandboxImage(image_name=DEFAULT_PORTABLE_IMAGE_NAME, control_proxy_port=8000, supports_tor=False, created_at=now, updated_at=now)
            session.add(image)
            await session.commit()
            await session.refresh(image)
        existing = (await session.exec(
            select(SandboxContainer)
            .where(SandboxContainer.owner_id == owner_id)
            .where(SandboxContainer.image_id == image.id)
            .order_by(SandboxContainer.id)
        )).first()
    if existing is not None and existing.id is not None:
        if existing.status != SandboxContainerStatus.RUNNING:
            await _set_status(existing.id, SandboxContainerStatus.RUNNING, "portable workspace started")
        sandbox_workspace(existing.id)
        return existing.id
    created = await create_sandbox_container(
        host_id=1,
        image_id=image.id or 0,
        egress_mode=SandboxContainerEgressMode.DIRECT,
        egress_proxy_id=None,
        owner_id=owner_id,
        port_mappings=[],
    )
    if created.record is None or created.record.container.id is None:
        raise RuntimeError(created.message or "failed to create portable workspace")
    return created.record.container.id


async def _set_status(id: int, status: SandboxContainerStatus, message: str) -> SandboxContainerMutationResult:
    async with get_async_session() as session:
        record = await session.get(SandboxContainer, id)
        if record is None:
            return _missing("portable workspace not found")
        record.status = status
        record.updated_at = datetime.now()
        session.add(record)
        await session.commit()
    if status == SandboxContainerStatus.RUNNING:
        try:
            await _ensure_workspace(id)
        except Exception as exc:
            if status != SandboxContainerStatus.ERROR:
                await _set_status(id, SandboxContainerStatus.ERROR, "workspace initialization failed")
            return await _mutation(id, False, str(exc) or "workspace initialization failed")
    return await _mutation(id, True, message)


async def _ensure_workspace(id: int) -> None:
    _, host = await resolve_container_host(id)
    if is_local_host(host):
        sandbox_workspace(id)
    else:
        await ensure_remote_workspace(host, id)


async def _mutation(id: int, succeeded: bool, message: str) -> SandboxContainerMutationResult:
    return SandboxContainerMutationResult(record=await load_sandbox_container_record(id), succeeded=succeeded, message=message)


def _missing(message: str) -> SandboxContainerMutationResult:
    return SandboxContainerMutationResult(record=None, succeeded=False, message=message, not_found=True)


def _failed(message: str) -> SandboxContainerMutationResult:
    return SandboxContainerMutationResult(record=None, succeeded=False, message=message)
