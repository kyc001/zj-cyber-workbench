from __future__ import annotations

from dataclasses import dataclass
from http import HTTPStatus

from fastapi import Depends, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from schema.system_user.users import SystemUserRole
from service.auth import (
    bearer_token_from_header,
    ensure_local_user_for_remote,
    remote_auth_enabled,
    resolve_remote_user,
)


@dataclass(frozen=True)
class AuthUser:
    id: int
    role: SystemUserRole
    email: str
    username: str


async def local_desktop_user() -> AuthUser | None:
    from service.system_user.users import query_system_user_by_username

    user = await query_system_user_by_username("desktop")
    if user is None or user.id is None:
        return None
    return AuthUser(
        id=user.id,
        role=SystemUserRole.ADMIN,
        email=user.email,
        username=user.username,
    )


class LocalIdentityMiddleware(BaseHTTPMiddleware):
    """Attach the single local desktop identity to API requests.

    ZJ has no login, password authentication, access token, or remote web mode.
    Network exposure is prevented by the sidecar's mandatory loopback bind.
    """

    async def dispatch(self, request: Request, call_next) -> StarletteResponse:
        if request.method != "OPTIONS" and _is_api_request(request) and not _is_auth_request(request):
            if remote_auth_enabled():
                token = bearer_token_from_header(request.headers.get("authorization"))
                if not token:
                    raise HTTPException(status_code=HTTPStatus.UNAUTHORIZED.value, detail="authentication required")
                remote_user = await resolve_remote_user(token)
                current_user = await ensure_local_user_for_remote(remote_user)
                request.state.system_user = AuthUser(
                    id=current_user.id,
                    role=current_user.role,
                    email=current_user.email,
                    username=current_user.username,
                )
            else:
                user = await local_desktop_user()
                if user is None:
                    raise HTTPException(
                        status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
                        detail="local desktop identity unavailable",
                    )
                request.state.system_user = user
        return await call_next(request)


def require_user(request: Request) -> AuthUser:
    user = getattr(request.state, "system_user", None)
    if not isinstance(user, AuthUser):
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="local desktop identity unavailable",
        )
    return user


def require_admin(user: AuthUser = Depends(require_user)) -> AuthUser:
    if remote_auth_enabled():
        return user
    if user.role != SystemUserRole.ADMIN:
        raise HTTPException(status_code=HTTPStatus.FORBIDDEN.value, detail="admin role required")
    return user


def _is_api_request(request: Request) -> bool:
    path = request.url.path
    return path == "/api" or path.startswith("/api/")


def _is_auth_request(request: Request) -> bool:
    return request.url.path == "/api/auth" or request.url.path.startswith("/api/auth/")
