import json

from agents import RunContextWrapper, function_tool

from core.runtime.context import AgentRuntimeContext
from schema.work_project.cve import CveDiscoveryMode, CveDiscoveryRequest
from service.work_project.cve import CveIntelligenceError, discover_cves


@function_tool
async def search_cve_intelligence(
    ctx: RunContextWrapper[AgentRuntimeContext],
    mode: CveDiscoveryMode,
    product: str = "",
    version: str = "",
    vendor: str = "",
    cpe: str = "",
    ecosystem: str = "",
    package_name: str = "",
    asset_id: int | None = None,
    limit: int = 10,
) -> str:
    """Search public CVE intelligence for an identified in-project service or package.

    This is a passive intelligence lookup, not active validation. Service mode queries NVD
    by CPE or vendor/product and evaluates published version ranges. Package mode queries OSV
    by ecosystem, package name, and exact version. Results include match confidence, CVSS,
    EPSS, CISA KEV status, affected ranges, and fixes when available. Never mark a finding
    validated from this lookup alone; save it as suspected until independent verification.
    """
    if ctx.context.work_project_id is None:
        return json.dumps({"ok": False, "error": "No WorkProject is bound to this session."})
    try:
        request = CveDiscoveryRequest(
            mode=mode,
            asset_id=asset_id,
            vendor=vendor,
            product=product,
            version=version,
            cpe=cpe,
            ecosystem=ecosystem,
            package_name=package_name,
            limit=min(max(limit, 1), 20),
        )
        result = await discover_cves(request)
        return json.dumps({"ok": True, **result.model_dump(mode="json")}, ensure_ascii=False)
    except (CveIntelligenceError, ValueError) as exc:
        return json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False)
