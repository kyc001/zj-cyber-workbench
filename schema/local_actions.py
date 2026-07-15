from __future__ import annotations

from pydantic import BaseModel, Field

from schema.action import RiskLevel
from schema.toolpack import ExecutionResult


class LocalPowerShellActionSchema(BaseModel):
    id: str
    name: str
    description: str = ""
    risk_level: RiskLevel = RiskLevel.L0
    read_only: bool = True
    enabled: bool


class QueryLocalPowerShellActionsResponse(BaseModel):
    actions: list[LocalPowerShellActionSchema]


class LocalPowerShellRunRequest(BaseModel):
    timeout_seconds: int = Field(default=30, gt=0, le=120)


class LocalPowerShellRunResponse(BaseModel):
    result: ExecutionResult


class UacHelperStatusResponse(BaseModel):
    enabled: bool = False
    reason: str = "UAC Helper is designed but disabled in v1."
    accepts_arbitrary_shell: bool = False
