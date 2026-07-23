from __future__ import annotations

import io
import os
import tempfile
import unittest
import zipfile

from skill_hub.config import reset_skill_hub_settings
from skill_hub.packages import PackageValidationError, validate_skill_package


def _archive(files: dict[str, str | bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return output.getvalue()


class SkillHubPackageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        os.environ["SKILL_HUB_DATA_DIR"] = self.temp_dir.name
        reset_skill_hub_settings()

    def tearDown(self) -> None:
        reset_skill_hub_settings()
        os.environ.pop("SKILL_HUB_DATA_DIR", None)
        self.temp_dir.cleanup()

    def test_validates_and_normalizes_wrapped_skill(self) -> None:
        payload = _archive(
            {
                "sample/SKILL.md": (
                    "---\n"
                    "name: sample-skill\n"
                    "description: A portable sample skill.\n"
                    "tags: [demo, portable]\n"
                    "---\n\n"
                    "# Sample\n"
                ),
                "sample/scripts/run.py": "print('ok')\n",
            }
        )

        result = validate_skill_package(payload, "sample-skill")

        self.assertEqual(result.metadata["name"], "sample-skill")
        self.assertEqual(result.metadata["tags"], ["demo", "portable"])
        self.assertEqual(result.manifest["file_count"], 2)
        self.assertEqual(result.sha256, result.manifest["sha256"])
        with zipfile.ZipFile(io.BytesIO(result.content)) as archive:
            self.assertEqual(sorted(archive.namelist()), ["SKILL.md", "scripts/run.py"])

    def test_rejects_path_traversal(self) -> None:
        payload = _archive(
            {
                "SKILL.md": "---\nname: safe-skill\ndescription: Safe.\n---\n",
                "../outside.txt": "bad",
            }
        )
        with self.assertRaisesRegex(PackageValidationError, "unsafe package path"):
            validate_skill_package(payload, "safe-skill")

    def test_rejects_absolute_and_nonportable_windows_paths(self) -> None:
        for unsafe_path, expected_error in (
            ("/absolute.txt", "unsafe package path"),
            ("C:/absolute.txt", "unsafe package path"),
            ("references/CON.txt", "not portable"),
        ):
            with self.subTest(path=unsafe_path):
                payload = _archive(
                    {
                        "SKILL.md": "---\nname: safe-skill\ndescription: Safe.\n---\n",
                        unsafe_path: "bad",
                    }
                )
                with self.assertRaisesRegex(PackageValidationError, expected_error):
                    validate_skill_package(payload, "safe-skill")

    def test_rejects_binary_executable(self) -> None:
        payload = _archive(
            {
                "SKILL.md": "---\nname: unsafe-skill\ndescription: Unsafe.\n---\n",
                "scripts/tool.exe": b"MZ",
            }
        )
        with self.assertRaisesRegex(PackageValidationError, "binary file type"):
            validate_skill_package(payload, "unsafe-skill")

    def test_rejects_name_mismatch(self) -> None:
        payload = _archive(
            {"SKILL.md": "---\nname: other-skill\ndescription: Mismatch.\n---\n"}
        )
        with self.assertRaisesRegex(PackageValidationError, "must match"):
            validate_skill_package(payload, "expected-skill")

    def test_rejects_probable_private_key(self) -> None:
        payload = _archive(
            {
                "SKILL.md": "---\nname: leaked-skill\ndescription: Leak.\n---\n",
                "references/key.txt": "-----BEGIN PRIVATE KEY-----\nsecret",
            }
        )
        with self.assertRaisesRegex(PackageValidationError, "private key"):
            validate_skill_package(payload, "leaked-skill")


class SkillHubSecurityTests(unittest.TestCase):
    def test_password_hash_round_trip(self) -> None:
        from skill_hub.security import hash_password, verify_password

        encoded = hash_password("correct horse battery staple")

        self.assertTrue(verify_password("correct horse battery staple", encoded))
        self.assertFalse(verify_password("wrong password", encoded))

    def test_semver_validation(self) -> None:
        from skill_hub.security import validate_semver

        self.assertEqual(validate_semver("1.2.3-beta.1+build.7"), "1.2.3-beta.1+build.7")
        with self.assertRaises(ValueError):
            validate_semver("latest")
