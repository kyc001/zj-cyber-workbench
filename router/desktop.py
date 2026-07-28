import socket
import time

from fastapi import APIRouter
from pydantic import BaseModel

from service.auth import auth_provider_base_url, remote_auth_enabled


class HealthResponse(BaseModel):
    service: str = "zj-core"
    status: str = "ok"
    version: str = "0.1.0"
    protocol_version: int = 1


router = APIRouter(tags=["desktop"])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@router.get("/debug/network")
async def debug_network():
    """Diagnose outbound connectivity to the Skill Hub server."""
    from urllib.parse import urlparse

    url = urlparse(auth_provider_base_url())
    host, port = url.hostname, url.port or 80

    results: dict = {
        "target": f"{host}:{port}",
        "auth_mode": "remote" if remote_auth_enabled() else "desktop",
    }

    # 1. Raw TCP socket test
    tcp_start = time.monotonic()
    try:
        sock = socket.create_connection((host, port), timeout=5)
        sock.close()
        results["tcp"] = {"ok": True, "elapsed_ms": round((time.monotonic() - tcp_start) * 1000)}
    except OSError as exc:
        results["tcp"] = {"ok": False, "error": str(exc), "elapsed_ms": round((time.monotonic() - tcp_start) * 1000)}

    # 2. httpx test
    httpx_start = time.monotonic()
    try:
        import httpx
        async with httpx.AsyncClient(timeout=httpx.Timeout(5, connect=3), follow_redirects=False) as client:
            resp = await client.get(f"http://{host}:{port}/health")
        results["httpx"] = {"ok": True, "http_status": resp.status_code, "elapsed_ms": round((time.monotonic() - httpx_start) * 1000)}
    except Exception as exc:
        results["httpx"] = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "elapsed_ms": round((time.monotonic() - httpx_start) * 1000)}

    return results
