from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from schema.action import PolicyDecision, ProposedAction
from schema.incident import AuthorizationScope, TargetEnvironment


class EvaluateActionRequest(BaseModel):
    action: ProposedAction
    scope: AuthorizationScope
    environment: TargetEnvironment = TargetEnvironment.TEST


class ApprovalCreateRequest(EvaluateActionRequest):
    approver_id: int | None = Field(default=None, gt=0)


class ApprovalRecord(BaseModel):
    approval_id: UUID
    action: ProposedAction
    decision: PolicyDecision
    status: str
    requester_id: int
    approver_id: int
    created_at: datetime
    expires_at: datetime


class ApprovalCreateResponse(BaseModel):
    approval: ApprovalRecord


class ApprovalDecisionResponse(BaseModel):
    approval: ApprovalRecord
    token: str = ""


class ApprovalConsumeRequest(BaseModel):
    action: ProposedAction
    token: str = Field(min_length=16)


class ApprovalConsumeResponse(BaseModel):
    approval_id: UUID
    consumed: bool
    claims: dict[str, Any] = Field(default_factory=dict)
