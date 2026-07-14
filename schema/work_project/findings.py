from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class WorkProjectFindingSeverity(StrEnum):
    INFO = "info"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class WorkProjectFindingStatus(StrEnum):
    SUSPECTED = "suspected"
    VALIDATED = "validated"
    FALSE_POSITIVE = "false_positive"


class WorkProjectFindingType(StrEnum):
    GENERAL = "general"
    CVE = "cve"


class WorkProjectFindingConfidence(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CONFIRMED = "confirmed"


class WorkProjectFindingSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    asset_id: int | None = None
    edge_id: int | None = None
    title: str
    finding_type: WorkProjectFindingType = WorkProjectFindingType.GENERAL
    cve_id: str = ""
    severity: WorkProjectFindingSeverity
    status: WorkProjectFindingStatus
    confidence: WorkProjectFindingConfidence = WorkProjectFindingConfidence.LOW
    cvss_score: float | None = None
    cvss_vector: str = ""
    cwes: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)
    evidence: str = ""
    remediation: str = ""
    source: str = ""
    known_exploited: bool = False
    epss_score: float | None = None
    epss_percentile: float | None = None
    affected_version: str = ""
    fixed_versions: list[str] = Field(default_factory=list)
    description: str = ""
    impact: str = ""
    created_by_agent_code: str = ""
    created_from_session_id: str = ""
    created_at: datetime
    updated_at: datetime
    validated_at: datetime | None = None


class WorkProjectFindingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: int | None = Field(default=None, gt=0, description="Asset this finding is about.")
    edge_id: int | None = Field(
        default=None,
        gt=0,
        description="Relationship edge this finding substantiates when it backs a relation or attack step.",
    )
    title: str = Field(min_length=1, max_length=255)
    finding_type: WorkProjectFindingType = WorkProjectFindingType.GENERAL
    cve_id: str = Field(default="", max_length=32, pattern=r"^(?:[Cc][Vv][Ee]-\d{4}-\d{4,}|)$")
    severity: WorkProjectFindingSeverity = WorkProjectFindingSeverity.INFO
    status: WorkProjectFindingStatus = WorkProjectFindingStatus.SUSPECTED
    confidence: WorkProjectFindingConfidence = WorkProjectFindingConfidence.LOW
    cvss_score: float | None = Field(default=None, ge=0, le=10)
    cvss_vector: str = Field(default="", max_length=255)
    cwes: list[str] = Field(default_factory=list, max_length=64)
    references: list[str] = Field(default_factory=list, max_length=64)
    evidence: str = Field(default="", max_length=16000)
    remediation: str = Field(default="", max_length=8000)
    source: str = Field(default="", max_length=64)
    known_exploited: bool = False
    epss_score: float | None = Field(default=None, ge=0, le=1)
    epss_percentile: float | None = Field(default=None, ge=0, le=1)
    affected_version: str = Field(default="", max_length=255)
    fixed_versions: list[str] = Field(default_factory=list, max_length=64)
    description: str = Field(default="", max_length=8000)
    impact: str = Field(default="", max_length=8000)

    @field_validator(
        "title", "cve_id", "cvss_vector", "evidence", "remediation", "source",
        "affected_version", "description", "impact", mode="before",
    )
    @classmethod
    def normalize_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("cve_id", mode="after")
    @classmethod
    def normalize_cve_id(cls, value: str) -> str:
        return value.upper()

    @field_validator("cwes", "references", "fixed_versions", mode="after")
    @classmethod
    def normalize_string_list(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            item = value.strip()
            if item and item not in normalized:
                normalized.append(item)
        return normalized
