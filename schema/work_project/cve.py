from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from schema.work_project.findings import (
    WorkProjectFindingConfidence,
    WorkProjectFindingSeverity,
)


class CveDiscoveryMode(StrEnum):
    SERVICE = "service"
    PACKAGE = "package"


class CveMatchConfidence(StrEnum):
    EXACT = "exact"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class CveDiscoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: CveDiscoveryMode
    asset_id: int | None = Field(default=None, gt=0)
    vendor: str = Field(default="", max_length=128)
    product: str = Field(default="", max_length=128)
    version: str = Field(default="", max_length=128)
    cpe: str = Field(default="", max_length=512)
    ecosystem: str = Field(default="", max_length=64)
    package_name: str = Field(default="", max_length=255)
    limit: int = Field(default=20, ge=1, le=50)

    @field_validator(
        "vendor", "product", "version", "cpe", "ecosystem", "package_name",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @model_validator(mode="after")
    def validate_mode_fields(self) -> "CveDiscoveryRequest":
        if self.mode == CveDiscoveryMode.SERVICE:
            if not self.cpe and not self.product:
                raise ValueError("service discovery requires cpe or product")
            if self.cpe and not self.cpe.startswith("cpe:2.3:"):
                raise ValueError("cpe must use CPE 2.3 formatted binding")
        elif not (self.ecosystem and self.package_name and self.version):
            raise ValueError("package discovery requires ecosystem, package_name, and version")
        return self


class CveCandidateSchema(BaseModel):
    cve_id: str
    source: str
    aliases: list[str] = Field(default_factory=list)
    title: str = ""
    description: str = ""
    published_at: datetime | None = None
    modified_at: datetime | None = None
    severity: WorkProjectFindingSeverity = WorkProjectFindingSeverity.INFO
    cvss_score: float | None = None
    cvss_vector: str = ""
    cwes: list[str] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)
    affected_versions: list[str] = Field(default_factory=list)
    fixed_versions: list[str] = Field(default_factory=list)
    match_confidence: CveMatchConfidence
    match_reason: str
    known_exploited: bool = False
    kev_due_date: str = ""
    ransomware_use: str = ""
    epss_score: float | None = None
    epss_percentile: float | None = None
    source_url: str = ""


class CveDiscoveryResponse(BaseModel):
    mode: CveDiscoveryMode
    query: str
    total: int
    items: list[CveCandidateSchema]
    warnings: list[str] = Field(default_factory=list)
    retrieved_at: datetime = Field(default_factory=datetime.now)


class ImportCveFindingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: int | None = Field(default=None, gt=0)
    candidate: CveCandidateSchema
    affected_version: str = Field(default="", max_length=255)

    @field_validator("affected_version", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ImportCveFindingResponse(BaseModel):
    finding_id: int
    created: bool
    confidence: WorkProjectFindingConfidence
