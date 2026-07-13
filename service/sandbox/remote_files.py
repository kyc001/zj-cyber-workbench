from __future__ import annotations

import base64
import io
import mimetypes
import posixpath
import shlex
import stat
import zipfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncssh

from model.host.hosts import ManagedHost
from schema.sandbox.containers import ContainerFileInfo, ContainerFileType, ContainerFileUploadItem
from service.host.connection import connect_managed_host
from service.sandbox.remote_runtime import normalize_remote_path, remote_sftp_root


@asynccontextmanager
async def _sftp_session(host: ManagedHost, container_id: int):
    connection = await connect_managed_host(host)
    try:
        sftp = await connection.start_sftp_client()
        root = await remote_sftp_root(sftp, container_id)
        yield connection, sftp, root
    finally:
        connection.close()
        await connection.wait_closed()


def _path(root: str, raw_path: str) -> str:
    relative = normalize_remote_path(raw_path)
    return posixpath.join(root, relative) if relative else root


def _display(root: str, path: str) -> str:
    relative = posixpath.relpath(path, root)
    return "/" if relative == "." else f"/{relative}"


def _info(root: str, name: str, path: str, attrs) -> ContainerFileInfo:
    permissions = attrs.permissions or 0
    if stat.S_ISLNK(permissions):
        kind = ContainerFileType.SYMLINK
    elif stat.S_ISDIR(permissions):
        kind = ContainerFileType.DIRECTORY
    else:
        kind = ContainerFileType.FILE
    return ContainerFileInfo(
        name=name,
        type=kind,
        size=int(attrs.size or 0) if kind == ContainerFileType.FILE else 0,
        modified_at=int(attrs.mtime or 0),
        owner=str(attrs.uid or ""),
        group=str(attrs.gid or ""),
        permissions=stat.filemode(permissions) if permissions else "",
        path=_display(root, path),
    )


async def list_files(host: ManagedHost, container_id: int, raw_path: str) -> list[ContainerFileInfo]:
    async with _sftp_session(host, container_id) as (_, sftp, root):
        directory = _path(root, raw_path)
        entries = [entry async for entry in sftp.scandir(directory)]
        entries.sort(key=lambda item: item.filename.lower())
        return [
            _info(root, entry.filename, posixpath.join(directory, entry.filename), entry.attrs)
            for entry in entries
        ]


async def file_info(host: ManagedHost, container_id: int, raw_path: str) -> ContainerFileInfo | None:
    async with _sftp_session(host, container_id) as (_, sftp, root):
        path = _path(root, raw_path)
        try:
            attrs = await sftp.lstat(path)
        except asyncssh.SFTPNoSuchFile:
            return None
        return _info(root, posixpath.basename(path) or "/", path, attrs)


async def read_file(host: ManagedHost, container_id: int, raw_path: str, max_bytes: int, base64_mode: bool) -> str:
    async with _sftp_session(host, container_id) as (_, sftp, root):
        async with sftp.open(_path(root, raw_path), "rb") as stream:
            data = await stream.read(max_bytes)
        return base64.b64encode(data).decode("ascii") if base64_mode else data.decode(errors="replace")


async def upload_files(
    host: ManagedHost,
    container_id: int,
    raw_path: str,
    sources,
    overwrite: bool,
) -> list[ContainerFileUploadItem]:
    async with _sftp_session(host, container_id) as (_, sftp, root):
        directory = _path(root, raw_path)
        await sftp.makedirs(directory, exist_ok=True)
        uploaded: list[ContainerFileUploadItem] = []
        try:
            for source in sources:
                name = source.filename.replace("\\", "/").rsplit("/", 1)[-1]
                if not name or name in {".", ".."}:
                    raise ValueError("file name is required")
                target = posixpath.join(directory, name)
                if not overwrite:
                    try:
                        await sftp.lstat(target)
                    except asyncssh.SFTPNoSuchFile:
                        pass
                    else:
                        raise FileExistsError(name)
                data = source.stream.read()
                async with sftp.open(target, "wb") as stream:
                    await stream.write(data)
                uploaded.append(ContainerFileUploadItem(name=name, path=_display(root, target), size=len(data)))
        finally:
            for source in sources:
                source.stream.close()
        return uploaded


async def download_paths(host: ManagedHost, container_id: int, raw_paths: list[str]):
    async with _sftp_session(host, container_id) as (_, sftp, root):
        paths = [_path(root, raw_path) for raw_path in raw_paths]
        payload = io.BytesIO()
        if len(paths) == 1 and stat.S_ISREG((await sftp.stat(paths[0])).permissions or 0):
            async with sftp.open(paths[0], "rb") as stream:
                payload.write(await stream.read())
            filename = posixpath.basename(paths[0])
            media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        else:
            with zipfile.ZipFile(payload, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in paths:
                    await _append_to_zip(sftp, archive, path, posixpath.dirname(path))
            filename = "workspace-download.zip"
            media_type = "application/zip"
    content = payload.getvalue()

    async def chunks() -> AsyncIterator[bytes]:
        for offset in range(0, len(content), 64 * 1024):
            yield content[offset:offset + 64 * 1024]

    return filename, media_type, chunks()


async def _append_to_zip(sftp, archive: zipfile.ZipFile, path: str, base: str) -> None:
    attrs = await sftp.lstat(path)
    if stat.S_ISDIR(attrs.permissions or 0):
        async for entry in sftp.scandir(path):
            await _append_to_zip(sftp, archive, posixpath.join(path, entry.filename), base)
        return
    if stat.S_ISREG(attrs.permissions or 0):
        async with sftp.open(path, "rb") as stream:
            archive.writestr(posixpath.relpath(path, base), await stream.read())


async def write_file(host: ManagedHost, container_id: int, raw_path: str, content: str) -> None:
    async with _sftp_session(host, container_id) as (_, sftp, root):
        target = _path(root, raw_path)
        await sftp.makedirs(posixpath.dirname(target), exist_ok=True)
        async with sftp.open(target, "w", encoding="utf-8") as stream:
            await stream.write(content)


async def copy_files(host: ManagedHost, container_id: int, sources: list[str], destination: str) -> None:
    await _run_file_command(host, container_id, "cp -a", sources, destination)


async def move_files(host: ManagedHost, container_id: int, sources: list[str], destination: str) -> None:
    await _run_file_command(host, container_id, "mv", sources, destination)


async def _run_file_command(
    host: ManagedHost,
    container_id: int,
    operation: str,
    sources: list[str],
    destination: str,
) -> None:
    async with _sftp_session(host, container_id) as (connection, _, root):
        target = _path(root, destination)
        source_paths = [_path(root, source) for source in sources]
        quoted_sources = " ".join(shlex.quote(path) for path in source_paths)
        command = f"mkdir -p -- {shlex.quote(target)} && {operation} -- {quoted_sources} {shlex.quote(target)}/"
        result = await connection.run(command, check=False)
        if result.exit_status != 0:
            raise RuntimeError(result.stderr.strip() or "remote file operation failed")


async def delete_files(host: ManagedHost, container_id: int, raw_paths: list[str]) -> None:
    async with _sftp_session(host, container_id) as (connection, _, root):
        paths = [_path(root, raw_path) for raw_path in raw_paths]
        if any(path == root for path in paths):
            raise PermissionError("workspace root cannot be deleted")
        result = await connection.run(
            "rm -rf -- " + " ".join(shlex.quote(path) for path in paths),
            check=False,
        )
        if result.exit_status != 0:
            raise RuntimeError(result.stderr.strip() or "remote delete failed")


async def make_directory(host: ManagedHost, container_id: int, raw_path: str) -> None:
    async with _sftp_session(host, container_id) as (_, sftp, root):
        await sftp.makedirs(_path(root, raw_path), exist_ok=True)
