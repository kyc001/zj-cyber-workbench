from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AgentPromptKind = Literal["soul", "rules"]
CustomizationSource = Literal["builtin", "custom"]


class AgentPromptSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_code: str
    kind: AgentPromptKind
    content: str
    customized: bool
    source: CustomizationSource


class UpdateAgentPromptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: AgentPromptKind
    content: str = Field(max_length=500_000)


class SkillSummarySchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    source: CustomizationSource
    editable: bool
    description: str


class SkillDetailSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    source: CustomizationSource
    editable: bool
    content: str


class QuerySkillsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[SkillSummarySchema]


class CreateSkillRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    content: str = Field(max_length=500_000)


class UpdateSkillRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(max_length=500_000)
