from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from config import resolve_workspace


class ConfigWorkspaceTests(unittest.TestCase):
    def test_source_checkout_uses_repository_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"

            workspace = resolve_workspace(root, environ={}, frozen=False)

            self.assertEqual((root / ".zj").resolve(), workspace)

    def test_explicit_data_directory_overrides_packaged_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            configured = Path(directory) / "managed-data"

            workspace = resolve_workspace(
                Path(directory) / "bundle",
                environ={"ZJ_DATA_DIR": str(configured)},
                frozen=True,
                platform="win32",
            )

            self.assertEqual(configured.resolve(), workspace)

    def test_packaged_windows_binary_uses_local_app_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            local_app_data = Path(directory) / "LocalAppData"

            workspace = resolve_workspace(
                Path(directory) / "bundle",
                environ={"LOCALAPPDATA": str(local_app_data)},
                frozen=True,
                platform="win32",
            )

            self.assertEqual((local_app_data / "Zhenjun" / "Data").resolve(), workspace)

    def test_packaged_windows_binary_has_home_directory_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "User"

            workspace = resolve_workspace(
                Path(directory) / "bundle",
                environ={},
                frozen=True,
                platform="win32",
                home=home,
            )

            self.assertEqual(
                (home / "AppData" / "Local" / "Zhenjun" / "Data").resolve(),
                workspace,
            )


if __name__ == "__main__":
    unittest.main()
