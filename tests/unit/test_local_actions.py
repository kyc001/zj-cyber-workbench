from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import create_app
from schema.toolpack import ExecutionErrorCode
from service import toolpack
from service.host import powershell


class LocalActionsTests(unittest.IsolatedAsyncioTestCase):
    async def test_powershell_action_is_platform_unsupported_on_non_windows(self) -> None:
        with patch.object(powershell.os, "name", "posix"):
            result = await powershell.run_local_powershell_action("system.summary", timeout_seconds=1)

        self.assertFalse(result.ok)
        self.assertEqual(ExecutionErrorCode.PLATFORM_UNSUPPORTED, result.error_code)

    async def test_powershell_unknown_action_is_not_found(self) -> None:
        with self.assertRaises(FileNotFoundError):
            await powershell.run_local_powershell_action("missing", timeout_seconds=1)

    def test_local_action_and_toolpack_routes_are_registered(self) -> None:
        app = create_app()
        paths = {route.path for route in app.routes if getattr(route, "path", "").startswith("/api/")}

        self.assertIn("/api/local-actions/powershell/actions", paths)
        self.assertIn("/api/local-actions/powershell/actions/{action_id}/run", paths)
        self.assertIn("/api/local-actions/uac-helper/status", paths)
        self.assertIn("/api/toolpack/artifacts/{artifact_id}", paths)

    def test_toolpack_artifact_path_is_confined(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact_root = root / "toolpack" / "artifacts"
            artifact_root.mkdir(parents=True)
            artifact = artifact_root / "run.stdout.txt"
            artifact.write_text("hello", encoding="utf-8")
            with patch.object(toolpack, "_ARTIFACT_ROOT", artifact_root):
                self.assertEqual(artifact, toolpack.resolve_tool_artifact_path("run.stdout"))
                with self.assertRaises(ValueError):
                    toolpack.resolve_tool_artifact_path("../run.stdout")


if __name__ == "__main__":
    unittest.main()
