from __future__ import annotations

import hashlib
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

from schema.skill_hub import InstallHubSkillRequest
from service import skill_hub as local_hub


def _package() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "SKILL.md",
            (
                "---\n"
                "name: install-test\n"
                "description: Exercise the secure ZJ Skill Hub installer.\n"
                "---\n\n"
                "# Install Test\n"
            ),
        )
    return output.getvalue()


def _detail(digest: str, package_size: int) -> dict:
    return {
        "namespace": "group11",
        "slug": "install-test",
        "name": "Install Test",
        "summary": "Exercise the secure installer.",
        "description": "# Install Test",
        "tags": ["test"],
        "latest_version": "1.0.0",
        "downloads": 0,
        "stars": 0,
        "rating_average": 0,
        "rating_count": 0,
        "updated_at": "2026-07-23T00:00:00Z",
        "visibility": "public",
        "author_username": "group11",
        "versions": [
            {
                "version": "1.0.0",
                "changelog": "Initial",
                "sha256": digest,
                "size_bytes": package_size,
                "scan_status": "passed",
                "scan_warnings": [],
                "published_at": "2026-07-23T00:00:00Z",
            }
        ],
        "starred": False,
        "my_rating": None,
    }


class SkillHubInstallationTests(unittest.IsolatedAsyncioTestCase):
    async def test_installs_updates_discovers_and_uninstalls_managed_skill(self) -> None:
        package = _package()
        digest = hashlib.sha256(package).hexdigest()
        detail = _detail(digest, len(package))
        with tempfile.TemporaryDirectory() as temp_dir:
            custom_root = Path(temp_dir) / "skills"
            with (
                patch("core.agent.customization.CUSTOM_SKILLS_DIR", custom_root),
                patch.object(local_hub, "CUSTOM_SKILLS_DIR", custom_root),
                patch.object(local_hub, "_hub_json", AsyncMock(return_value=detail)),
                patch.object(local_hub, "_download_package", AsyncMock(return_value=package)),
                patch.object(local_hub, "rebuild_agent_instances", AsyncMock()) as rebuild,
            ):
                request = InstallHubSkillRequest(
                    namespace="group11",
                    slug="install-test",
                    version="1.0.0",
                )
                first = await local_hub.install_hub_skill(request)
                second = await local_hub.install_hub_skill(request)

                self.assertFalse(first.updated)
                self.assertTrue(second.updated)
                self.assertTrue((custom_root / "install-test" / "SKILL.md").is_file())
                self.assertEqual(
                    local_hub.list_installed_hub_skills()[0].sha256,
                    digest,
                )
                self.assertEqual(rebuild.await_count, 2)

                await local_hub.uninstall_hub_skill("install-test")

                self.assertFalse((custom_root / "install-test").exists())
                self.assertEqual(rebuild.await_count, 3)

    async def test_does_not_overwrite_unmanaged_custom_skill(self) -> None:
        package = _package()
        digest = hashlib.sha256(package).hexdigest()
        with tempfile.TemporaryDirectory() as temp_dir:
            custom_root = Path(temp_dir) / "skills"
            existing = custom_root / "install-test"
            existing.mkdir(parents=True)
            (existing / "SKILL.md").write_text("# local", encoding="utf-8")
            with (
                patch("core.agent.customization.CUSTOM_SKILLS_DIR", custom_root),
                patch.object(local_hub, "CUSTOM_SKILLS_DIR", custom_root),
                patch.object(
                    local_hub,
                    "get_hub_skill",
                    AsyncMock(
                        return_value=local_hub.HubSkillDetailSchema.model_validate(
                            _detail(digest, len(package))
                        )
                    ),
                ),
                patch.object(local_hub, "_download_package", AsyncMock(return_value=package)),
            ):
                from fastapi import HTTPException

                with self.assertRaisesRegex(HTTPException, "not managed by Skill Hub"):
                    await local_hub.install_hub_skill(
                        InstallHubSkillRequest(
                            namespace="group11",
                            slug="install-test",
                            version="1.0.0",
                        )
                    )
