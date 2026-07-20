from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from config import BUNDLED_AGENT_DIR, BUNDLED_SKILLS_DIR, WORKSPACE

AgentPromptKind = Literal["soul", "rules"]
SkillSource = Literal["builtin", "custom"]

CUSTOM_AGENT_DIR = WORKSPACE / "agent-overrides"
CUSTOM_SKILLS_DIR = WORKSPACE / "skills"

_AGENT_CODE_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
_PROMPT_FILENAMES: dict[AgentPromptKind, str] = {
    "soul": "SOUL.md",
    "rules": "AGENTS.md",
}


@dataclass(frozen=True, slots=True)
class SkillLocation:
    name: str
    source: SkillSource
    root: Path
    skill_file: Path
    editable: bool


def validate_agent_code(agent_code: str) -> str:
    normalized = agent_code.strip()
    if not _AGENT_CODE_PATTERN.fullmatch(normalized):
        raise ValueError("agent code is invalid")
    return normalized


def validate_skill_name(name: str) -> str:
    normalized = name.strip()
    if not _SKILL_NAME_PATTERN.fullmatch(normalized):
        raise ValueError("skill name must use lowercase letters, numbers, and hyphens")
    return normalized


def prompt_filename(kind: AgentPromptKind) -> str:
    if kind not in _PROMPT_FILENAMES:
        raise ValueError("prompt kind is invalid")
    return _PROMPT_FILENAMES[kind]


def bundled_agent_prompt_path(agent_code: str, kind: AgentPromptKind) -> Path:
    code = validate_agent_code(agent_code)
    return BUNDLED_AGENT_DIR / code / prompt_filename(kind)


def custom_agent_prompt_path(agent_code: str, kind: AgentPromptKind) -> Path:
    code = validate_agent_code(agent_code)
    return CUSTOM_AGENT_DIR / code / prompt_filename(kind)


def resolve_agent_prompt_path(agent_code: str, kind: AgentPromptKind) -> tuple[Path, SkillSource]:
    custom_path = custom_agent_prompt_path(agent_code, kind)
    if custom_path.is_file():
        return custom_path, "custom"
    return bundled_agent_prompt_path(agent_code, kind), "builtin"


def read_agent_prompt(agent_code: str, kind: AgentPromptKind) -> tuple[str, SkillSource]:
    path, source = resolve_agent_prompt_path(agent_code, kind)
    return path.read_text(encoding="utf-8").strip(), source


def custom_skill_root(name: str) -> Path:
    skill_name = validate_skill_name(name)
    return CUSTOM_SKILLS_DIR / skill_name


def bundled_skill_root(name: str) -> Path:
    skill_name = validate_skill_name(name)
    return BUNDLED_SKILLS_DIR / skill_name


def resolve_skill_location(name: str) -> SkillLocation | None:
    skill_name = validate_skill_name(name)
    custom_root = custom_skill_root(skill_name)
    custom_file = custom_root / "SKILL.md"
    if custom_file.is_file():
        return SkillLocation(
            name=skill_name,
            source="custom",
            root=custom_root,
            skill_file=custom_file,
            editable=True,
        )
    bundled_root = bundled_skill_root(skill_name)
    bundled_file = bundled_root / "SKILL.md"
    if bundled_file.is_file():
        return SkillLocation(
            name=skill_name,
            source="builtin",
            root=bundled_root,
            skill_file=bundled_file,
            editable=False,
        )
    return None


def iter_skill_locations(limit: int | None = None) -> tuple[SkillLocation, ...]:
    locations: dict[str, SkillLocation] = {}
    for location in _iter_skill_dir(CUSTOM_SKILLS_DIR, source="custom", editable=True):
        locations[location.name] = location
    for location in _iter_skill_dir(BUNDLED_SKILLS_DIR, source="builtin", editable=False):
        locations.setdefault(location.name, location)
    ordered = tuple(locations[name] for name in sorted(locations))
    return ordered[:limit] if limit is not None else ordered


def _iter_skill_dir(root: Path, *, source: SkillSource, editable: bool) -> Iterable[SkillLocation]:
    if not root.is_dir():
        return ()
    locations: list[SkillLocation] = []
    for skill_file in root.glob("*/SKILL.md"):
        name = skill_file.parent.name
        try:
            validate_skill_name(name)
        except ValueError:
            continue
        locations.append(
            SkillLocation(
                name=name,
                source=source,
                root=skill_file.parent,
                skill_file=skill_file,
                editable=editable,
            )
        )
    return locations
