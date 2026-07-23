from __future__ import annotations

import tempfile
from pathlib import Path

from skill_hub.config import get_skill_hub_settings


def package_storage_path(storage_key: str) -> Path:
    settings = get_skill_hub_settings()
    root = settings.storage_dir
    candidate = (root / storage_key).resolve()
    if candidate == root or root not in candidate.parents:
        raise ValueError("invalid package storage key")
    return candidate


def store_package(storage_key: str, content: bytes) -> Path:
    target = package_storage_path(storage_key)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise FileExistsError("immutable package object already exists")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=target.parent,
            prefix=".upload-",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(content)
            handle.flush()
        temp_path.replace(target)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
    return target
