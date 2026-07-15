from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, field_validator


class RiskLevel(StrEnum):
    L0 = "L0"
    L1 = "L1"
    L2 = "L2"
    L3 = "L3"


class PolicyEffect(StrEnum):
    ALLOW = "allow"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


class ProposedAction(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: int = Field(gt=0)
    incident_id: UUID
    target_id: UUID
    action_type: str = Field(min_length=3, max_length=128, pattern=r"^[a-z0-9]+(?:[._-][a-z0-9]+)+$")
    arguments: dict[str, Any] = Field(default_factory=dict)
    risk_level: RiskLevel
    reason: str = Field(min_length=1, max_length=2000)
    is_write: bool = False
    is_load_test: bool = False
    prechecks: list[str] = Field(default_factory=list, max_length=32)
    verification_steps: list[str] = Field(default_factory=list, max_length=32)
    rollback_steps: list[str] = Field(default_factory=list, max_length=32)
    requested_rps: int | None = Field(default=None, gt=0)
    requested_concurrency: int | None = Field(default=None, gt=0)
    requested_duration_seconds: int | None = Field(default=None, gt=0)

    @field_validator("action_type", "reason", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class PolicyDecision(BaseModel):
    effect: PolicyEffect
    risk_level: RiskLevel
    reason_codes: list[str] = Field(default_factory=list)
    constraints: dict[str, Any] = Field(default_factory=dict)
    approval_ttl_seconds: int | None = Field(default=None, gt=0)
    decided_at: datetime = Field(default_factory=datetime.now)

