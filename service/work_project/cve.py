from __future__ import annotations

import math
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from packaging.version import InvalidVersion, Version

from schema.work_project.cve import (
    CveCandidateSchema,
    CveDiscoveryMode,
    CveDiscoveryRequest,
    CveDiscoveryResponse,
    CveMatchConfidence,
    ImportCveFindingRequest,
)
from schema.work_project.findings import (
    WorkProjectFindingConfidence,
    WorkProjectFindingRequest,
    WorkProjectFindingSeverity,
    WorkProjectFindingStatus,
    WorkProjectFindingType,
)
from service.work_project.findings import upsert_cve_work_project_finding

_NVD_CVE_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
_OSV_QUERY_URL = "https://api.osv.dev/v1/query"
_EPSS_URL = "https://api.first.org/data/v1/epss"
_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
_USER_AGENT = "ZJ-CVE-Discovery/0.1 (+authorized defensive research)"
_CVE_RE = re.compile(r"^CVE-\d{4}-\d{4,}$", re.IGNORECASE)
_KEV_CACHE_TTL = timedelta(hours=6)
_kev_cache_at: datetime | None = None
_kev_cache: dict[str, dict[str, Any]] = {}


class CveIntelligenceError(RuntimeError):
    pass


async def discover_cves(
    request: CveDiscoveryRequest,
    *,
    client: httpx.AsyncClient | None = None,
) -> CveDiscoveryResponse:
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(20, connect=10),
            follow_redirects=True,
            trust_env=True,
            headers={"User-Agent": _USER_AGENT},
        )
    try:
        if request.mode == CveDiscoveryMode.SERVICE:
            result = await _discover_service_cves(client, request)
        else:
            result = await _discover_package_cves(client, request)
        await _enrich_candidates(client, result, use_kev_cache=owns_client)
        result.items.sort(key=_candidate_sort_key)
        return result
    finally:
        if owns_client:
            await client.aclose()


async def import_cve_finding(
    project_id: int,
    request: ImportCveFindingRequest,
    *,
    created_by_agent_code: str = "",
    created_from_session_id: str = "",
):
    candidate = request.candidate
    confidence = {
        CveMatchConfidence.EXACT: WorkProjectFindingConfidence.HIGH,
        CveMatchConfidence.HIGH: WorkProjectFindingConfidence.HIGH,
        CveMatchConfidence.MEDIUM: WorkProjectFindingConfidence.MEDIUM,
        CveMatchConfidence.LOW: WorkProjectFindingConfidence.LOW,
    }[candidate.match_confidence]
    affected_version = request.affected_version.strip()
    evidence_parts = [candidate.match_reason]
    if candidate.source_url:
        evidence_parts.append(f"情报源: {candidate.source_url}")
    if candidate.known_exploited:
        evidence_parts.append("CISA KEV 已收录该漏洞。")
    remediation = (
        f"优先升级到已知修复版本: {', '.join(candidate.fixed_versions)}。"
        if candidate.fixed_versions
        else "核对厂商公告并升级到不受影响的受支持版本；主动验证前保持为疑似状态。"
    )
    finding_request = WorkProjectFindingRequest(
        asset_id=request.asset_id,
        title=f"{candidate.cve_id} {candidate.title}".strip(),
        finding_type=WorkProjectFindingType.CVE,
        cve_id=candidate.cve_id,
        severity=candidate.severity,
        status=WorkProjectFindingStatus.SUSPECTED,
        confidence=confidence,
        cvss_score=candidate.cvss_score,
        cvss_vector=candidate.cvss_vector,
        cwes=candidate.cwes,
        references=candidate.references,
        evidence="\n".join(evidence_parts),
        remediation=remediation,
        source=candidate.source,
        known_exploited=candidate.known_exploited,
        epss_score=candidate.epss_score,
        epss_percentile=candidate.epss_percentile,
        affected_version=affected_version,
        fixed_versions=candidate.fixed_versions,
        description=candidate.description,
        impact=(
            "该漏洞已进入 CISA 已知被利用漏洞目录，应按暴露面和业务影响优先处置。"
            if candidate.known_exploited
            else "需要结合实际暴露面、版本和可达性完成独立验证。"
        ),
    )
    return await upsert_cve_work_project_finding(
        project_id,
        finding_request,
        created_by_agent_code=created_by_agent_code,
        created_from_session_id=created_from_session_id,
    )


async def _discover_service_cves(
    client: httpx.AsyncClient,
    request: CveDiscoveryRequest,
) -> CveDiscoveryResponse:
    params: dict[str, str | int] = {"resultsPerPage": request.limit}
    if request.cpe:
        params["virtualMatchString"] = request.cpe
        query = request.cpe
    else:
        query = " ".join(part for part in (request.vendor, request.product) if part)
        params["keywordSearch"] = query
    api_key = os.environ.get("NVD_API_KEY", "").strip()
    headers = {"apiKey": api_key} if api_key else None
    payload = await _request_json(client, "GET", _NVD_CVE_URL, params=params, headers=headers)
    items = [
        _parse_nvd_candidate(entry.get("cve") or {}, request)
        for entry in payload.get("vulnerabilities", [])
        if isinstance(entry, dict) and isinstance(entry.get("cve"), dict)
    ]
    items = [item for item in items if item.cve_id]
    return CveDiscoveryResponse(
        mode=request.mode,
        query=query,
        total=int(payload.get("totalResults") or len(items)),
        items=items[: request.limit],
        warnings=(
            []
            if request.version or request.cpe
            else ["未提供版本，只能生成产品级候选，不能判定目标实际受影响。"]
        ),
    )


async def _discover_package_cves(
    client: httpx.AsyncClient,
    request: CveDiscoveryRequest,
) -> CveDiscoveryResponse:
    payload = await _request_json(
        client,
        "POST",
        _OSV_QUERY_URL,
        json={
            "version": request.version,
            "package": {"name": request.package_name, "ecosystem": request.ecosystem},
        },
    )
    items = [
        _parse_osv_candidate(item, request)
        for item in payload.get("vulns", [])
        if isinstance(item, dict)
    ]
    items = [item for item in items if item.cve_id]
    query = f"{request.ecosystem}:{request.package_name}@{request.version}"
    return CveDiscoveryResponse(
        mode=request.mode,
        query=query,
        total=len(items),
        items=items[: request.limit],
    )


async def _enrich_candidates(
    client: httpx.AsyncClient,
    result: CveDiscoveryResponse,
    *,
    use_kev_cache: bool,
) -> None:
    cve_ids = sorted({alias for item in result.items for alias in _candidate_cve_ids(item)})
    if not cve_ids:
        return
    try:
        epss = await _fetch_epss(client, cve_ids)
    except CveIntelligenceError as exc:
        epss = {}
        result.warnings.append(f"EPSS 丰富失败: {exc}")
    try:
        kev = await _fetch_kev(client, use_cache=use_kev_cache)
    except CveIntelligenceError as exc:
        kev = {}
        result.warnings.append(f"CISA KEV 丰富失败: {exc}")

    for item in result.items:
        aliases = _candidate_cve_ids(item)
        epss_item = next((epss[value] for value in aliases if value in epss), None)
        if epss_item:
            item.epss_score = epss_item[0]
            item.epss_percentile = epss_item[1]
        kev_item = next((kev[value] for value in aliases if value in kev), None)
        if kev_item:
            item.known_exploited = True
            item.kev_due_date = str(kev_item.get("dueDate") or item.kev_due_date)
            item.ransomware_use = str(kev_item.get("knownRansomwareCampaignUse") or item.ransomware_use)


async def _fetch_epss(client: httpx.AsyncClient, cve_ids: list[str]) -> dict[str, tuple[float, float]]:
    payload = await _request_json(client, "GET", _EPSS_URL, params={"cve": ",".join(cve_ids[:50])})
    result: dict[str, tuple[float, float]] = {}
    for item in payload.get("data", []):
        if not isinstance(item, dict):
            continue
        cve_id = str(item.get("cve") or "").upper()
        try:
            result[cve_id] = (float(item["epss"]), float(item["percentile"]))
        except (KeyError, TypeError, ValueError):
            continue
    return result


async def _fetch_kev(client: httpx.AsyncClient, *, use_cache: bool) -> dict[str, dict[str, Any]]:
    global _kev_cache_at, _kev_cache
    now = datetime.now(UTC)
    if use_cache and _kev_cache_at is not None and now - _kev_cache_at < _KEV_CACHE_TTL:
        return _kev_cache
    payload = await _request_json(client, "GET", _KEV_URL)
    items = {
        str(item.get("cveID") or "").upper(): item
        for item in payload.get("vulnerabilities", [])
        if isinstance(item, dict) and _CVE_RE.fullmatch(str(item.get("cveID") or ""))
    }
    if use_cache:
        _kev_cache_at = now
        _kev_cache = items
    return items


async def _request_json(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> dict[str, Any]:
    try:
        response = await client.request(method, url, **kwargs)
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise CveIntelligenceError(_public_http_error(exc)) from exc
    if not isinstance(payload, dict):
        raise CveIntelligenceError("情报源返回了无效数据")
    return payload


def _parse_nvd_candidate(cve: dict[str, Any], request: CveDiscoveryRequest) -> CveCandidateSchema:
    cve_id = str(cve.get("id") or "").upper()
    description = _localized_value(cve.get("descriptions"), "en")
    score, vector, severity = _nvd_cvss(cve.get("metrics") or {})
    confidence, reason = _nvd_match_confidence(cve, request)
    references = _unique_strings(
        str(item.get("url") or "")
        for item in cve.get("references", [])
        if isinstance(item, dict)
    )[:32]
    cwes = _unique_strings(
        str(description_item.get("value") or "")
        for weakness in cve.get("weaknesses", [])
        if isinstance(weakness, dict)
        for description_item in weakness.get("description", [])
        if isinstance(description_item, dict)
    )
    return CveCandidateSchema(
        cve_id=cve_id,
        source="NVD",
        title=_summary_title(description),
        description=description,
        published_at=_parse_datetime(cve.get("published")),
        modified_at=_parse_datetime(cve.get("lastModified")),
        severity=severity,
        cvss_score=score,
        cvss_vector=vector,
        cwes=cwes,
        references=references,
        affected_versions=_nvd_affected_versions(cve),
        match_confidence=confidence,
        match_reason=reason,
        known_exploited=bool(cve.get("cisaExploitAdd")),
        kev_due_date=str(cve.get("cisaActionDue") or ""),
        source_url=f"https://nvd.nist.gov/vuln/detail/{cve_id}" if cve_id else "",
    )


def _parse_osv_candidate(item: dict[str, Any], request: CveDiscoveryRequest) -> CveCandidateSchema:
    aliases = _unique_strings(str(value).upper() for value in item.get("aliases", []))
    raw_id = str(item.get("id") or "").upper()
    cve_id = raw_id if _CVE_RE.fullmatch(raw_id) else next(
        (alias for alias in aliases if _CVE_RE.fullmatch(alias)),
        "",
    )
    vector = next(
        (
            str(entry.get("score") or "")
            for entry in item.get("severity", [])
            if isinstance(entry, dict) and str(entry.get("score") or "").startswith("CVSS:")
        ),
        "",
    )
    score = cvss_v3_base_score(vector)
    database_severity = str((item.get("database_specific") or {}).get("severity") or "")
    fixed_versions = _osv_fixed_versions(item)
    return CveCandidateSchema(
        cve_id=cve_id,
        source="OSV",
        aliases=aliases,
        title=str(item.get("summary") or ""),
        description=str(item.get("details") or item.get("summary") or ""),
        published_at=_parse_datetime(item.get("published")),
        modified_at=_parse_datetime(item.get("modified")),
        severity=_severity_from_score(score, database_severity),
        cvss_score=score,
        cvss_vector=vector,
        references=_unique_strings(
            str(reference.get("url") or "")
            for reference in item.get("references", [])
            if isinstance(reference, dict)
        )[:32],
        affected_versions=_osv_affected_versions(item),
        fixed_versions=fixed_versions,
        match_confidence=CveMatchConfidence.EXACT,
        match_reason=(
            f"OSV 按 {request.ecosystem}:{request.package_name}@{request.version} 精确查询并返回受影响记录。"
        ),
        source_url=f"https://osv.dev/vulnerability/{raw_id}" if raw_id else "",
    )


def _nvd_cvss(metrics: dict[str, Any]) -> tuple[float | None, str, WorkProjectFindingSeverity]:
    for key in ("cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        values = metrics.get(key)
        if not isinstance(values, list) or not values:
            continue
        primary = next((item for item in values if item.get("type") == "Primary"), values[0])
        data = primary.get("cvssData") or {}
        try:
            score = float(data.get("baseScore"))
        except (TypeError, ValueError):
            score = None
        severity = str(data.get("baseSeverity") or primary.get("baseSeverity") or "")
        return score, str(data.get("vectorString") or ""), _severity_from_score(score, severity)
    return None, "", WorkProjectFindingSeverity.INFO


def _nvd_match_confidence(
    cve: dict[str, Any],
    request: CveDiscoveryRequest,
) -> tuple[CveMatchConfidence, str]:
    query_cpe = _parse_cpe(request.cpe) if request.cpe else []
    vendor = request.vendor or (_cpe_field(query_cpe, 3))
    product = request.product or (_cpe_field(query_cpe, 4))
    version = request.version or (_cpe_field(query_cpe, 5))
    matches = [
        match
        for match in _walk_cpe_matches(cve.get("configurations", []))
        if _cpe_product_matches(str(match.get("criteria") or ""), vendor, product)
    ]
    if not matches:
        return CveMatchConfidence.LOW, "NVD 关键词命中，但未在受影响 CPE 配置中确认产品映射。"
    if not version or version in {"*", "-"}:
        return CveMatchConfidence.MEDIUM, "NVD 受影响 CPE 命中产品；目标版本未知，无法完成区间判定。"
    for match in matches:
        criteria = _parse_cpe(str(match.get("criteria") or ""))
        criteria_version = _cpe_field(criteria, 5)
        if criteria_version not in {"", "*", "-"} and _versions_equal(version, criteria_version):
            return CveMatchConfidence.EXACT, f"目标版本 {version} 与 NVD 受影响 CPE 精确匹配。"
        if _version_in_match(version, match):
            return CveMatchConfidence.HIGH, f"目标版本 {version} 落入 NVD 公布的受影响版本区间。"
        if criteria_version in {"", "*", "-"} and not _has_version_bounds(match):
            return CveMatchConfidence.MEDIUM, "NVD 受影响 CPE 命中产品，但情报未提供可判定的版本边界。"
    return CveMatchConfidence.LOW, f"产品命中，但目标版本 {version} 未落入 NVD 公布的受影响版本范围。"


def _walk_cpe_matches(value: Any):
    if isinstance(value, list):
        for item in value:
            yield from _walk_cpe_matches(item)
    elif isinstance(value, dict):
        for item in value.get("cpeMatch", []):
            if isinstance(item, dict) and item.get("vulnerable", True):
                yield item
        for key in ("nodes", "children", "configurations"):
            yield from _walk_cpe_matches(value.get(key, []))


def _parse_cpe(value: str) -> list[str]:
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for char in value:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(char)
    current.append("\\" if escaped else "")
    fields.append("".join(current))
    return fields


def _cpe_field(fields: list[str], index: int) -> str:
    return fields[index] if len(fields) > index else ""


def _cpe_product_matches(criteria: str, vendor: str, product: str) -> bool:
    fields = _parse_cpe(criteria)
    cpe_vendor, cpe_product = _cpe_field(fields, 3), _cpe_field(fields, 4)
    return (
        (not vendor or _normalized_product(vendor) == _normalized_product(cpe_vendor))
        and (not product or _normalized_product(product) == _normalized_product(cpe_product))
    )


def _normalized_product(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _has_version_bounds(match: dict[str, Any]) -> bool:
    return any(str(match.get(key) or "") for key in (
        "versionStartIncluding", "versionStartExcluding", "versionEndIncluding", "versionEndExcluding",
    ))


def _version_in_match(version: str, match: dict[str, Any]) -> bool:
    if not _has_version_bounds(match):
        return False
    checks = (
        ("versionStartIncluding", lambda result: result >= 0),
        ("versionStartExcluding", lambda result: result > 0),
        ("versionEndIncluding", lambda result: result <= 0),
        ("versionEndExcluding", lambda result: result < 0),
    )
    for key, predicate in checks:
        boundary = str(match.get(key) or "")
        if boundary and not predicate(_compare_versions(version, boundary)):
            return False
    return True


def _compare_versions(left: str, right: str) -> int:
    try:
        left_version, right_version = Version(left), Version(right)
        return (left_version > right_version) - (left_version < right_version)
    except InvalidVersion:
        left_parts, right_parts = _loose_version(left), _loose_version(right)
        return (left_parts > right_parts) - (left_parts < right_parts)


def _versions_equal(left: str, right: str) -> bool:
    return _compare_versions(left, right) == 0


def _loose_version(value: str) -> tuple[tuple[int, int | str], ...]:
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part.lower())
        for part in re.findall(r"\d+|[A-Za-z]+", value)
    )


def _nvd_affected_versions(cve: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for match in _walk_cpe_matches(cve.get("configurations", [])):
        criteria = _parse_cpe(str(match.get("criteria") or ""))
        product = _cpe_field(criteria, 4)
        version = _cpe_field(criteria, 5)
        bounds = [
            f">={match['versionStartIncluding']}" if match.get("versionStartIncluding") else "",
            f">{match['versionStartExcluding']}" if match.get("versionStartExcluding") else "",
            f"<={match['versionEndIncluding']}" if match.get("versionEndIncluding") else "",
            f"<{match['versionEndExcluding']}" if match.get("versionEndExcluding") else "",
        ]
        expression = " ".join(value for value in bounds if value) or version
        label = f"{product} {expression}".strip()
        if label and label not in values:
            values.append(label)
        if len(values) >= 20:
            break
    return values


def _osv_fixed_versions(item: dict[str, Any]) -> list[str]:
    return _unique_strings(
        str(event.get("fixed") or "")
        for affected in item.get("affected", [])
        if isinstance(affected, dict)
        for item_range in affected.get("ranges", [])
        if isinstance(item_range, dict)
        for event in item_range.get("events", [])
        if isinstance(event, dict) and event.get("fixed")
    )


def _osv_affected_versions(item: dict[str, Any]) -> list[str]:
    explicit = _unique_strings(
        str(version)
        for affected in item.get("affected", [])
        if isinstance(affected, dict)
        for version in affected.get("versions", [])
    )
    if explicit:
        return explicit[:20]
    return _unique_strings(
        " ".join(f"{key} {value}" for key, value in event.items())
        for affected in item.get("affected", [])
        if isinstance(affected, dict)
        for item_range in affected.get("ranges", [])
        if isinstance(item_range, dict)
        for event in item_range.get("events", [])
        if isinstance(event, dict)
    )[:20]


def _localized_value(items: Any, language: str) -> str:
    if not isinstance(items, list):
        return ""
    selected = next(
        (item for item in items if isinstance(item, dict) and item.get("lang") == language),
        next((item for item in items if isinstance(item, dict)), {}),
    )
    return str(selected.get("value") or "")


def _summary_title(description: str) -> str:
    summary = re.split(r"(?<=[.!?])\s+", description.strip(), maxsplit=1)[0]
    return summary[:180].rstrip()


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _candidate_cve_ids(item: CveCandidateSchema) -> list[str]:
    return _unique_strings(
        value.upper()
        for value in (item.cve_id, *item.aliases)
        if _CVE_RE.fullmatch(value)
    )


def _candidate_sort_key(item: CveCandidateSchema):
    confidence_rank = {
        CveMatchConfidence.EXACT: 3,
        CveMatchConfidence.HIGH: 2,
        CveMatchConfidence.MEDIUM: 1,
        CveMatchConfidence.LOW: 0,
    }[item.match_confidence]
    return (
        -int(item.known_exploited),
        -confidence_rank,
        -(item.epss_score or 0),
        -(item.cvss_score or 0),
        item.cve_id,
    )


def _unique_strings(values) -> list[str]:
    result: list[str] = []
    for value in values:
        item = value.strip()
        if item and item not in result:
            result.append(item)
    return result


def _severity_from_score(score: float | None, label: str = "") -> WorkProjectFindingSeverity:
    normalized = label.lower()
    if normalized in {item.value for item in WorkProjectFindingSeverity}:
        return WorkProjectFindingSeverity(normalized)
    if score is None:
        return WorkProjectFindingSeverity.INFO
    if score >= 9:
        return WorkProjectFindingSeverity.CRITICAL
    if score >= 7:
        return WorkProjectFindingSeverity.HIGH
    if score >= 4:
        return WorkProjectFindingSeverity.MEDIUM
    if score > 0:
        return WorkProjectFindingSeverity.LOW
    return WorkProjectFindingSeverity.INFO


def cvss_v3_base_score(vector: str) -> float | None:
    if not vector.startswith(("CVSS:3.0/", "CVSS:3.1/")):
        return None
    metrics = dict(
        part.split(":", 1)
        for part in vector.split("/")[1:]
        if ":" in part
    )
    scope = metrics.get("S")
    weights = {
        "AV": {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2},
        "AC": {"L": 0.77, "H": 0.44},
        "UI": {"N": 0.85, "R": 0.62},
        "C": {"H": 0.56, "L": 0.22, "N": 0},
        "I": {"H": 0.56, "L": 0.22, "N": 0},
        "A": {"H": 0.56, "L": 0.22, "N": 0},
    }
    pr_weights = {
        "U": {"N": 0.85, "L": 0.62, "H": 0.27},
        "C": {"N": 0.85, "L": 0.68, "H": 0.5},
    }
    try:
        impact_subscore = 1 - math.prod(1 - weights[key][metrics[key]] for key in ("C", "I", "A"))
        if scope == "U":
            impact = 6.42 * impact_subscore
        else:
            impact = 7.52 * (impact_subscore - 0.029) - 3.25 * (impact_subscore - 0.02) ** 15
        exploitability = (
            8.22
            * weights["AV"][metrics["AV"]]
            * weights["AC"][metrics["AC"]]
            * pr_weights[str(scope)][metrics["PR"]]
            * weights["UI"][metrics["UI"]]
        )
    except (KeyError, TypeError):
        return None
    if impact <= 0:
        return 0.0
    raw = min(impact + exploitability, 10) if scope == "U" else min(1.08 * (impact + exploitability), 10)
    return math.ceil((raw - 1e-10) * 10) / 10


def _public_http_error(error: Exception) -> str:
    if isinstance(error, httpx.HTTPStatusError):
        return f"{error.response.status_code} {error.response.reason_phrase}"
    if isinstance(error, httpx.TimeoutException):
        return "请求超时"
    if isinstance(error, httpx.RequestError):
        return "无法连接情报源"
    return "情报源返回了无效 JSON"
