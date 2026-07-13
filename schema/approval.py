from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    GRANTED = "granted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CONSUMED = "consumed"


class ApprovalClaims(BaseModel):
    approval_id: UUID = Field(default_factory=uuid4)
    project_id: int = Field(gt=0)
    incident_id: UUID
    action_id: UUID
    action_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")
    target_id: UUID
    approver_id: int = Field(gt=0)
    expires_at: datetime

