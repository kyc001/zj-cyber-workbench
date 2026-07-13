from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, model_validator

from schema.action import RiskLevel


class IncidentStatus(StrEnum):
    CREATED = "created"
    PLANNING = "planning"
    DIAGNOSING = "diagnosing"
    AWAITING_APPROVAL = "awaiting_approval"
    EXECUTING = "executing"
    VERIFYING = "verifying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ROLLBACK_REQUIRED = "rollback_required"
    ROLLING_BACK = "rolling_back"
    ROLLED_BACK = "rolled_back"


class TargetEnvironment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    STAGING = "staging"
    PRODUCTION = "production"


class AuthorizationScope(BaseModel):
    allowed_target_ids: set[UUID] = Field(default_factory=set)
    allowed_action_types: set[str] = Field(default_factory=set)
    maximum_risk_level: RiskLevel = RiskLevel.L1
    valid_from: datetime | None = None
    valid_until: datetime | None = None
    max_load_test_rps: int | None = Field(default=None, gt=0)
    max_load_test_concurrency: int | None = Field(default=None, gt=0)
    max_load_test_duration_seconds: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_window(self):
        if self.valid_from and self.valid_until and self.valid_until <= self.valid_from:
            raise ValueError("valid_until must be later than valid_from")
        return self


class Incident(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    project_id: int = Field(gt=0)
    objective: str = Field(min_length=1, max_length=4000)
    authorization_scope: AuthorizationScope
    status: IncidentStatus = IncidentStatus.CREATED
    final_conclusion: str = Field(default="", max_length=8000)
    schema_version: int = Field(default=1, ge=1)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

