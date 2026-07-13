from __future__ import annotations

from sqlalchemy import String, cast, or_
from sqlmodel import select

from database import get_async_session
from model.egress_proxy.proxies import EgressProxy
from model.host.hosts import ManagedHost
from model.sandbox.containers import SandboxContainer
from model.sandbox.images import SandboxImage
from model.system_user.users import SystemUser
from schema.sandbox.containers import SandboxContainerCreateOptionsResponse, SandboxContainerHostOptionSchema, SandboxContainerSchema, SandboxContainerStatus
from schema.system_user.users import SystemUserRole
from service.common.pagination import Page, paginate_statement
from service.host.hosts import DEFAULT_LOCAL_HOST_ID
from service.sandbox.types import SandboxContainerRecord


def _base_statement():
    return (
        select(SandboxContainer, SandboxImage.image_name, SandboxImage.supports_tor, SandboxImage.control_proxy_port,
               SystemUser.username, ManagedHost.ip_address, EgressProxy)
        .join(SandboxImage, SandboxContainer.image_id == SandboxImage.id)
        .join(SystemUser, SandboxContainer.owner_id == SystemUser.id)
        .join(ManagedHost, SandboxContainer.host_id == ManagedHost.id)
        .outerjoin(EgressProxy, SandboxContainer.egress_proxy_id == EgressProxy.id)
    )


def _filter(statement, keyword: str):
    keyword = keyword.strip()
    if not keyword:
        return statement
    pattern = f"%{keyword}%"
    return statement.where(or_(
        SandboxContainer.container_name.ilike(pattern), SandboxContainer.container_hash.ilike(pattern),
        SandboxImage.image_name.ilike(pattern), ManagedHost.ip_address.ilike(pattern),
        SystemUser.username.ilike(pattern), cast(SandboxContainer.status, String).ilike(pattern),
    ))


def _record(row) -> SandboxContainerRecord:
    container, image_name, supports_tor, control_proxy_port, owner_username, host_ip, proxy = row
    label = "直接网络"
    if proxy is not None:
        label = f"代理：{proxy.proxy_host}:{proxy.proxy_port}"
    return SandboxContainerRecord(
        container=container, image_name=image_name, supports_tor=supports_tor,
        control_proxy_port=control_proxy_port, owner_username=owner_username,
        host_ip_address=host_ip, egress_label=label,
    )


async def load_sandbox_container_record(id: int) -> SandboxContainerRecord | None:
    async with get_async_session() as session:
        row = (await session.exec(_base_statement().where(SandboxContainer.id == id))).first()
        return _record(row) if row is not None else None


def sandbox_container_can_manage(container: SandboxContainer, user_id: int | None, user_role: SystemUserRole | None) -> bool:
    return user_role == SystemUserRole.ADMIN or (user_id is not None and container.owner_id == user_id)


def sandbox_container_schema(record: SandboxContainerRecord, *, user_id: int | None = None, user_role: SystemUserRole | None = None) -> SandboxContainerSchema:
    container = record.container
    return SandboxContainerSchema(
        id=container.id or 0, host_id=container.host_id, host_ip_address=record.host_ip_address,
        container_name=container.container_name, container_hash=container.container_hash,
        image_id=container.image_id, image_name=record.image_name, supports_tor=record.supports_tor,
        control_proxy_port=record.control_proxy_port, egress_mode=container.egress_mode,
        egress_proxy_id=container.egress_proxy_id, egress_label=record.egress_label,
        control_proxy_host_port=container.control_proxy_host_port, port_mappings=container.port_mappings,
        status=container.status, owner_id=container.owner_id, owner_username=record.owner_username,
        can_manage=sandbox_container_can_manage(container, user_id, user_role),
        created_at=container.created_at, updated_at=container.updated_at,
    )


async def _query(statement, page: int, size: int) -> Page[SandboxContainerRecord]:
    result = await paginate_statement(statement, page=page, size=size)
    return Page(page=result.page, size=result.size, total=result.total, items=[_record(row) for row in result.items])


async def query_sandbox_containers(user_id: int, user_role: SystemUserRole, page: int = 1, size: int = 100, keyword: str = "") -> Page[SandboxContainerRecord]:
    statement = _filter(_base_statement().order_by(SandboxContainer.id), keyword)
    if user_role != SystemUserRole.ADMIN:
        statement = statement.where(SandboxContainer.owner_id == user_id)
    return await _query(statement, page, size)


async def query_available_sandbox_containers(user_id: int, user_role: SystemUserRole, work_project_id: int | None = None, include_non_running: bool = False, page: int = 1, size: int = 100, keyword: str = "") -> Page[SandboxContainerRecord]:
    statement = _filter(_base_statement().order_by(SandboxContainer.id), keyword)
    if user_role != SystemUserRole.ADMIN:
        statement = statement.where(SandboxContainer.owner_id == user_id)
    if not include_non_running:
        statement = statement.where(SandboxContainer.status == SandboxContainerStatus.RUNNING)
    return await _query(statement, page, size)


async def sandbox_container_create_options() -> SandboxContainerCreateOptionsResponse:
    async with get_async_session() as session:
        hosts = (await session.exec(select(ManagedHost).order_by(ManagedHost.id))).all()
        images = (await session.exec(select(SandboxImage).order_by(SandboxImage.id))).all()
    return SandboxContainerCreateOptionsResponse(
        hosts=[SandboxContainerHostOptionSchema(
            id=host.id or 0,
            ip_address=host.ip_address,
            execution_backend="local" if host.id == DEFAULT_LOCAL_HOST_ID else "ssh",
        ) for host in hosts],
        images=images,
    )


async def sandbox_container_is_manageable_by_user(id: int, user_id: int, user_role: SystemUserRole) -> bool | None:
    async with get_async_session() as session:
        container = await session.get(SandboxContainer, id)
        if container is None:
            return None
        return sandbox_container_can_manage(container, user_id, user_role)
