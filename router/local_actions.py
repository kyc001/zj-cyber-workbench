from __future__ import annotations

from http import HTTPStatus

from fastapi import APIRouter, Depends

from middleware.auth import AuthUser, require_user
from router.common.responses import BAD_REQUEST_RESPONSE, COMMON_ERROR_RESPONSES, not_found_response
from schema.common.responses import CommonResponse
from schema.local_actions import (
    LocalPowerShellRunRequest,
    LocalPowerShellRunResponse,
    QueryLocalPowerShellActionsResponse,
    UacHelperStatusResponse,
)
from service.host.powershell import list_local_powershell_actions, run_local_powershell_action

router = APIRouter(prefix="/local-actions", tags=["local-actions"])

NOT_FOUND_RESPONSE = not_found_response("Local action")


async def list_powershell_actions_route(
    _: AuthUser = Depends(require_user),
) -> CommonResponse[QueryLocalPowerShellActionsResponse]:
    return CommonResponse(data=list_local_powershell_actions())


async def run_powershell_action_route(
    action_id: str,
    request: LocalPowerShellRunRequest,
    _: AuthUser = Depends(require_user),
) -> CommonResponse[LocalPowerShellRunResponse]:
    try:
        result = await run_local_powershell_action(action_id, timeout_seconds=request.timeout_seconds)
    except FileNotFoundError as exc:
        return CommonResponse(code=HTTPStatus.NOT_FOUND.value, message=str(exc))
    return CommonResponse(data=LocalPowerShellRunResponse(result=result))


async def uac_helper_status_route(
    _: AuthUser = Depends(require_user),
) -> CommonResponse[UacHelperStatusResponse]:
    return CommonResponse(data=UacHelperStatusResponse())


router.add_api_route(
    "/powershell/actions",
    list_powershell_actions_route,
    methods=["GET"],
    response_model=CommonResponse[QueryLocalPowerShellActionsResponse],
    responses=COMMON_ERROR_RESPONSES,
)

router.add_api_route(
    "/powershell/actions/{action_id}/run",
    run_powershell_action_route,
    methods=["POST"],
    response_model=CommonResponse[LocalPowerShellRunResponse],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE, **NOT_FOUND_RESPONSE},
)

router.add_api_route(
    "/uac-helper/status",
    uac_helper_status_route,
    methods=["GET"],
    response_model=CommonResponse[UacHelperStatusResponse],
    responses=COMMON_ERROR_RESPONSES,
)
