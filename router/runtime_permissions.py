from uuid import UUID

from fastapi import APIRouter, Depends

from handler.runtime_permissions import (
    clear_runtime_permission_rules_handler,
    decide_runtime_permission_handler,
    get_runtime_permission_settings_handler,
    list_pending_permissions_handler,
    update_runtime_permission_settings_handler,
)
from middleware.auth import AuthUser, require_admin
from schema.common.responses import CommonResponse
from schema.runtime_permissions import (
    RuntimePermissionDecisionRequest,
    RuntimePermissionRequest,
    RuntimePermissionSettingsResponse,
    UpdateRuntimePermissionSettingsRequest,
)

router = APIRouter(prefix="/runtime-permissions", tags=["runtime-permissions"])


async def list_pending_permissions_endpoint(
    user: AuthUser = Depends(require_admin),
) -> CommonResponse[list[RuntimePermissionRequest]]:
    return await list_pending_permissions_handler(user)


async def decide_runtime_permission_endpoint(
    request_id: UUID,
    request: RuntimePermissionDecisionRequest,
    user: AuthUser = Depends(require_admin),
) -> CommonResponse[RuntimePermissionRequest]:
    return await decide_runtime_permission_handler(request_id, request, user)


def get_runtime_permission_settings_endpoint(
    _: AuthUser = Depends(require_admin),
) -> CommonResponse[RuntimePermissionSettingsResponse]:
    return get_runtime_permission_settings_handler()


async def update_runtime_permission_settings_endpoint(
    request: UpdateRuntimePermissionSettingsRequest,
    _: AuthUser = Depends(require_admin),
) -> CommonResponse[RuntimePermissionSettingsResponse]:
    return await update_runtime_permission_settings_handler(request)


def clear_runtime_permission_rules_endpoint(
    _: AuthUser = Depends(require_admin),
) -> CommonResponse[RuntimePermissionSettingsResponse]:
    return clear_runtime_permission_rules_handler()


router.add_api_route(
    "/pending",
    list_pending_permissions_endpoint,
    methods=["GET"],
    response_model=CommonResponse[list[RuntimePermissionRequest]],
)
router.add_api_route(
    "/{request_id}/decision",
    decide_runtime_permission_endpoint,
    methods=["POST"],
    response_model=CommonResponse[RuntimePermissionRequest],
)
router.add_api_route(
    "/settings",
    get_runtime_permission_settings_endpoint,
    methods=["GET"],
    response_model=CommonResponse[RuntimePermissionSettingsResponse],
)
router.add_api_route(
    "/settings",
    update_runtime_permission_settings_endpoint,
    methods=["PATCH"],
    response_model=CommonResponse[RuntimePermissionSettingsResponse],
)
router.add_api_route(
    "/rules",
    clear_runtime_permission_rules_endpoint,
    methods=["DELETE"],
    response_model=CommonResponse[RuntimePermissionSettingsResponse],
)
