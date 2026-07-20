from fastapi import APIRouter, Depends

from handler.system_config.agent_customization import (
    create_skill_handler,
    delete_agent_prompt_handler,
    delete_skill_handler,
    get_agent_prompt_handler,
    get_skill_handler,
    list_skills_handler,
    update_agent_prompt_handler,
    update_skill_handler,
)
from handler.system_config.config import (
    fetch_provider_models_handler,
    get_instance_config_handler,
    update_instance_config_handler,
)
from middleware.auth import require_admin
from router.common.responses import BAD_REQUEST_RESPONSE, COMMON_ERROR_RESPONSES
from schema.common.responses import CommonResponse
from schema.system_config.agent_customization import (
    AgentPromptSchema,
    QuerySkillsResponse,
    SkillDetailSchema,
)
from schema.system_config.config import (
    FetchProviderModelsResponse,
    InstanceConfigSchema,
    UpdateInstanceConfigResponse,
)

ADMIN_ONLY = [Depends(require_admin)]

router = APIRouter(prefix="/system-config", tags=["system-config"])

router.add_api_route(
    "/models",
    fetch_provider_models_handler,
    methods=["POST"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[FetchProviderModelsResponse],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/instance",
    get_instance_config_handler,
    methods=["GET"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[InstanceConfigSchema],
    responses=COMMON_ERROR_RESPONSES,
)

router.add_api_route(
    "/instance",
    update_instance_config_handler,
    methods=["PATCH"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[UpdateInstanceConfigResponse],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/agents/{agent_code}/prompt",
    get_agent_prompt_handler,
    methods=["GET"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[AgentPromptSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/agents/{agent_code}/prompt",
    update_agent_prompt_handler,
    methods=["PATCH"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[AgentPromptSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/agents/{agent_code}/prompt",
    delete_agent_prompt_handler,
    methods=["DELETE"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[AgentPromptSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/skills",
    list_skills_handler,
    methods=["GET"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[QuerySkillsResponse],
    responses=COMMON_ERROR_RESPONSES,
)

router.add_api_route(
    "/agent-customization/skills/{name}",
    get_skill_handler,
    methods=["GET"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[SkillDetailSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/skills",
    create_skill_handler,
    methods=["POST"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[SkillDetailSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/skills/{name}",
    update_skill_handler,
    methods=["PATCH"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse[SkillDetailSchema],
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)

router.add_api_route(
    "/agent-customization/skills/{name}",
    delete_skill_handler,
    methods=["DELETE"],
    dependencies=ADMIN_ONLY,
    response_model=CommonResponse,
    responses={**COMMON_ERROR_RESPONSES, **BAD_REQUEST_RESPONSE},
)
