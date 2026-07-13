import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import _bootstrap_desktop_user
from config import DatabaseConfig, get_config
from database import close_engine, create_all_tables, init_engine
from middleware.auth import decode_access_token, desktop_mode_enabled
from schema.system_user.users import SystemUserRole
from service.system_user.users import issue_system_user_token, query_system_user_by_username


class DesktopSessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="zj-desktop-session-test-")
        self.original_database = get_config().database.model_copy(deep=True)
        database_path = Path(self.temp_dir.name) / "test.sqlite3"
        get_config().database = DatabaseConfig(
            url=f"sqlite+aiosqlite:///{database_path.as_posix()}",
        )
        init_engine()
        await create_all_tables()

    async def asyncTearDown(self) -> None:
        await close_engine()
        get_config().database = self.original_database
        self.temp_dir.cleanup()

    async def test_desktop_mode_creates_local_admin_and_issues_token(self) -> None:
        with patch.dict(os.environ, {"ZJ_DESKTOP_MODE": "true"}):
            self.assertTrue(desktop_mode_enabled())
            await _bootstrap_desktop_user()

        user = await query_system_user_by_username("desktop")
        self.assertIsNotNone(user)
        assert user is not None
        self.assertEqual(SystemUserRole.ADMIN, user.role)
        self.assertTrue(user.password.startswith("pbkdf2_sha256$"))

        auth_user = decode_access_token(issue_system_user_token(user))
        self.assertIsNotNone(auth_user)
        assert auth_user is not None
        self.assertEqual(user.id, auth_user.id)
        self.assertEqual(SystemUserRole.ADMIN, auth_user.role)
        self.assertEqual("desktop@localhost", auth_user.email)

    async def test_desktop_bootstrap_is_disabled_by_default(self) -> None:
        with patch.dict(os.environ, {"ZJ_DESKTOP_MODE": ""}):
            self.assertFalse(desktop_mode_enabled())
            await _bootstrap_desktop_user()

        self.assertIsNone(await query_system_user_by_username("desktop"))


if __name__ == "__main__":
    unittest.main()
