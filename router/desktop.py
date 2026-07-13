from ipaddress import ip_address

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from middleware.auth import desktop_mode_enabled
from service.system_user.users import issue_system_user_token, query_system_user_by_username


class HealthResponse(BaseModel):
    service: str = "zj-core"
    status: str = "ok"
    version: str = "0.1.0"
    protocol_version: int = 1


class DesktopBootstrapResponse(BaseModel):
    token: str


router = APIRouter(tags=["desktop"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@router.post("/desktop/bootstrap", response_model=DesktopBootstrapResponse)
async def desktop_bootstrap(request: Request) -> DesktopBootstrapResponse:
    client_host = request.client.host if request.client else ""
    try:
        is_loopback = ip_address(client_host).is_loopback
    except ValueError:
        is_loopback = False

    if not desktop_mode_enabled() or not is_loopback:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    user = await query_system_user_by_username("desktop")
    if user is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="desktop user unavailable")
    return DesktopBootstrapResponse(token=issue_system_user_token(user))
