from __future__ import annotations

import getpass
from dataclasses import dataclass
from datetime import datetime

import asyncssh
from sqlalchemy import String, cast, or_
from sqlmodel import select

from database import get_async_session
from model.host.hosts import ManagedHost
from model.sandbox.containers import SandboxContainer
from schema.host.hosts import ManagedHostImageSchema, ManagedHostKeySchema, PullManagedHostImageResultSchema
from service.common.pagination import Page, paginate_statement
from service.host.connection import known_hosts_path

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
    display_name: str = "",
    ip_address: str,
    ssh_port: int,
    host_account: str,
    host_password: str,
) -> ManagedHost:
    now = datetime.now()
    host = ManagedHost(
        display_name=_display_name_or_default(display_name, ip_address, is_local=False),
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
    display_name: str | None = None,
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
            ("display_name", display_name),
            ("ip_address", ip_address), ("ssh_port", ssh_port), ("host_account", host_account),
            ("host_password", host_password),
        ):
            if value is not None:
                if name == "display_name":
                    setattr(
                        host,
                        name,
                        _display_name_or_default(value, host.ip_address, is_local=id == DEFAULT_LOCAL_HOST_ID),
                    )
                else:
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
                ManagedHost.display_name.ilike(pattern),
                ManagedHost.host_account.ilike(pattern),
                cast(ManagedHost.ssh_port, String).ilike(pattern),
            )
        )
    return await paginate_statement(statement, page=page, size=size)


async def query_managed_host_by_id(id: int) -> ManagedHost | None:
    async with get_async_session() as session:
        return await session.get(ManagedHost, id)


async def preview_managed_host_key(id: int) -> ManagedHostKeySchema | None:
    host = await query_managed_host_by_id(id)
    if host is None:
        return None
    key = await _fetch_host_key(host)
    return _managed_host_key_schema(host, key)


async def trust_managed_host_key(id: int, fingerprint_sha256: str) -> ManagedHostKeySchema | None:
    host = await query_managed_host_by_id(id)
    if host is None:
        return None
    key = await _fetch_host_key(host)
    fingerprint = key.get_fingerprint("sha256")
    if fingerprint != fingerprint_sha256.strip():
        raise ValueError("host key fingerprint changed; refresh and verify again")
    _write_known_host_key(host, key)
    return _managed_host_key_schema(host, key, trusted=True)


async def ensure_local_managed_host() -> ManagedHost:
    username = _detect_local_username()
    async with get_async_session() as session:
        host = await session.get(ManagedHost, DEFAULT_LOCAL_HOST_ID)
        if host is None:
            now = datetime.now()
            host = ManagedHost(
                id=DEFAULT_LOCAL_HOST_ID,
                display_name="本机",
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
        elif not host.display_name:
            host.display_name = "本机"
            host.updated_at = datetime.now()
            session.add(host)
            await session.commit()
            await session.refresh(host)
        return host


def _display_name_or_default(display_name: str, ip_address: str, *, is_local: bool) -> str:
    normalized = display_name.strip()
    if normalized:
        return normalized
    if is_local:
        return "本机"
    return f"SSH-{ip_address}"


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
    return [
        PullManagedHostImageResultSchema(
            image_name=name,
            success=False,
            message="Docker is disabled; use a local tool workspace",
        )
        for name in image_names
    ]


async def delete_managed_host_image(id: int, image_id: str, force: bool = False) -> str | None:
    if await query_managed_host_by_id(id) is None:
        return "managed host not found"
    return "Docker image management is disabled in portable mode"


async def _fetch_host_key(host: ManagedHost) -> asyncssh.SSHKey:
    key = await asyncssh.get_server_host_key(host.ip_address, port=host.ssh_port)
    if key is None:
        raise RuntimeError("SSH server did not present a host key")
    return key


def _managed_host_key_schema(
    host: ManagedHost,
    key: asyncssh.SSHKey,
    trusted: bool | None = None,
) -> ManagedHostKeySchema:
    public_key = key.export_public_key("openssh").decode("ascii")
    if trusted is None:
        trusted = _known_hosts_contains(_known_host_marker(host), public_key)
    return ManagedHostKeySchema(
        host_id=host.id or 0,
        endpoint=_known_host_marker(host),
        algorithm=key.get_algorithm(),
        fingerprint_sha256=key.get_fingerprint("sha256"),
        public_key=public_key,
        trusted=trusted,
    )


def _write_known_host_key(host: ManagedHost, key: asyncssh.SSHKey) -> None:
    marker = _known_host_marker(host)
    public_key = key.export_public_key("openssh").decode("ascii")
    path = known_hosts_path()
    lines = path.read_text(encoding="utf-8").splitlines()
    kept = [line for line in lines if not line.startswith(f"{marker} ")]
    kept.append(f"{marker} {public_key}")
    path.write_text("\n".join(kept) + "\n", encoding="utf-8")


def _known_hosts_contains(marker: str, public_key: str) -> bool:
    path = known_hosts_path()
    expected = f"{marker} {public_key}"
    return expected in path.read_text(encoding="utf-8").splitlines()


def _known_host_marker(host: ManagedHost) -> str:
    if host.ssh_port == 22:
        return host.ip_address
    return f"[{host.ip_address}]:{host.ssh_port}"
