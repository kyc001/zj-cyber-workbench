from __future__ import annotations

import hashlib
import io
import re
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from skill_hub.config import get_skill_hub_settings
from skill_hub.security import validate_slug

_FORBIDDEN_SUFFIXES = {
    ".app",
    ".bin",
    ".class",
    ".com",
    ".dll",
    ".dylib",
    ".exe",
    ".jar",
    ".msi",
    ".o",
    ".pyc",
    ".so",
}
_WINDOWS_RESERVED_NAMES = {
    "AUX",
    "CON",
    "NUL",
    "PRN",
    *{f"COM{index}" for index in range(1, 10)},
    *{f"LPT{index}" for index in range(1, 10)},
}
_WINDOWS_INVALID_PATH_CHARACTERS = frozenset('<>:"|?*')
_SECRET_PATTERNS = (
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{20,}\b"),
)
_DANGEROUS_PATTERNS = (
    re.compile(r"\brm\s+-rf\s+[/~]", re.IGNORECASE),
    re.compile(r"\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force", re.IGNORECASE),
    re.compile(r"\bcurl\b[^\n|]*\|\s*(?:sh|bash)\b", re.IGNORECASE),
    re.compile(r"\biwr\b[^\n|]*\|\s*iex\b", re.IGNORECASE),
)


class PackageValidationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ValidatedSkillPackage:
    content: bytes
    sha256: str
    size_bytes: int
    metadata: dict[str, Any]
    manifest: dict[str, Any]
    warnings: tuple[str, ...]


def validate_skill_package(payload: bytes, expected_slug: str) -> ValidatedSkillPackage:
    settings = get_skill_hub_settings()
    if not payload:
        raise PackageValidationError("package is empty")
    if len(payload) > settings.max_package_bytes:
        raise PackageValidationError("package exceeds the compressed size limit")
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as exc:
        raise PackageValidationError("package must be a valid ZIP archive") from exc

    entries = [entry for entry in archive.infolist() if not entry.is_dir()]
    if not entries or len(entries) > settings.max_package_files:
        raise PackageValidationError("package file count is outside the allowed range")
    prefix = _skill_root_prefix(entries)
    normalized_files: list[tuple[str, bytes]] = []
    unpacked_size = 0
    warnings: list[str] = []
    seen: set[str] = set()

    for entry in entries:
        if entry.flag_bits & 0x1:
            raise PackageValidationError("encrypted ZIP entries are not supported")
        if _is_symlink(entry):
            raise PackageValidationError(f"symbolic links are not allowed: {entry.filename}")
        path = _normalize_entry_path(entry.filename, prefix)
        if path in seen:
            raise PackageValidationError(f"duplicate package path: {path}")
        seen.add(path)
        if Path(path).suffix.lower() in _FORBIDDEN_SUFFIXES:
            raise PackageValidationError(f"executable or binary file type is not allowed: {path}")
        if entry.file_size > settings.max_single_file_bytes:
            raise PackageValidationError(f"file exceeds size limit: {path}")
        unpacked_size += entry.file_size
        if unpacked_size > settings.max_unpacked_bytes:
            raise PackageValidationError("package exceeds the unpacked size limit")
        content = archive.read(entry)
        normalized_files.append((path, content))
        _scan_content(path, content, warnings)

    skill_content = dict(normalized_files).get("SKILL.md")
    if skill_content is None:
        raise PackageValidationError("SKILL.md must exist at the package root")
    metadata = _parse_skill_metadata(skill_content)
    metadata_name = validate_slug(str(metadata.get("name", "")), label="SKILL.md name")
    if metadata_name != validate_slug(expected_slug, label="skill slug"):
        raise PackageValidationError("SKILL.md name must match the published skill slug")
    description = str(metadata.get("description", "")).strip()
    if not description or len(description) > 500:
        raise PackageValidationError("SKILL.md description must contain 1-500 characters")
    metadata["name"] = metadata_name
    metadata["description"] = description
    metadata["tags"] = _normalize_tags(metadata.get("tags"))

    normalized_payload = _build_normalized_archive(normalized_files)
    digest = hashlib.sha256(normalized_payload).hexdigest()
    manifest = {
        "format": "agent-skill-v1",
        "sha256": digest,
        "file_count": len(normalized_files),
        "unpacked_bytes": unpacked_size,
        "files": [
            {"path": path, "size": len(content), "sha256": hashlib.sha256(content).hexdigest()}
            for path, content in normalized_files
        ],
    }
    return ValidatedSkillPackage(
        content=normalized_payload,
        sha256=digest,
        size_bytes=len(normalized_payload),
        metadata=metadata,
        manifest=manifest,
        warnings=tuple(dict.fromkeys(warnings)),
    )


def _skill_root_prefix(entries: list[zipfile.ZipInfo]) -> str:
    skill_files = []
    for entry in entries:
        normalized = entry.filename.replace("\\", "/").strip("/")
        if PurePosixPath(normalized).name.lower() == "skill.md":
            skill_files.append(normalized)
    if len(skill_files) != 1:
        raise PackageValidationError("package must contain exactly one SKILL.md")
    skill_path = PurePosixPath(skill_files[0])
    if len(skill_path.parts) == 1:
        return ""
    if len(skill_path.parts) == 2:
        prefix = skill_path.parts[0] + "/"
        for entry in entries:
            candidate = entry.filename.replace("\\", "/").strip("/")
            if not candidate.startswith(prefix):
                raise PackageValidationError("all package files must share the SKILL.md wrapper directory")
        return prefix
    raise PackageValidationError("SKILL.md may only be at the root or inside one wrapper directory")


def _normalize_entry_path(filename: str, prefix: str) -> str:
    raw = filename.replace("\\", "/")
    if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
        raise PackageValidationError(f"unsafe package path: {filename}")
    candidate = raw.strip("/")
    if prefix:
        candidate = candidate[len(prefix):]
    path = PurePosixPath(candidate)
    if not candidate or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise PackageValidationError(f"unsafe package path: {filename}")
    for part in path.parts:
        stem = part.rstrip(" .").split(".", 1)[0].upper()
        if (
            part != part.rstrip(" .")
            or any(character in _WINDOWS_INVALID_PATH_CHARACTERS for character in part)
            or stem in _WINDOWS_RESERVED_NAMES
        ):
            raise PackageValidationError(f"package path is not portable: {filename}")
    normalized = path.as_posix()
    if normalized.lower() == "skill.md":
        return "SKILL.md"
    return normalized


def _is_symlink(entry: zipfile.ZipInfo) -> bool:
    mode = entry.external_attr >> 16
    return stat.S_ISLNK(mode)


def _parse_skill_metadata(content: bytes) -> dict[str, Any]:
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PackageValidationError("SKILL.md must be UTF-8") from exc
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise PackageValidationError("SKILL.md must start with YAML frontmatter")
    try:
        end_index = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as exc:
        raise PackageValidationError("SKILL.md frontmatter is not closed") from exc
    try:
        metadata = yaml.safe_load("\n".join(lines[1:end_index]))
    except yaml.YAMLError as exc:
        raise PackageValidationError("SKILL.md frontmatter is invalid YAML") from exc
    if not isinstance(metadata, dict):
        raise PackageValidationError("SKILL.md frontmatter must be a YAML object")
    return dict(metadata)


def _normalize_tags(value: Any) -> list[str]:
    if value is None:
        return []
    raw_tags = value if isinstance(value, list) else [value]
    tags: list[str] = []
    for raw_tag in raw_tags:
        tag = str(raw_tag).strip().lower()
        if tag and len(tag) <= 32 and tag not in tags:
            tags.append(tag)
    return tags[:12]


def _scan_content(path: str, content: bytes, warnings: list[str]) -> None:
    if len(content) > 512_000:
        return
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return
    for pattern in _SECRET_PATTERNS:
        if pattern.search(text):
            raise PackageValidationError(f"possible credential or private key detected in {path}")
    if any(pattern.search(text) for pattern in _DANGEROUS_PATTERNS):
        warnings.append(f"{path} contains a command pattern that requires careful review")


def _build_normalized_archive(files: list[tuple[str, bytes]]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, content in sorted(files, key=lambda item: item[0]):
            info = zipfile.ZipInfo(path)
            info.date_time = (1980, 1, 1, 0, 0, 0)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return output.getvalue()
