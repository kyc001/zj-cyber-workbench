from __future__ import annotations

from http import HTTPStatus

from fastapi import APIRouter, Depends, Query

from middleware.auth import AuthUser, require_user
from router.common.responses import BAD_REQUEST_RESPONSE, COMMON_ERROR_RESPONSES, FORBIDDEN_RESPONSE, not_found_response
from schema.common.responses import CommonResponse
from schema.toolpack import (
    QueryToolpackToolsResponse,
    ToolRunCancelResponse,
    ToolRunRequest,
    ToolRunSnapshot,
)
from service.toolpack import cancel_tool_run, get_tool_run, list_toolpack_tools, start_tool_run

router = APIRouter(prefix="/toolpack", tags=["toolpack"])

NOT_FOUND_RESPONSE = not_found_response("Toolpack resource")


async def list_tools_route(
    sandbox_container_id: int | None = Query(default=None, gt=0),
    _: AuthUser = Depends(require_user),
) -> CommonResponse[QueryToolpackToolsResponse]:
    return CommonResponse(data=await list_toolpack_tools(sandbox_container_id=sandbox_container_id))


async def start_tool_run_route(
    tool_id: str,
    request: ToolRunRequest,
    user: AuthUser = Depends(require_user),
) -> CommonResponse[ToolRunSnapshot]:
    try:
        return CommonResponse(data=await start_tool_run(tool_id, request, user))
    except FileNotFoundError as exc:
        return CommonResponse(code=HTTPStatus.NOT_FOUND.value, message=str(exc))
    except PermissionError as exc:
        return CommonResponse(code=HTTPStatus.FORBIDDEN.value, message=str(exc))
    except ValueError as exc:
        return CommonResponse(code=HTTPStatus.BAD_REQUEST.value, message=str(exc))


async def get_tool_run_route(
    run_id: str,
    _: AuthUser = Depends(require_user),
) -> CommonResponse[ToolRunSnapshot]:
    snapshot = await get_tool_run(run_id)
    if snapshot is None:
        return CommonResponse(code=HTTPStatus.NOT_FOUND.value, message="tool run not found")
    return CommonResponse(data=snapshot)


async def cancel_tool_run_route(
    run_id: str,
    _: AuthUser = Depends(require_user),
) -> CommonResponse[ToolRunCancelResponse]:
    return CommonResponse(data=await cancel_tool_run(run_id))


router.add_api_route(
    "/tools",
    list_tools_route,
    methods=["GET"],
    response_model=CommonResponse[QueryToolpackToolsResponse],
    responses=COMMON_ERROR_RESPONSES,
)

router.add_api_route(
    "/tools/{tool_id}/runs",
    start_tool_run_route,
    methods=["POST"],
    response_model=CommonResponse[ToolRunSnapshot],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE, **FORBIDDEN_RESPONSE, **NOT_FOUND_RESPONSE},
)

router.add_api_route(
    "/runs/{run_id}",
    get_tool_run_route,
    methods=["GET"],
    response_model=CommonResponse[ToolRunSnapshot],
    responses={**COMMON_ERROR_RESPONSES, **NOT_FOUND_RESPONSE},
)

router.add_api_route(
    "/runs/{run_id}/cancel",
    cancel_tool_run_route,
    methods=["POST"],
    response_model=CommonResponse[ToolRunCancelResponse],
    responses={**COMMON_ERROR_RESPONSES, **NOT_FOUND_RESPONSE},
)
