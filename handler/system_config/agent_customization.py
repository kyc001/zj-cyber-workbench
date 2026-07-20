from __future__ import annotations

from schema.common.responses import CommonResponse
from schema.system_config.agent_customization import (
    AgentPromptKind,
    CreateSkillRequest,
    UpdateAgentPromptRequest,
    UpdateSkillRequest,
)
from service.system_config.agent_customization import (
    create_skill,
    delete_agent_prompt,
    delete_skill,
    get_agent_prompt,
    get_skill,
    list_skills,
    update_agent_prompt,
    update_skill,
)


async def get_agent_prompt_handler(agent_code: str, kind: AgentPromptKind) -> CommonResponse:
    return CommonResponse(data=get_agent_prompt(agent_code, kind))


async def update_agent_prompt_handler(agent_code: str, request: UpdateAgentPromptRequest) -> CommonResponse:
    return CommonResponse(data=await update_agent_prompt(agent_code, request))


async def delete_agent_prompt_handler(agent_code: str, kind: AgentPromptKind) -> CommonResponse:
    return CommonResponse(data=await delete_agent_prompt(agent_code, kind))


async def list_skills_handler() -> CommonResponse:
    return CommonResponse(data=list_skills())


async def get_skill_handler(name: str) -> CommonResponse:
    return CommonResponse(data=get_skill(name))


async def create_skill_handler(request: CreateSkillRequest) -> CommonResponse:
    return CommonResponse(data=await create_skill(request))


async def update_skill_handler(name: str, request: UpdateSkillRequest) -> CommonResponse:
    return CommonResponse(data=await update_skill(name, request))


async def delete_skill_handler(name: str) -> CommonResponse:
    await delete_skill(name)
    return CommonResponse(message="skill deleted")
