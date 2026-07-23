from __future__ import annotations

import io
import os
import tempfile
import unittest
import zipfile

from fastapi.testclient import TestClient

from skill_hub.app import create_skill_hub_app
from skill_hub.config import reset_skill_hub_settings


def _skill_package() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "SKILL.md",
            (
                "---\n"
                "name: incident-helper\n"
                "title: Incident Helper\n"
                "description: Guide an agent through evidence-preserving incident response.\n"
                "tags: [incident-response, security]\n"
                "---\n\n"
                "# Incident Helper\n\n"
                "Collect evidence before changing the affected system.\n"
            ),
        )
        archive.writestr("references/checklist.md", "# Checklist\n")
    return output.getvalue()


class SkillHubApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        os.environ["SKILL_HUB_DATA_DIR"] = self.temp_dir.name
        os.environ["SKILL_HUB_JWT_SECRET"] = "test-only-secret-that-is-long-enough-for-hmac"
        reset_skill_hub_settings()
        self.client_context = TestClient(create_skill_hub_app())
        self.client = self.client_context.__enter__()

    def tearDown(self) -> None:
        self.client_context.__exit__(None, None, None)
        reset_skill_hub_settings()
        os.environ.pop("SKILL_HUB_DATA_DIR", None)
        os.environ.pop("SKILL_HUB_JWT_SECRET", None)
        self.temp_dir.cleanup()

    def _register(self) -> tuple[str, dict]:
        response = self.client.post(
            "/api/v1/auth/register",
            json={
                "username": "alice-dev",
                "email": "alice@example.test",
                "display_name": "Alice",
                "password": "correct horse battery staple",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        return body["access_token"], body

    def test_complete_publish_discover_download_and_social_flow(self) -> None:
        token, auth = self._register()
        headers = {"Authorization": f"Bearer {token}"}
        self.assertEqual(auth["user"]["username"], "alice-dev")

        publish = self.client.post(
            "/api/v1/skills/publish",
            headers=headers,
            data={
                "namespace": "alice-dev",
                "slug": "incident-helper",
                "version": "1.0.0",
                "changelog": "Initial release",
                "visibility": "public",
            },
            files={
                "package": (
                    "incident-helper.zip",
                    _skill_package(),
                    "application/zip",
                )
            },
        )
        self.assertEqual(publish.status_code, 201, publish.text)
        published = publish.json()
        self.assertEqual(published["latest_version"], "1.0.0")
        self.assertEqual(published["versions"][0]["scan_status"], "passed")

        listing = self.client.get("/api/v1/skills?q=incident")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual(listing.json()["total"], 1)
        self.assertEqual(listing.json()["items"][0]["slug"], "incident-helper")

        star = self.client.post(
            "/api/v1/skills/alice-dev/incident-helper/star",
            headers=headers,
        )
        self.assertEqual(star.status_code, 204, star.text)
        rating = self.client.post(
            "/api/v1/skills/alice-dev/incident-helper/rating",
            headers=headers,
            json={"score": 5},
        )
        self.assertEqual(rating.status_code, 204, rating.text)

        detail = self.client.get(
            "/api/v1/skills/alice-dev/incident-helper",
            headers=headers,
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertTrue(detail.json()["starred"])
        self.assertEqual(detail.json()["my_rating"], 5)
        self.assertEqual(detail.json()["rating_average"], 5)

        download = self.client.get(
            "/api/v1/skills/alice-dev/incident-helper/download?version=1.0.0"
        )
        self.assertEqual(download.status_code, 200, download.text)
        self.assertEqual(download.headers["x-skill-version"], "1.0.0")
        self.assertEqual(len(download.headers["x-skill-sha256"]), 64)
        with zipfile.ZipFile(io.BytesIO(download.content)) as archive:
            self.assertIn("SKILL.md", archive.namelist())

    def test_rejects_duplicate_user_and_unauthenticated_publish(self) -> None:
        self._register()
        duplicate = self.client.post(
            "/api/v1/auth/register",
            json={
                "username": "alice-dev",
                "email": "alice2@example.test",
                "display_name": "Alice 2",
                "password": "correct horse battery staple",
            },
        )
        self.assertEqual(duplicate.status_code, 409)

        publish = self.client.post(
            "/api/v1/skills/publish",
            data={
                "namespace": "alice-dev",
                "slug": "incident-helper",
                "version": "1.0.0",
            },
            files={"package": ("skill.zip", _skill_package(), "application/zip")},
        )
        self.assertEqual(publish.status_code, 401)

    def test_namespace_visibility_requires_membership(self) -> None:
        token, _ = self._register()
        headers = {"Authorization": f"Bearer {token}"}
        publish = self.client.post(
            "/api/v1/skills/publish",
            headers=headers,
            data={
                "namespace": "alice-dev",
                "slug": "incident-helper",
                "version": "1.0.0",
                "visibility": "namespace",
            },
            files={"package": ("skill.zip", _skill_package(), "application/zip")},
        )
        self.assertEqual(publish.status_code, 201, publish.text)

        anonymous_list = self.client.get("/api/v1/skills")
        self.assertEqual(anonymous_list.status_code, 200)
        self.assertEqual(anonymous_list.json()["total"], 0)
        anonymous_detail = self.client.get("/api/v1/skills/alice-dev/incident-helper")
        self.assertEqual(anonymous_detail.status_code, 404)

        member_detail = self.client.get(
            "/api/v1/skills/alice-dev/incident-helper",
            headers=headers,
        )
        self.assertEqual(member_detail.status_code, 200, member_detail.text)
