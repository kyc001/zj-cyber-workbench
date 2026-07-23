from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SkillHubSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    database_url: str
    redis_url: str = ""
    storage_dir: Path
    jwt_secret: str
    access_token_minutes: int = Field(default=24 * 60, ge=5, le=30 * 24 * 60)
    bind_host: str = "127.0.0.1"
    bind_port: int = Field(default=8011, ge=1, le=65535)
    cors_origins: tuple[str, ...] = ("http://127.0.0.1:3011", "http://localhost:3011")
    max_package_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    max_unpacked_bytes: int = Field(default=20 * 1024 * 1024, ge=1024)
    max_single_file_bytes: int = Field(default=2 * 1024 * 1024, ge=1024)
    max_package_files: int = Field(default=256, ge=1, le=4096)

    @field_validator("storage_dir")
    @classmethod
    def normalize_storage_dir(cls, value: Path) -> Path:
        return value.expanduser().resolve()


def _default_data_dir() -> Path:
    configured = os.environ.get("SKILL_HUB_DATA_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path(__file__).resolve().parents[1] / ".zj" / "skill-hub").resolve()


@lru_cache(maxsize=1)
def get_skill_hub_settings() -> SkillHubSettings:
    data_dir = _default_data_dir()
    database_url = os.environ.get("SKILL_HUB_DATABASE_URL", "").strip()
    if not database_url:
        database_url = f"sqlite+aiosqlite:///{(data_dir / 'skill-hub.sqlite3').as_posix()}"
    jwt_secret = os.environ.get("SKILL_HUB_JWT_SECRET", "").strip() or secrets.token_urlsafe(48)
    origins = tuple(
        origin.strip()
        for origin in os.environ.get(
            "SKILL_HUB_CORS_ORIGINS",
            "http://127.0.0.1:3011,http://localhost:3011",
        ).split(",")
        if origin.strip()
    )
    return SkillHubSettings(
        database_url=database_url,
        redis_url=os.environ.get("SKILL_HUB_REDIS_URL", "").strip(),
        storage_dir=Path(os.environ.get("SKILL_HUB_STORAGE_DIR", "").strip() or data_dir / "packages"),
        jwt_secret=jwt_secret,
        access_token_minutes=int(os.environ.get("SKILL_HUB_ACCESS_TOKEN_MINUTES", 24 * 60)),
        bind_host=os.environ.get("SKILL_HUB_BIND_HOST", "127.0.0.1").strip(),
        bind_port=int(os.environ.get("SKILL_HUB_BIND_PORT", 8011)),
        cors_origins=origins,
    )


def reset_skill_hub_settings() -> None:
    get_skill_hub_settings.cache_clear()
