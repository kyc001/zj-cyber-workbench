from __future__ import annotations

import getpass
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import String, cast, or_
from sqlmodel import select

from database import get_async_session
from model.host.hosts import ManagedHost
from model.sandbox.containers import SandboxContainer
from schema.host.hosts import ManagedHostImageSchema, PullManagedHostImageResultSchema
from service.common.pagination import Page, paginate_statement


DEFAULT_LOCAL_HOST_ID = 1


@dataclass(frozen=True)
class DeleteManagedHostResult:
    deleted: bool
    not_found: bool = False
    message: str = ""


@dataclass(frozen=True)
class UpdateManagedHostResult:
    host: ManagedHost | None
    not_found: bool = False
    message: str = ""


async def create_managed_host(
    *,
    ip_address: str,
    ssh_port: int,
    host_account: str,
    host_password: str,
) -> ManagedHost:
    now = datetime.now()
    host = ManagedHost(
        ip_address=ip_address,
        ssh_port=ssh_port,
        host_account=host_account,
        host_password=host_password,
        created_at=now,
        updated_at=now,
    )
    async with get_async_session() as session:
        session.add(host)
        await session.commit()
        await session.refresh(host)
    return host


async def update_managed_host(
    *,
    id: int,
    ip_address: str | None = None,
    ssh_port: int | None = None,
    host_account: str | None = None,
    host_password: str | None = None,
) -> UpdateManagedHostResult:
    async with get_async_session() as session:
        host = await session.get(ManagedHost, id)
        if host is None:
            return UpdateManagedHostResult(host=None, not_found=True, message="managed host not found")
        for name, value in (
            ("ip_address", ip_address), ("ssh_port", ssh_port), ("host_account", host_account),
            ("host_password", host_password),
        ):
            if value is not None:
                setattr(host, name, value)
        host.updated_at = datetime.now()
        session.add(host)
        await session.commit()
        await session.refresh(host)
        return UpdateManagedHostResult(host=host)


async def delete_managed_host(id: int) -> DeleteManagedHostResult:
    if id == DEFAULT_LOCAL_HOST_ID:
        return DeleteManagedHostResult(deleted=False, message="default local host cannot be deleted")
    async with get_async_session() as session:
        host = await session.get(ManagedHost, id)
        if host is None:
            return DeleteManagedHostResult(deleted=False, not_found=True, message="managed host not found")
        result = await session.exec(select(SandboxContainer.id).where(SandboxContainer.host_id == id).limit(1))
        if result.first() is not None:
            return DeleteManagedHostResult(deleted=False, message="managed host is used by sandbox containers")
        await session.delete(host)
        await session.commit()
    return DeleteManagedHostResult(deleted=True)


async def query_managed_hosts(page: int = 1, size: int = 100, keyword: str = "") -> Page[ManagedHost]:
    statement = select(ManagedHost).order_by(ManagedHost.id)
    keyword = keyword.strip()
    if keyword:
        pattern = f"%{keyword}%"
        statement = statement.where(
            or_(
                ManagedHost.ip_address.ilike(pattern),
                ManagedHost.host_account.ilike(pattern),
                cast(ManagedHost.ssh_port, String).ilike(pattern),
            )
        )
    return await paginate_statement(statement, page=page, size=size)


async def query_managed_host_by_id(id: int) -> ManagedHost | None:
    async with get_async_session() as session:
        return await session.get(ManagedHost, id)


async def ensure_local_managed_host() -> ManagedHost:
    username = _detect_local_username()
    async with get_async_session() as session:
        host = await session.get(ManagedHost, DEFAULT_LOCAL_HOST_ID)
        if host is None:
            now = datetime.now()
            host = ManagedHost(
                id=DEFAULT_LOCAL_HOST_ID,
                ip_address="127.0.0.1",
                ssh_port=22,
                host_account=username,
                host_password="",
                created_at=now,
                updated_at=now,
            )
            session.add(host)
            await session.commit()
            await session.refresh(host)
        return host


def _detect_local_username() -> str:
    try:
        return getpass.getuser()
    except Exception:
        return ""


async def list_managed_host_images(id: int) -> list[ManagedHostImageSchema] | None:
    host = await query_managed_host_by_id(id)
    if host is None:
        return None
    return []


async def pull_managed_host_images(id: int, image_names: list[str]) -> list[PullManagedHostImageResultSchema] | None:
    host = await query_managed_host_by_id(id)
    if host is None:
        return None
    return [PullManagedHostImageResultSchema(image_name=name, success=False, message="Docker is disabled; use a local tool workspace") for name in image_names]


async def delete_managed_host_image(id: int, image_id: str, force: bool = False) -> str | None:
    if await query_managed_host_by_id(id) is None:
        return "managed host not found"
    return "Docker image management is disabled in portable mode"
