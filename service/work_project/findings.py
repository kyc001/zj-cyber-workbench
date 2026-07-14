from datetime import datetime

from sqlalchemy import String, cast, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from database import get_async_session
from model.work_project.assets import WorkProjectAsset
from model.work_project.findings import WorkProjectFinding
from model.work_project.graph import WorkProjectGraphEdge
from schema.work_project.findings import (
    WorkProjectFindingRequest,
    WorkProjectFindingSchema,
    WorkProjectFindingStatus,
)
from service.common.pagination import Page, paginate_statement


async def query_work_project_findings(
    project_id: int,
    *,
    page: int,
    size: int,
    keyword: str,
) -> Page[WorkProjectFindingSchema]:
    statement = (
        select(WorkProjectFinding)
        .where(WorkProjectFinding.project_id == project_id)
        .order_by(WorkProjectFinding.id)
    )
    keyword = keyword.strip()
    if keyword:
        pattern = f"%{keyword}%"
        statement = statement.where(or_(
            WorkProjectFinding.title.ilike(pattern),
            WorkProjectFinding.cve_id.ilike(pattern),
            WorkProjectFinding.description.ilike(pattern),
            WorkProjectFinding.evidence.ilike(pattern),
            WorkProjectFinding.remediation.ilike(pattern),
            WorkProjectFinding.impact.ilike(pattern),
            cast(WorkProjectFinding.severity, String).ilike(pattern),
            cast(WorkProjectFinding.status, String).ilike(pattern),
        ))
    page_result = await paginate_statement(statement, page=page, size=size)
    return Page(
        page=page_result.page,
        size=page_result.size,
        total=page_result.total,
        items=[WorkProjectFindingSchema.model_validate(item) for item in page_result.items],
    )


async def create_work_project_finding(
    project_id: int,
    request: WorkProjectFindingRequest,
    *,
    created_by_agent_code: str = "",
    created_from_session_id: str = "",
) -> tuple[WorkProjectFindingSchema | None, str]:
    now = datetime.now()
    async with get_async_session() as session:
        error = await _validate_refs(session, project_id, request)
        if error:
            return None, error
        finding = WorkProjectFinding(
            project_id=project_id,
            asset_id=request.asset_id,
            edge_id=request.edge_id,
            title=request.title,
            finding_type=request.finding_type,
            cve_id=request.cve_id,
            severity=request.severity,
            status=request.status,
            confidence=request.confidence,
            cvss_score=request.cvss_score,
            cvss_vector=request.cvss_vector,
            cwes=request.cwes,
            references=request.references,
            evidence=request.evidence,
            remediation=request.remediation,
            source=request.source,
            known_exploited=request.known_exploited,
            epss_score=request.epss_score,
            epss_percentile=request.epss_percentile,
            affected_version=request.affected_version,
            fixed_versions=request.fixed_versions,
            description=request.description,
            impact=request.impact,
            created_by_agent_code=created_by_agent_code.strip(),
            created_from_session_id=created_from_session_id.strip(),
            created_at=now,
            updated_at=now,
            validated_at=now if request.status == WorkProjectFindingStatus.VALIDATED else None,
        )
        session.add(finding)
        try:
            await session.commit()
        except IntegrityError:
            # A referenced asset or edge was deleted concurrently between validation and commit.
            await session.rollback()
            return None, "asset or graph edge not found"
        await session.refresh(finding)
    return WorkProjectFindingSchema.model_validate(finding), ""


async def update_work_project_finding(
    project_id: int,
    finding_id: int,
    request: WorkProjectFindingRequest,
) -> tuple[WorkProjectFindingSchema | None, str]:
    async with get_async_session() as session:
        finding = await session.get(WorkProjectFinding, finding_id)
        if finding is None or finding.project_id != project_id:
            return None, "finding not found"
        error = await _validate_refs(session, project_id, request)
        if error:
            return None, error
        previous_status = finding.status
        now = datetime.now()
        finding.asset_id = request.asset_id
        finding.edge_id = request.edge_id
        finding.title = request.title
        finding.finding_type = request.finding_type
        finding.cve_id = request.cve_id
        finding.severity = request.severity
        finding.status = request.status
        finding.confidence = request.confidence
        finding.cvss_score = request.cvss_score
        finding.cvss_vector = request.cvss_vector
        finding.cwes = request.cwes
        finding.references = request.references
        finding.evidence = request.evidence
        finding.remediation = request.remediation
        finding.source = request.source
        finding.known_exploited = request.known_exploited
        finding.epss_score = request.epss_score
        finding.epss_percentile = request.epss_percentile
        finding.affected_version = request.affected_version
        finding.fixed_versions = request.fixed_versions
        finding.description = request.description
        finding.impact = request.impact
        finding.updated_at = now
        if (
            request.status == WorkProjectFindingStatus.VALIDATED
            and previous_status != WorkProjectFindingStatus.VALIDATED
        ):
            finding.validated_at = now
        elif request.status != WorkProjectFindingStatus.VALIDATED:
            finding.validated_at = None
        session.add(finding)
        try:
            await session.commit()
        except IntegrityError:
            # A referenced asset or edge was deleted concurrently between validation and commit.
            await session.rollback()
            return None, "asset or graph edge not found"
        await session.refresh(finding)
    return WorkProjectFindingSchema.model_validate(finding), ""


async def upsert_cve_work_project_finding(
    project_id: int,
    request: WorkProjectFindingRequest,
    *,
    created_by_agent_code: str = "",
    created_from_session_id: str = "",
) -> tuple[WorkProjectFindingSchema | None, str, bool]:
    """Upsert one CVE candidate by project, asset, and CVE id."""
    if not request.cve_id:
        return None, "cve_id is required", False
    async with get_async_session() as session:
        statement = select(WorkProjectFinding).where(
            WorkProjectFinding.project_id == project_id,
            WorkProjectFinding.asset_id == request.asset_id,
            WorkProjectFinding.cve_id == request.cve_id,
        )
        existing = (await session.exec(statement)).first()
    if existing is None or existing.id is None:
        created, error = await create_work_project_finding(
            project_id,
            request,
            created_by_agent_code=created_by_agent_code,
            created_from_session_id=created_from_session_id,
        )
        return created, error, True

    if existing.status != WorkProjectFindingStatus.SUSPECTED:
        request = request.model_copy(update={"status": existing.status})
    saved, error = await update_work_project_finding(project_id, existing.id, request)
    return saved, error, False


async def delete_work_project_finding(project_id: int, finding_id: int) -> str:
    async with get_async_session() as session:
        finding = await session.get(WorkProjectFinding, finding_id)
        if finding is None or finding.project_id != project_id:
            return "finding not found"
        await session.delete(finding)
        await session.commit()
    return ""


async def _validate_refs(session, project_id: int, request: WorkProjectFindingRequest) -> str:
    if request.asset_id is not None:
        asset = await session.get(WorkProjectAsset, request.asset_id)
        if asset is None or asset.project_id != project_id:
            return "asset not found"
    if request.edge_id is not None:
        edge = await session.get(WorkProjectGraphEdge, request.edge_id)
        if edge is None or edge.project_id != project_id:
            return "graph edge not found"
    return ""
