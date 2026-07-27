from fastapi import APIRouter, Depends

from handler.skill_hub import (
    get_hub_skill_handler,
    install_hub_skill_handler,
    list_hub_skills_handler,
    list_installed_hub_skills_handler,
    uninstall_hub_skill_handler,
)
from middleware.auth import require_admin
from router.common.responses import BAD_REQUEST_RESPONSE, COMMON_ERROR_RESPONSES, CONFLICT_RESPONSE
from schema.common.responses import CommonResponse
from schema.skill_hub import (
    HubSkillDetailSchema,
    HubSkillListSchema,
    InstallHubSkillResponse,
)

router = APIRouter(prefix="/skill-hub", tags=["skill-hub"])

router.add_api_route(
    "/skills",
    list_hub_skills_handler,
    methods=["GET"],
    dependencies=[Depends(require_admin)],
    response_model=CommonResponse[HubSkillListSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/skills/{namespace}/{slug}",
    get_hub_skill_handler,
    methods=["GET"],
    dependencies=[Depends(require_admin)],
    response_model=CommonResponse[HubSkillDetailSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/installed",
    list_installed_hub_skills_handler,
    methods=["GET"],
    dependencies=[Depends(require_admin)],
    response_model=CommonResponse,
    responses=COMMON_ERROR_RESPONSES,
)

router.add_api_route(
    "/install",
    install_hub_skill_handler,
    methods=["POST"],
    dependencies=[Depends(require_admin)],
    response_model=CommonResponse[InstallHubSkillResponse],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE, **CONFLICT_RESPONSE},
)

router.add_api_route(
    "/installed/{name}",
    uninstall_hub_skill_handler,
    methods=["DELETE"],
    dependencies=[Depends(require_admin)],
    response_model=CommonResponse,
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)
