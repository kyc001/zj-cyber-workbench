from fastapi import APIRouter, Depends

from handler.runtime_permissions import (
    clear_runtime_permission_rules_handler,
    decide_runtime_permission_handler,
    get_runtime_permission_settings_handler,
    list_pending_permissions_handler,
    update_runtime_permission_settings_handler,
)
from middleware.auth import require_admin
from schema.common.responses import CommonResponse
from schema.runtime_permissions import RuntimePermissionRequest, RuntimePermissionSettingsResponse

router = APIRouter(
    prefix="/runtime-permissions",
    tags=["runtime-permissions"],
    dependencies=[Depends(require_admin)],
)

router.add_api_route(
    "/pending",
    list_pending_permissions_handler,
    methods=["GET"],
    response_model=CommonResponse[list[RuntimePermissionRequest]],
)
router.add_api_route(
    "/{request_id}/decision",
    decide_runtime_permission_handler,
    methods=["POST"],
    response_model=CommonResponse[RuntimePermissionRequest],
)
router.add_api_route(
    "/settings",
    get_runtime_permission_settings_handler,
    methods=["GET"],
    response_model=CommonResponse[RuntimePermissionSettingsResponse],
)
router.add_api_route(
    "/settings",
    update_runtime_permission_settings_handler,
    methods=["PATCH"],
    response_model=CommonResponse[RuntimePermissionSettingsResponse],
)
router.add_api_route(
    "/rules",
    clear_runtime_permission_rules_handler,
    methods=["DELETE"],
    response_model=CommonResponse[RuntimePermissionSettingsResponse],
)
