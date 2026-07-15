from http import HTTPStatus

from middleware.auth import AuthUser
from schema.common.responses import CommonResponse
from schema.work_project.cve import (
    CveDiscoveryRequest,
    ImportCveFindingRequest,
    ImportCveFindingResponse,
)
from service.work_project.cve import CveIntelligenceError, discover_cves, import_cve_finding
from service.work_project.projects import get_work_project_record_snapshot_for_user


async def discover_work_project_cves_handler(
    id: int,
    request: CveDiscoveryRequest,
    user: AuthUser,
) -> CommonResponse:
    snapshot = await get_work_project_record_snapshot_for_user(
        id,
        user_id=user.id,
        user_role=user.role,
    )
    if snapshot is None:
        return CommonResponse(code=HTTPStatus.NOT_FOUND.value, message="work project not found")
    if request.asset_id is not None and not any(item.id == request.asset_id for item in snapshot.records.assets):
        return CommonResponse(code=HTTPStatus.BAD_REQUEST.value, message="asset not found")
    try:
        result = await discover_cves(request)
    except CveIntelligenceError as exc:
        return CommonResponse(code=HTTPStatus.BAD_GATEWAY.value, message=f"CVE 情报查询失败：{exc}")
    return CommonResponse(data=result)


async def import_work_project_cve_handler(
    id: int,
    request: ImportCveFindingRequest,
    user: AuthUser,
) -> CommonResponse:
    snapshot = await get_work_project_record_snapshot_for_user(
        id,
        user_id=user.id,
        user_role=user.role,
    )
    if snapshot is None:
        return CommonResponse(code=HTTPStatus.NOT_FOUND.value, message="work project not found")
    finding, error, created = await import_cve_finding(id, request)
    if error or finding is None or finding.id is None:
        return CommonResponse(code=HTTPStatus.BAD_REQUEST.value, message=error or "CVE 发现入库失败")
    return CommonResponse(
        message="CVE 候选已加入发现" if created else "CVE 候选已更新",
        data=ImportCveFindingResponse(
            finding_id=finding.id,
            created=created,
            confidence=finding.confidence,
        ),
    )
