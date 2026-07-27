from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from http import HTTPStatus
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException

from core.agent.customization import (
    CUSTOM_SKILLS_DIR,
    custom_skill_root,
    validate_skill_name,
)
from schema.skill_hub import (
    HubSkillDetailSchema,
    HubSkillListSchema,
    InstalledHubSkillSchema,
    InstallHubSkillRequest,
    InstallHubSkillResponse,
)
from service.system_config.config import rebuild_agent_instances
from skill_hub.packages import PackageValidationError, validate_skill_package

_INSTALL_MANIFEST = ".zj-skillhub.json"
_DEFAULT_HUB_URL = "http://118.31.221.165:8011"
_MAX_REMOTE_RESPONSE_BYTES = 12 * 1024 * 1024


def skill_hub_base_url() -> str:
    return os.environ.get("ZJ_SKILL_HUB_URL", _DEFAULT_HUB_URL).strip().rstrip("/")


async def query_hub_skills(
    *,
    q: str = "",
    sort: str = "recent",
    page: int = 1,
    page_size: int = 24,
) -> HubSkillListSchema:
    payload = await _hub_json(
        "/api/v1/skills",
        params={
            "q": q,
            "sort": sort,
            "page": page,
            "page_size": page_size,
        },
    )
    return HubSkillListSchema.model_validate(payload)


async def get_hub_skill(namespace: str, slug: str) -> HubSkillDetailSchema:
    namespace_name = _safe_name(namespace, "namespace")
    skill_name = _safe_name(slug, "skill")
    payload = await _hub_json(f"/api/v1/skills/{namespace_name}/{skill_name}")
    return HubSkillDetailSchema.model_validate(payload)


def list_installed_hub_skills() -> list[InstalledHubSkillSchema]:
    installed: list[InstalledHubSkillSchema] = []
    if not CUSTOM_SKILLS_DIR.is_dir():
        return installed
    for manifest_path in CUSTOM_SKILLS_DIR.glob(f"*/{_INSTALL_MANIFEST}"):
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            installed.append(InstalledHubSkillSchema.model_validate(payload))
        except (OSError, ValueError):
            continue
    return sorted(installed, key=lambda item: item.name)


async def install_hub_skill(request: InstallHubSkillRequest) -> InstallHubSkillResponse:
    namespace = _safe_name(request.namespace, "namespace")
    slug = _safe_name(request.slug, "skill")
    detail = await get_hub_skill(namespace, slug)
    version = request.version.strip() or detail.latest_version
    selected = next((item for item in detail.versions if item.version == version), None)
    if selected is None:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND.value,
            detail="Skill Hub version not found",
        )
    payload = await _download_package(namespace, slug, version)
    artifact_sha256 = hashlib.sha256(payload).hexdigest()
    if artifact_sha256 != selected.sha256:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY.value,
            detail="Skill Hub package SHA-256 does not match registry metadata",
        )
    try:
        validated = validate_skill_package(payload, slug)
    except (PackageValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY.value,
            detail=f"Skill Hub package validation failed: {exc}",
        ) from exc
    try:
        skill_name = validate_skill_name(str(validated.metadata["name"]))
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_GATEWAY.value, detail=str(exc)) from exc
    target = custom_skill_root(skill_name)
    existing_manifest = _read_manifest(target)
    if target.exists() and existing_manifest is None:
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT.value,
            detail="A local custom Skill with the same name already exists and is not managed by Skill Hub",
        )
    if existing_manifest is not None and (
        existing_manifest.namespace != namespace or existing_manifest.slug != slug
    ):
        raise HTTPException(
            status_code=HTTPStatus.CONFLICT.value,
            detail="The local Skill name is already owned by another Skill Hub package",
        )
    updated = target.exists()
    installed_at = datetime.now(UTC)
    manifest = InstalledHubSkillSchema(
        name=skill_name,
        namespace=namespace,
        slug=slug,
        version=version,
        sha256=artifact_sha256,
        installed_at=installed_at,
    )
    _atomic_install(target, validated.content, manifest)
    await rebuild_agent_instances()
    return InstallHubSkillResponse(installed=manifest, updated=updated)


async def uninstall_hub_skill(name: str) -> None:
    try:
        skill_name = validate_skill_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST.value, detail=str(exc)) from exc
    target = custom_skill_root(skill_name)
    if _read_manifest(target) is None:
        raise HTTPException(
            status_code=HTTPStatus.NOT_FOUND.value,
            detail="Installed Skill Hub package not found",
        )
    if target == CUSTOM_SKILLS_DIR or CUSTOM_SKILLS_DIR not in target.parents:
        raise HTTPException(status_code=HTTPStatus.FORBIDDEN.value, detail="Invalid Skill path")
    shutil.rmtree(target)
    await rebuild_agent_instances()


async def _hub_json(path: str, *, params: dict[str, Any] | None = None) -> Any:
    return await _hub_request_json("GET", path, params=params)


async def _hub_request_json(
    method: str,
    path: str,
    *,
    params: dict[str, Any] | None = None,
    json_payload: dict[str, Any] | None = None,
    bearer_token: str = "",
) -> Any:
    headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else None
    try:
        async with httpx.AsyncClient(base_url=skill_hub_base_url(), timeout=15, follow_redirects=False) as client:
            response = await client.request(method, path, params=params, json=json_payload, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="Skill Hub is currently unavailable",
        ) from exc
    if response.status_code == HTTPStatus.NOT_FOUND.value:
        raise HTTPException(status_code=HTTPStatus.NOT_FOUND.value, detail="Skill Hub resource not found")
    if response.status_code in (HTTPStatus.UNAUTHORIZED.value, HTTPStatus.FORBIDDEN.value, HTTPStatus.CONFLICT.value):
        detail = _response_detail(response) or f"Skill Hub returned HTTP {response.status_code}"
        raise HTTPException(status_code=response.status_code, detail=detail)
    if response.status_code >= HTTPStatus.BAD_REQUEST.value:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY.value,
            detail=_response_detail(response) or f"Skill Hub returned HTTP {response.status_code}",
        )
    try:
        return response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY.value,
            detail="Skill Hub returned an invalid JSON response",
        ) from exc


def _response_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return ""
    detail = payload.get("detail") if isinstance(payload, dict) else None
    return detail if isinstance(detail, str) else ""


async def _download_package(namespace: str, slug: str, version: str) -> bytes:
    path = f"/api/v1/skills/{namespace}/{slug}/download"
    try:
        async with httpx.AsyncClient(base_url=skill_hub_base_url(), timeout=30, follow_redirects=False) as client:
            async with client.stream("GET", path, params={"version": version}) as response:
                if response.status_code != HTTPStatus.OK.value:
                    raise HTTPException(
                        status_code=HTTPStatus.BAD_GATEWAY.value,
                        detail=f"Skill Hub download returned HTTP {response.status_code}",
                    )
                chunks: list[bytes] = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > _MAX_REMOTE_RESPONSE_BYTES:
                        raise HTTPException(
                            status_code=HTTPStatus.BAD_GATEWAY.value,
                            detail="Skill Hub package exceeds the download size limit",
                        )
                    chunks.append(chunk)
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE.value,
            detail="Skill Hub download failed",
        ) from exc
    return b"".join(chunks)


def _atomic_install(
    target: Path,
    archive_payload: bytes,
    manifest: InstalledHubSkillSchema,
) -> None:
    CUSTOM_SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{target.name}.install-", dir=CUSTOM_SKILLS_DIR))
    backup = CUSTOM_SKILLS_DIR / f".{target.name}.backup-{uuid.uuid4().hex}"
    moved_existing = False
    installed_new = False
    try:
        with zipfile.ZipFile(_bytes_io(archive_payload)) as archive:
            archive.extractall(temporary)
        (temporary / _INSTALL_MANIFEST).write_text(
            json.dumps(manifest.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if target.exists():
            target.replace(backup)
            moved_existing = True
        temporary.replace(target)
        installed_new = True
        if backup.exists():
            shutil.rmtree(backup)
    except BaseException:
        if installed_new and target.exists():
            shutil.rmtree(target, ignore_errors=True)
        if moved_existing and backup.exists():
            backup.replace(target)
        raise
    finally:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)
        if backup.exists() and target.exists():
            shutil.rmtree(backup, ignore_errors=True)


def _read_manifest(root: Path) -> InstalledHubSkillSchema | None:
    manifest_path = root / _INSTALL_MANIFEST
    if not manifest_path.is_file():
        return None
    try:
        return InstalledHubSkillSchema.model_validate_json(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _safe_name(value: str, label: str) -> str:
    normalized = value.strip().lower()
    if not normalized or len(normalized) > 64:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST.value, detail=f"Invalid {label} name")
    try:
        return validate_skill_name(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=HTTPStatus.BAD_REQUEST.value, detail=f"Invalid {label} name") from exc


def _bytes_io(payload: bytes):
    from io import BytesIO

    return BytesIO(payload)
