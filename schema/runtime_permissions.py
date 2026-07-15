from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from config import PermissionConfig, PermissionMode
from schema.action import RiskLevel


class RuntimePermissionDecision(StrEnum):
    REJECT = "reject"
    ALLOW_ONCE = "allow_once"
    ALWAYS_ALLOW = "always_allow"


class RuntimePermissionStatus(StrEnum):
    PENDING = "pending"
    ALLOWED = "allowed"
    REJECTED = "rejected"
    EXPIRED = "expired"


class RuntimePermissionRequest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    session_id: str
    agent_code: str
    agent_name: str = ""
    requester_id: int = Field(gt=0)
    action_type: str
    target: str
    reason: str
    risk_level: RiskLevel
    details: dict[str, Any] = Field(default_factory=dict)
    status: RuntimePermissionStatus = RuntimePermissionStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.now)
    expires_at: datetime


class RuntimePermissionDecisionRequest(BaseModel):
    decision: RuntimePermissionDecision


class RuntimePermissionSettingsResponse(BaseModel):
    settings: PermissionConfig
    always_allow_rules: int = 0


class UpdateRuntimePermissionSettingsRequest(BaseModel):
    mode: PermissionMode


class RuntimePermissionRule(BaseModel):
    action_type: str
    target: str
    created_at: datetime = Field(default_factory=datetime.now)
