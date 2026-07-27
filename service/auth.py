from __future__ import annotations

import os
import secrets
import zlib
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from typing import Any

import httpx
from fastapi import HTTPException

from schema.auth import CurrentUserSchema
from schema.system_user.users import SystemUserRole
from service.system_user.users import create_system_user, query_system_user_by_username, update_system_user


@dataclass(frozen=True)
class RemoteAuthUser:
    remote_id: str
    username: str
    email: str
    display_name: str
    role: str
    created_at: datetime | None = None


@dataclass(frozen=True)
class RemoteAuthSession:
    access_token: str
    expires_at: datetime
    user: RemoteAuthUser


def auth_mode() -> str:
    return os.environ.get("ZJ_AUTH_MODE", "desktop").strip().lower() or "desktop"


def remote_auth_enabled() -> bool:
    return auth_mode() == "remote"


def auth_provider_base_url() -> str:
    configured = (
        os.environ.get("ZJ_AUTH_PROVIDER_URL", "").strip()
        or os.environ.get("ZJ_SKILL_HUB_URL", "").strip()
        or "http://127.0.0.1:8011"
    )
    return configured.rstrip("/")


async def remote_login(username_or_email: str, password: str) -> RemoteAuthSession:
    payload = {"username_or_email": username_or_email, "password": password}
    data = await _provider_json("POST", "/api/v1/auth/login", json=payload)
    return _parse_auth_session(data)


async def remote_register(username: str, email: str, display_name: str, password: str) -> RemoteAuthSession:
    payload = {
        "username": username,
        "email": email,
        "display_name": display_name,
        "password": password,
    }
    data = await _provider_json("POST", "/api/v1/auth/register", json=payload)
    return _parse_auth_session(data)


async def resolve_remote_user(token: str) -> RemoteAuthUser:
    data = await _provider_json(
        "GET",
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    return _parse_user(data)


async def ensure_local_user_for_remote(remote_user: RemoteAuthUser) -> CurrentUserSchema:
    username = _local_username(remote_user)
    role = _map_role(remote_user.role)
    local_user = await query_system_user_by_username(username)
    if local_user is None:
        local_user = await create_system_user(
            username=username,
            password=secrets.token_urlsafe(32),
            email=remote_user.email,
            role=role,
        )
    elif local_user.id is not None:
        updates: dict[str, Any] = {}
        if local_user.email != remote_user.email:
            updates["email"] = remote_user.email
        if local_user.role != role:
            updates["role"] = role
        if updates:
            local_user = await update_system_user(local_user.id, **updates) or local_user

    if local_user.id is None:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="local user mapping unavailable",
        )

    return CurrentUserSchema(
        id=local_user.id,
        role=role,
        email=remote_user.email,
        username=remote_user.username,
        display_name=remote_user.display_name,
        auth_mode="remote",
    )


def bearer_token_from_header(value: str | None) -> str:
    if not value:
        return ""
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return ""
    return token.strip()


def _local_username(user: RemoteAuthUser) -> str:
    safe_name = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in user.username.lower())
    safe_name = safe_name.strip("_-") or "user"
    digest = zlib.crc32(user.remote_id.encode("utf-8")) & 0xFFFFFFFF
    suffix = f"{digest:08x}"
    return f"hub_{safe_name[:50]}_{suffix}"[:64]


def _map_role(role: str) -> SystemUserRole:
    # Demo mode: any account accepted by the remote auth provider can use the
    # full local workbench so shared presentations do not require seeded admins.
    del role
    return SystemUserRole.ADMIN


async def _provider_json(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(
            base_url=auth_provider_base_url(),
            timeout=httpx.Timeout(15, connect=5),
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.request(method, path, **kwargs)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="auth provider timeout",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail=f"auth provider unavailable: {exc}",
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=_response_detail(response))

    try:
        data = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="auth provider returned invalid json",
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="auth provider returned invalid payload",
        )
    return data


def _response_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:200] or f"auth provider error {response.status_code}"
    if isinstance(payload, dict):
        detail = payload.get("detail") or payload.get("message")
        if isinstance(detail, str) and detail:
            return detail
    return f"auth provider error {response.status_code}"


def _parse_auth_session(data: dict[str, Any]) -> RemoteAuthSession:
    token = str(data.get("access_token") or "")
    expires_at = _parse_datetime(data.get("expires_at"))
    user_payload = data.get("user")
    if not token or expires_at is None or not isinstance(user_payload, dict):
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="auth provider returned incomplete auth session",
        )
    return RemoteAuthSession(
        access_token=token,
        expires_at=expires_at,
        user=_parse_user(user_payload),
    )


def _parse_user(data: dict[str, Any]) -> RemoteAuthUser:
    remote_id = str(data.get("id") or "").strip()
    username = str(data.get("username") or "").strip()
    email = str(data.get("email") or "").strip()
    display_name = str(data.get("display_name") or username).strip()
    role = str(data.get("role") or "user").strip()
    if not remote_id or not username:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="auth provider returned incomplete user profile",
        )
    return RemoteAuthUser(
        remote_id=remote_id,
        username=username,
        email=email,
        display_name=display_name,
        role=role,
        created_at=_parse_datetime(data.get("created_at")),
    )


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
