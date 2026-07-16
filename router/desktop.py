from fastapi import APIRouter
from pydantic import BaseModel


class HealthResponse(BaseModel):
    service: str = "zj-core"
    status: str = "ok"
    version: str = "0.1.0"
    protocol_version: int = 1


router = APIRouter(tags=["desktop"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()
