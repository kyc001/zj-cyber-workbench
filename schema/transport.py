from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class ExecutionErrorCode(StrEnum):
    CONNECTION_FAILED = "connection_failed"
    AUTHENTICATION_FAILED = "authentication_failed"
    HOST_KEY_MISMATCH = "host_key_mismatch"
    PERMISSION_DENIED = "permission_denied"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    POLICY_DENIED = "policy_denied"
    EXECUTION_FAILED = "execution_failed"
    OUTPUT_LIMIT_EXCEEDED = "output_limit_exceeded"
    UNSUPPORTED_PLATFORM = "unsupported_platform"


class ExecutionResult(BaseModel):
    ok: bool
    execution_id: UUID
    summary: str = Field(max_length=4000)
    structured: dict[str, Any] = Field(default_factory=dict)
    artifact_refs: list[str] = Field(default_factory=list)
    started_at: datetime
    finished_at: datetime
    exit_code: int | None = None
    truncated: bool = False
    error_code: ExecutionErrorCode | None = None

