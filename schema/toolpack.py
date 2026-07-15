from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

from schema.action import RiskLevel


class ExecutionErrorCode(StrEnum):
    CONNECT_FAILED = "connect_failed"
    AUTH_FAILED = "auth_failed"
    HOST_KEY_CHANGED = "host_key_changed"
    PERMISSION_DENIED = "permission_denied"
    POLICY_DENIED = "policy_denied"
    APPROVAL_REQUIRED = "approval_required"
    TIMEOUT = "timeout"
    CANCELED = "canceled"
    PROCESS_FAILED = "process_failed"
    OUTPUT_TRUNCATED = "output_truncated"
    TOOL_MISSING = "tool_missing"
    PLATFORM_UNSUPPORTED = "platform_unsupported"
    SCOPE_DENIED = "scope_denied"


class ExecutionArtifact(BaseModel):
    id: str
    path: str
    media_type: str = "text/plain"
    size: int = Field(ge=0)


class ExecutionResult(BaseModel):
    ok: bool
    execution_id: str
    summary: str
    structured: dict[str, Any] = Field(default_factory=dict)
    artifact_refs: list[ExecutionArtifact] = Field(default_factory=list)
    exit_code: int | None = None
    started_at: datetime
    finished_at: datetime
    truncated: bool = False
    error_code: ExecutionErrorCode | None = None


class ToolBackend(StrEnum):
    LOCAL = "local"
    SSH = "ssh"


class ToolRunStatus(StrEnum):
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


class ToolManifestSchema(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    description: str = ""
    backend: ToolBackend
    executable: str = Field(min_length=1, max_length=128)
    category: str = Field(min_length=1, max_length=64)
    action_type: str = Field(min_length=3, max_length=128)
    risk_level: RiskLevel = RiskLevel.L1
    default_timeout_seconds: int = Field(gt=0)
    max_timeout_seconds: int = Field(gt=0)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)
    policy: dict[str, Any] = Field(default_factory=dict)


class ToolSchema(BaseModel):
    id: str
    name: str
    description: str
    backend: ToolBackend
    category: str
    available: bool | None
    availability_message: str = ""
    install_hint: str = ""
    manifest: ToolManifestSchema


class QueryToolpackToolsResponse(BaseModel):
    tools: list[ToolSchema]


class ToolRunRequest(BaseModel):
    sandbox_container_id: int = Field(gt=0)
    input: dict[str, Any] = Field(default_factory=dict)
    timeout_seconds: int | None = Field(default=None, gt=0)


class ToolRunSnapshot(BaseModel):
    run_id: str
    tool_id: str
    sandbox_container_id: int
    status: ToolRunStatus
    result: ExecutionResult | None = None
    started_at: datetime
    finished_at: datetime | None = None


class ToolRunCancelResponse(BaseModel):
    run_id: str
    canceled: bool
    status: Literal["running", "completed", "failed", "canceled"]
