import secrets
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

from agents import set_tracing_disabled
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import ROOT_PATH
from core.delegation.subagents import start_subagent_runtime, stop_subagent_runtime
from core.lightrag.runtime import start_lightrag, stop_lightrag
from core.runtime.session import get_agent_pool
from core.sandbox.command_jobs import start_async_sandbox_runtime, stop_async_sandbox_commands
from database import close_engine, create_all_tables, init_engine
from logger import get_logger
from middleware.auth import LocalIdentityMiddleware
from middleware.response import (
    CommonResponseStatusMiddleware,
    http_exception_handler,
    request_validation_exception_handler,
    unhandled_exception_handler,
)
from router.agent.agents import router as agent_router
from router.agent.sessions import router as agent_session_router
from router.approval import router as approval_router
from router.common.fallback import api_not_found_router
from router.desktop import router as desktop_router
from router.egress_proxy.proxies import router as egress_proxy_router
from router.host.hosts import router as host_router
from router.knowledge.resources import router as knowledge_router
from router.local_actions import router as local_actions_router
from router.runtime_permissions import router as runtime_permission_router
from router.sandbox.containers import router as sandbox_container_router
from router.sandbox.images import router as sandbox_image_router
from router.skill_hub import router as skill_hub_router
from router.system_config.config import router as system_config_router
from router.system_user.users import router as system_user_router
from router.toolpack import router as toolpack_router
from router.work_project.projects import router as work_project_router
from schema.system_user.users import SystemUserRole
from service.agent.recovery import recover_pending_sessions
from service.agent.reports import start_report_cleanup_runtime, stop_report_cleanup_runtime
from service.host.hosts import ensure_local_managed_host
from service.knowledge.runtime import (
    start_knowledge_document_runtime,
    stop_knowledge_document_runtime,
)
from service.sandbox.lifecycle import ensure_default_portable_workspace
from service.sandbox.status import (
    invalidate_all_agent_tool_bindings,
    set_agent_tool_binding_invalidator,
    start_sandbox_container_status_monitor,
    stop_sandbox_container_status_monitor,
)
from service.system_user.users import create_system_user, query_system_user_by_username, update_system_user
from utils.urllib3_compat import install_urllib3_closed_file_close_patch

logger = get_logger(__name__)

install_urllib3_closed_file_close_patch()

WEB_DIST_PATH = ROOT_PATH / "web" / "dist-app"
API_PREFIX = "/api"


async def _bootstrap_desktop_user() -> None:
    username = "desktop"
    user = await query_system_user_by_username(username)
    if user is None:
        await create_system_user(
            username=username,
            password=secrets.token_urlsafe(32),
            email="desktop@localhost",
            role=SystemUserRole.ADMIN,
        )
        logger.info("local desktop user created")
        return

    if user.role != SystemUserRole.ADMIN and user.id is not None:
        await update_system_user(user.id, role=SystemUserRole.ADMIN)
        logger.info("local desktop user promoted to admin")


async def _bootstrap_local_host() -> None:
    host = await ensure_local_managed_host()
    logger.debug("local managed host ensured: %s", host.id)
    desktop_user = await query_system_user_by_username("desktop")
    if desktop_user is not None and desktop_user.id is not None:
        workspace_id = await ensure_default_portable_workspace(desktop_user.id)
        logger.debug("default portable workspace ensured: %s", workspace_id)


async def _shutdown_step(name: str, operation: Callable[[], Awaitable[None]]) -> None:
    try:
        await operation()
    except Exception:
        logger.exception("%s shutdown failed", name)


def _mount_frontend(app: FastAPI) -> None:
    """serve built frontend assets when web/dist-app exists"""
    index_path = WEB_DIST_PATH / "index.html"
    if not index_path.is_file():
        logger.debug("frontend static route skipped: %s not found", index_path)
        return

    assets_path = WEB_DIST_PATH / "assets"
    if assets_path.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_path), name="web-assets")

    async def serve_frontend(path: str = "") -> FileResponse:
        return FileResponse(index_path)

    app.add_api_route("/", serve_frontend, methods=["GET"], include_in_schema=False)
    app.add_api_route("/{path:path}", serve_frontend, methods=["GET"], include_in_schema=False)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator[None, None]:
    try:
        init_engine()
        await create_all_tables()
        await _bootstrap_desktop_user()
        await _bootstrap_local_host()
        await start_lightrag()
        await start_knowledge_document_runtime()

        set_tracing_disabled(True)
        await start_async_sandbox_runtime()
        await start_subagent_runtime()
        await start_report_cleanup_runtime()
        await recover_pending_sessions()
        await get_agent_pool().start()
        set_agent_tool_binding_invalidator(get_agent_pool().invalidate_tool_bindings)
        await start_sandbox_container_status_monitor()
        yield
    except Exception:
        logger.exception("lifespan startup failed")
        raise
    finally:
        await _shutdown_step("report cleanup runtime", stop_report_cleanup_runtime)
        await _shutdown_step("subagent runtime", stop_subagent_runtime)
        await _shutdown_step("portable command runtime", stop_async_sandbox_commands)
        await _shutdown_step("agent pool", get_agent_pool().stop)
        await _shutdown_step("portable workspace status monitor", stop_sandbox_container_status_monitor)
        await _shutdown_step("portable workspace bindings", invalidate_all_agent_tool_bindings)
        set_agent_tool_binding_invalidator(None)
        await _shutdown_step("knowledge document runtime", stop_knowledge_document_runtime)
        await _shutdown_step("LightRAG", stop_lightrag)
        await _shutdown_step("database engine", close_engine)


def create_app() -> FastAPI:
    app = FastAPI(
        title="ZJ - Multi-Agent Cyber Operations Workbench",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, request_validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    logger.debug("exception handlers added")

    app.add_middleware(CommonResponseStatusMiddleware)
    app.add_middleware(LocalIdentityMiddleware)
    logger.debug("middleware added")

    app.include_router(system_user_router, prefix=API_PREFIX)
    app.include_router(host_router, prefix=API_PREFIX)
    app.include_router(egress_proxy_router, prefix=API_PREFIX)
    app.include_router(sandbox_image_router, prefix=API_PREFIX)
    app.include_router(sandbox_container_router, prefix=API_PREFIX)
    app.include_router(work_project_router, prefix=API_PREFIX)
    app.include_router(knowledge_router, prefix=API_PREFIX)
    app.include_router(local_actions_router, prefix=API_PREFIX)
    app.include_router(agent_router, prefix=API_PREFIX)
    app.include_router(agent_session_router, prefix=API_PREFIX)
    app.include_router(approval_router, prefix=API_PREFIX)
    app.include_router(runtime_permission_router, prefix=API_PREFIX)
    app.include_router(skill_hub_router, prefix=API_PREFIX)
    app.include_router(system_config_router, prefix=API_PREFIX)
    app.include_router(toolpack_router, prefix=API_PREFIX)
    app.include_router(desktop_router)
    app.include_router(api_not_found_router, prefix=API_PREFIX)
    logger.debug("api router added")

    _mount_frontend(app)
    return app
