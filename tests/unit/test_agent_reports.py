import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from service.agent import reports


class AgentReportTests(unittest.IsolatedAsyncioTestCase):
    async def test_exported_report_is_resolvable_and_downloadable(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(reports, "REPORT_ROOT", Path(temp_dir)):
            exported = await reports.export_session_report("session-1", "# Result\n")
            report_path = reports.resolve_report_download_path(exported.report_id)

            self.assertEqual("# Result\n", report_path.read_text(encoding="utf-8"))
            self.assertEqual(report_path.stat().st_size, exported.size)
            self.assertEqual("session-1", reports.report_session_id(report_path))
            self.assertTrue(exported.filename.startswith("session-1-"))

    async def test_report_id_cannot_escape_report_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(reports, "REPORT_ROOT", Path(temp_dir)):
            for report_id in ("../outside:abc-1234", "session:../escape", "invalid"):
                with self.subTest(report_id=report_id), self.assertRaises(ValueError):
                    reports.resolve_report_download_path(report_id)

    async def test_cleanup_only_removes_expired_valid_report_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(reports, "REPORT_ROOT", Path(temp_dir)):
            exported = await reports.export_session_report("session-1", "old")
            report_path = reports.resolve_report_download_path(exported.report_id)
            report_path.touch()

            deleted = reports._cleanup_expired_reports_sync(report_path.stat().st_mtime + 1)

            self.assertEqual(1, deleted)
            self.assertFalse(report_path.exists())


if __name__ == "__main__":
    unittest.main()
