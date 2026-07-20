from __future__ import annotations

import shutil
from http import HTTPStatus
from pathlib import Path

from fastapi import HTTPException

from config import get_config
from core.agent.customization import (
    CUSTOM_SKILLS_DIR,
    AgentPromptKind,
    SkillLocation,
    custom_agent_prompt_path,
    custom_skill_root,
    iter_skill_locations,
    read_agent_prompt,
    resolve_skill_location,
    validate_agent_code,
    validate_skill_name,
)
from schema.system_config.agent_customization import (
    AgentPromptSchema,
    CreateSkillRequest,
    QuerySkillsResponse,
    SkillDetailSchema,
    SkillSummarySchema,
    UpdateAgentPromptRequest,
    UpdateSkillRequest,
)
from service.system_config.config import rebuild_agent_instances


def get_agent_prompt(agent_code: str, kind: AgentPromptKind) -> AgentPromptSchema:
    code = _require_agent_code(agent_code)
    content, source = read_agent_prompt(code, kind)
    return AgentPromptSchema(
        agent_code=code,
        kind=kind,
        content=content,
        customized=source == "custom",
        source=source,
    )


async def update_agent_prompt(agent_code: str, request: UpdateAgentPromptRequest) -> AgentPromptSchema:
    code = _require_agent_code(agent_code)
    path = custom_agent_prompt_path(code, request.kind)
    _write_text(path, request.content)
    await rebuild_agent_instances()
    return get_agent_prompt(code, request.kind)


async def delete_agent_prompt(agent_code: str, kind: AgentPromptKind) -> AgentPromptSchema:
    code = _require_agent_code(agent_code)
    path = custom_agent_prompt_path(code, kind)
    path.unlink(missing_ok=True)
    await rebuild_agent_instances()
    return get_agent_prompt(code, kind)


def list_skills() -> QuerySkillsResponse:
    return QuerySkillsResponse(
        items=[
            SkillSummarySchema(
                name=location.name,
                source=location.source,
                editable=location.editable,
                description=_skill_description(location.skill_file),
            )
            for location in iter_skill_locations()
        ]
    )


def get_skill(name: str) -> SkillDetailSchema:
    location = _require_skill(name)
    return SkillDetailSchema(
        name=location.name,
        source=location.source,
        editable=location.editable,
        content=location.skill_file.read_text(encoding="utf-8"),
    )


async def create_skill(request: CreateSkillRequest) -> SkillDetailSchema:
    try:
        name = validate_skill_name(request.name)
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST.value, detail=str(exc)) from exc
    root = custom_skill_root(name)
    skill_file = root / "SKILL.md"
    if skill_file.exists():
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT.value,
            detail="custom skill already exists",
        )
    _write_text(skill_file, _default_skill_content(name, request.content))
    await rebuild_agent_instances()
    return get_skill(name)


async def update_skill(name: str, request: UpdateSkillRequest) -> SkillDetailSchema:
    skill_name = validate_skill_name(name)
    location = _require_skill(skill_name)
    if not location.editable:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN.value,
            detail="built-in skills are read-only",
        )
    _write_text(location.skill_file, _default_skill_content(skill_name, request.content))
    await rebuild_agent_instances()
    return get_skill(skill_name)


async def delete_skill(name: str) -> None:
    skill_name = validate_skill_name(name)
    location = _require_skill(skill_name)
    if not location.editable:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN.value,
            detail="built-in skills cannot be deleted",
        )
    custom_root = custom_skill_root(skill_name)
    if custom_root == CUSTOM_SKILLS_DIR or CUSTOM_SKILLS_DIR not in custom_root.parents:
        raise HTTPException(
            status_code=HTTPStatus.FORBIDDEN.value,
            detail="invalid skill path",
        )
    shutil.rmtree(custom_root)
    await rebuild_agent_instances()


def _require_agent_code(agent_code: str) -> str:
    try:
        code = validate_agent_code(agent_code)
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST.value, detail=str(exc)) from exc
    if code not in get_config().agents:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND.value, detail="agent not found")
    return code


def _require_skill(name: str) -> SkillLocation:
    try:
        skill_name = validate_skill_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST.value, detail=str(exc)) from exc
    location = resolve_skill_location(skill_name)
    if location is None:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND.value, detail="skill not found")
    return location


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def _default_skill_content(name: str, content: str) -> str:
    stripped = content.strip()
    if stripped:
        return stripped
    return (
        f"# {name}\n\n"
        "Describe when the agent should use this skill and list the exact workflow steps."
    )


def _skill_description(skill_file: Path) -> str:
    try:
        lines = skill_file.read_text(encoding="utf-8").splitlines()
    except OSError:
        return "Portable tool workflow"
    if lines and lines[0].strip() == "---":
        for line in lines[1:]:
            stripped = line.strip()
            if stripped == "---":
                break
            if stripped.startswith("description:"):
                return stripped.partition(":")[2].strip().strip('"') or "Portable tool workflow"
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or "Portable tool workflow"
    return "Portable tool workflow"
