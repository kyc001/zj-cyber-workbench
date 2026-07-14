from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, Float, Index, String
from sqlmodel import Field, SQLModel

from schema.work_project.findings import (
    WorkProjectFindingConfidence,
    WorkProjectFindingSeverity,
    WorkProjectFindingStatus,
    WorkProjectFindingType,
)


class WorkProjectFinding(SQLModel, table=True):
    __tablename__ = "work_project_findings"
    __table_args__ = (
        Index("ix_work_project_findings_project_status", "project_id", "status"),
        Index("ix_work_project_findings_project_severity", "project_id", "severity"),
    )

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="work_projects.id", index=True, ondelete="CASCADE")
    asset_id: int | None = Field(default=None, foreign_key="work_project_assets.id", index=True, ondelete="SET NULL")
    edge_id: int | None = Field(
        default=None,
        foreign_key="work_project_graph_edges.id",
        index=True,
        ondelete="SET NULL",
    )
    title: str = Field(default="", index=True)
    finding_type: WorkProjectFindingType = Field(
        default=WorkProjectFindingType.GENERAL,
        sa_column=Column(String(32), nullable=False, index=True),
    )
    cve_id: str = Field(default="", sa_column=Column(String(32), nullable=False, index=True))
    severity: WorkProjectFindingSeverity = Field(
        default=WorkProjectFindingSeverity.INFO,
        sa_column=Column(String(32), nullable=False),
    )
    status: WorkProjectFindingStatus = Field(
        default=WorkProjectFindingStatus.SUSPECTED,
        sa_column=Column(String(32), nullable=False),
    )
    confidence: WorkProjectFindingConfidence = Field(
        default=WorkProjectFindingConfidence.LOW,
        sa_column=Column(String(32), nullable=False),
    )
    cvss_score: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    cvss_vector: str = Field(default="")
    cwes: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    references: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    evidence: str = Field(default="")
    remediation: str = Field(default="")
    source: str = Field(default="")
    known_exploited: bool = Field(default=False, sa_column=Column(Boolean, nullable=False))
    epss_score: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    epss_percentile: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
    affected_version: str = Field(default="")
    fixed_versions: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    description: str = Field(default="")
    impact: str = Field(default="")
    created_by_agent_code: str = Field(default="", index=True)
    created_from_session_id: str = Field(default="", index=True)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    validated_at: datetime | None = Field(default=None)
