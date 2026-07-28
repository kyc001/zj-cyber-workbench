from http import HTTPStatus

from fastapi import APIRouter, Header, HTTPException

from config import activate_desktop_session, is_desktop_session_active
from middleware.auth import local_desktop_user
from schema.auth import AuthSessionSchema, CurrentUserSchema, LoginRequest, RegisterRequest
from schema.common.responses import CommonResponse
from service.auth import (
    bearer_token_from_header,
    ensure_local_user_for_remote,
    remote_auth_enabled,
    remote_login,
    remote_register,
    resolve_remote_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=CommonResponse[AuthSessionSchema])
async def login(request: LoginRequest) -> CommonResponse[AuthSessionSchema]:
    if remote_auth_enabled():
        session = await remote_login(request.username_or_email, request.password)
        user = await ensure_local_user_for_remote(session.user)
        return CommonResponse(data=AuthSessionSchema(
            access_token=session.access_token,
            expires_at=session.expires_at,
            user=user,
        ))

    # Desktop mode: accept the local desktop identity on first launch.
    # The login form credentials are discarded — the operator is logging
    # into the built‑in desktop account.
    user = await local_desktop_user()
    if user is None:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="local desktop identity unavailable",
        )
    activate_desktop_session()
    return CommonResponse(data=AuthSessionSchema(
        access_token="desktop",
        expires_at=None,
        user=CurrentUserSchema(
            id=user.id,
            role=user.role,
            email=user.email,
            username=user.username,
            display_name=user.username,
            auth_mode="desktop",
        ),
    ))


@router.post("/register", response_model=CommonResponse[AuthSessionSchema])
async def register(request: RegisterRequest) -> CommonResponse[AuthSessionSchema]:
    if not remote_auth_enabled():
        raise HTTPException(
            status_code=HTTPStatus.BAD_REQUEST.value,
            detail="remote auth is not enabled",
        )
    session = await remote_register(
        username=request.username,
        email=request.email,
        display_name=request.display_name,
        password=request.password,
    )
    user = await ensure_local_user_for_remote(session.user)
    return CommonResponse(data=AuthSessionSchema(
        access_token=session.access_token,
        expires_at=session.expires_at,
        user=user,
    ))


@router.get("/me", response_model=CommonResponse[CurrentUserSchema])
async def me(authorization: str | None = Header(default=None)) -> CommonResponse[CurrentUserSchema]:
    if remote_auth_enabled():
        token = bearer_token_from_header(authorization)
        if not token:
            raise HTTPException(status_code=HTTPStatus.UNAUTHORIZED.value, detail="authentication required")
        remote_user = await resolve_remote_user(token)
        return CommonResponse(data=await ensure_local_user_for_remote(remote_user))

    # Desktop mode: the operator must explicitly start a session on first
    # launch.  Once the flag file exists, subsequent launches skip the login
    # page automatically.
    if not is_desktop_session_active():
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED.value,
            detail="desktop session not started",
        )

    user = await local_desktop_user()
    if user is None:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="local desktop identity unavailable",
        )
    return CommonResponse(data=CurrentUserSchema(
        id=user.id,
        role=user.role,
        email=user.email,
        username=user.username,
        display_name=user.username,
        auth_mode="desktop",
    ))


@router.get("/mode", response_model=CommonResponse)
async def auth_mode_info() -> CommonResponse:
    """Return the active auth mode so the frontend knows which login UI to show."""
    mode = "remote" if remote_auth_enabled() else "desktop"
    return CommonResponse(data={"mode": mode})
