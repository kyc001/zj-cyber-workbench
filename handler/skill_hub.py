from __future__ import annotations

from schema.common.responses import CommonResponse
from schema.skill_hub import InstallHubSkillRequest
from service.skill_hub import (
    get_hub_skill,
    install_hub_skill,
    list_installed_hub_skills,
    query_hub_skills,
    uninstall_hub_skill,
)


async def list_hub_skills_handler(
    q: str = "",
    sort: str = "recent",
    page: int = 1,
    page_size: int = 24,
) -> CommonResponse:
    return CommonResponse(
        data=await query_hub_skills(
            q=q,
            sort=sort,
            page=page,
            page_size=page_size,
        )
    )


async def get_hub_skill_handler(namespace: str, slug: str) -> CommonResponse:
    return CommonResponse(data=await get_hub_skill(namespace, slug))


async def list_installed_hub_skills_handler() -> CommonResponse:
    return CommonResponse(data={"items": list_installed_hub_skills()})


async def install_hub_skill_handler(request: InstallHubSkillRequest) -> CommonResponse:
    return CommonResponse(data=await install_hub_skill(request))


async def uninstall_hub_skill_handler(name: str) -> CommonResponse:
    await uninstall_hub_skill(name)
    return CommonResponse(message="Skill Hub package uninstalled")
