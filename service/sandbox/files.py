from __future__ import annotations

import base64
import io
import mimetypes
import os
import shutil
import stat
import zipfile
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import BinaryIO

from schema.sandbox.containers import ContainerFileInfo, ContainerFileType, ContainerFileUploadItem, SandboxContainerStatus
from service.sandbox.local_runtime import display_sandbox_path, resolve_sandbox_path, sandbox_workspace
from service.sandbox import remote_files
from service.sandbox.remote_runtime import is_local_host, resolve_container_host
from service.sandbox.status import resolve_sandbox_container_status


@dataclass(frozen=True)
class ContainerUploadSource:
    filename: str
    stream: BinaryIO


@dataclass(frozen=True)
class ContainerDownloadStream:
    filename: str
    media_type: str
    chunks: AsyncIterator[bytes]


async def close_file_http_client() -> None:
    return None


async def resolve_file_container_status(id: int) -> SandboxContainerStatus | None:
    return await resolve_sandbox_container_status(id)


async def list_container_files(container_id: int, path: str) -> list[ContainerFileInfo]:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        return await remote_files.list_files(remote_host, container_id, path)
    directory = resolve_sandbox_path(container_id, path, must_exist=True)
    if not directory.is_dir():
        raise NotADirectoryError(path)
    return [_file_info(container_id, item) for item in sorted(directory.iterdir(), key=lambda value: value.name.lower())]


async def get_container_file_info(container_id: int, path: str) -> ContainerFileInfo | None:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        return await remote_files.file_info(remote_host, container_id, path)
    try:
        item = resolve_sandbox_path(container_id, path, must_exist=True)
    except FileNotFoundError:
        return None
    return _file_info(container_id, item)


async def read_container_file(container_id: int, path: str, max_bytes: int = 1_048_576, *, base64_mode: bool = False) -> str:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        return await remote_files.read_file(remote_host, container_id, path, max_bytes, base64_mode)
    item = resolve_sandbox_path(container_id, path, must_exist=True)
    if item.is_dir():
        raise IsADirectoryError(path)
    data = item.read_bytes()[:max_bytes]
    return base64.b64encode(data).decode("ascii") if base64_mode else data.decode(errors="replace")


async def upload_container_files(container_id: int, path: str, sources: list[ContainerUploadSource], overwrite: bool) -> list[ContainerFileUploadItem]:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        return await remote_files.upload_files(remote_host, container_id, path, sources, overwrite)
    directory = resolve_sandbox_path(container_id, path)
    directory.mkdir(parents=True, exist_ok=True)
    uploaded: list[ContainerFileUploadItem] = []
    try:
        for source in sources:
            name = PathName(source.filename).safe_name
            target = resolve_sandbox_path(container_id, f"{path.rstrip('/')}/{name}")
            if target.exists() and not overwrite:
                raise FileExistsError(name)
            data = source.stream.read()
            target.write_bytes(data)
            uploaded.append(ContainerFileUploadItem(name=name, path=display_sandbox_path(container_id, target), size=len(data)))
    finally:
        for source in sources:
            source.stream.close()
    return uploaded


async def download_container_paths(container_id: int, paths: list[str]) -> ContainerDownloadStream:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        filename, media_type, chunks = await remote_files.download_paths(remote_host, container_id, paths)
        return ContainerDownloadStream(filename=filename, media_type=media_type, chunks=chunks)
    items = [resolve_sandbox_path(container_id, path, must_exist=True) for path in paths]
    buffer = io.BytesIO()
    if len(items) == 1 and items[0].is_file():
        buffer.write(items[0].read_bytes())
        filename = items[0].name
        media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    else:
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in items:
                if item.is_file():
                    archive.write(item, arcname=item.name)
                elif item.is_dir():
                    for child in item.rglob("*"):
                        if child.is_file():
                            archive.write(child, arcname=str(child.relative_to(item.parent)))
        filename = "workspace-download.zip"
        media_type = "application/zip"
    payload = buffer.getvalue()

    async def chunks() -> AsyncIterator[bytes]:
        for offset in range(0, len(payload), 64 * 1024):
            yield payload[offset:offset + 64 * 1024]

    return ContainerDownloadStream(filename=filename, media_type=media_type, chunks=chunks())


async def write_container_file(container_id: int, path: str, content: str) -> bool:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        await remote_files.write_file(remote_host, container_id, path, content)
        return True
    target = resolve_sandbox_path(container_id, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return True


async def copy_container_files(container_id: int, sources: list[str], destination: str) -> bool:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        await remote_files.copy_files(remote_host, container_id, sources, destination)
        return True
    target_dir = resolve_sandbox_path(container_id, destination)
    target_dir.mkdir(parents=True, exist_ok=True)
    for source in sources:
        item = resolve_sandbox_path(container_id, source, must_exist=True)
        shutil.copytree(item, target_dir / item.name, dirs_exist_ok=True) if item.is_dir() else shutil.copy2(item, target_dir / item.name)
    return True


async def move_container_files(container_id: int, sources: list[str], destination: str) -> bool:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        await remote_files.move_files(remote_host, container_id, sources, destination)
        return True
    target_dir = resolve_sandbox_path(container_id, destination)
    target_dir.mkdir(parents=True, exist_ok=True)
    for source in sources:
        item = resolve_sandbox_path(container_id, source, must_exist=True)
        shutil.move(str(item), str(target_dir / item.name))
    return True


async def delete_container_files(container_id: int, paths: list[str]) -> bool:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        await remote_files.delete_files(remote_host, container_id, paths)
        return True
    for path in paths:
        item = resolve_sandbox_path(container_id, path, must_exist=True)
        if item == sandbox_workspace(container_id):
            raise PermissionError("workspace root cannot be deleted")
        shutil.rmtree(item) if item.is_dir() and not item.is_symlink() else item.unlink()
    return True


async def create_container_directory(container_id: int, path: str) -> bool:
    remote_host = await _remote_host(container_id)
    if remote_host is not None:
        await remote_files.make_directory(remote_host, container_id, path)
        return True
    resolve_sandbox_path(container_id, path).mkdir(parents=True, exist_ok=True)
    return True


def _file_info(container_id: int, item) -> ContainerFileInfo:
    metadata = item.stat()
    if item.is_symlink():
        kind = ContainerFileType.SYMLINK
    elif item.is_dir():
        kind = ContainerFileType.DIRECTORY
    else:
        kind = ContainerFileType.FILE
    return ContainerFileInfo(
        name=item.name, type=kind, size=metadata.st_size if item.is_file() else 0,
        modified_at=int(metadata.st_mtime), owner=str(getattr(metadata, "st_uid", "")),
        group=str(getattr(metadata, "st_gid", "")), permissions=stat.filemode(metadata.st_mode),
        path=display_sandbox_path(container_id, item),
    )


class PathName:
    def __init__(self, value: str) -> None:
        self.safe_name = os.path.basename((value or "").replace("\\", "/"))
        if not self.safe_name or self.safe_name in {".", ".."}:
            raise ValueError("file name is required")


async def _remote_host(container_id: int):
    _, host = await resolve_container_host(container_id)
    return None if is_local_host(host) else host
