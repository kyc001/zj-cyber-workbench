from uuid import UUID

from fastapi import HTTPException

from middleware.auth import AuthUser
from schema.common.responses import CommonResponse
from schema.runtime_permissions import (
    RuntimePermissionDecisionRequest,
    RuntimePermissionRequest,
    RuntimePermissionSettingsResponse,
    UpdateRuntimePermissionSettingsRequest,
)
from service import runtime_permissions


async def list_pending_permissions_handler(user: AuthUser) -> CommonResponse[list[RuntimePermissionRequest]]:
    return CommonResponse(data=await runtime_permissions.list_pending(requester_id=user.id))


async def decide_runtime_permission_handler(
    request_id: UUID,
    request: RuntimePermissionDecisionRequest,
    user: AuthUser,
) -> CommonResponse[RuntimePermissionRequest]:
    try:
        result = await runtime_permissions.decide(request_id, requester_id=user.id, decision=request.decision)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return CommonResponse(data=result)


def get_runtime_permission_settings_handler() -> CommonResponse[RuntimePermissionSettingsResponse]:
    return CommonResponse(
        data=RuntimePermissionSettingsResponse(
            settings=runtime_permissions.get_settings(),
            always_allow_rules=len(runtime_permissions.list_rules()),
        )
    )


async def update_runtime_permission_settings_handler(
    request: UpdateRuntimePermissionSettingsRequest,
) -> CommonResponse[RuntimePermissionSettingsResponse]:
    settings = await runtime_permissions.update_mode(request.mode)
    return CommonResponse(
        data=RuntimePermissionSettingsResponse(
            settings=settings,
            always_allow_rules=len(runtime_permissions.list_rules()),
        )
    )


def clear_runtime_permission_rules_handler() -> CommonResponse[RuntimePermissionSettingsResponse]:
    runtime_permissions.clear_rules()
    return CommonResponse(
        data=RuntimePermissionSettingsResponse(
            settings=runtime_permissions.get_settings(),
            always_allow_rules=0,
        )
    )
