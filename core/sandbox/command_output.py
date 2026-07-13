from __future__ import annotations

import re
from pathlib import Path, PurePosixPath
from uuid import uuid4

from config import WORKSPACE
from schema.sandbox.async_jobs import SandboxAsyncJobSnapshot, SandboxAsyncJobStatus
from schema.sandbox.command_outputs import SandboxCommandOutputChunk, SandboxCommandResultMetadata


OUTPUT_CHUNK_LINE_COUNT = 200
OUTPUT_DIR = "/tmp/shell-command-output"
COMMAND_TIMEOUT_ERROR = "Command execution timed out."
_OUTPUT_FILE_RE = re.compile(r"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.log$", re.IGNORECASE)


def new_run_id() -> str:
    return uuid4().hex


def output_path_for_run(run_id: str) -> str:
    return f"{OUTPUT_DIR}/{run_id}.log"


def new_output_path() -> str:
    return output_path_for_run(new_run_id())


def local_output_path(output_file: str) -> Path:
    filename = PurePosixPath(validate_output_path(output_file)).name
    directory = WORKSPACE / "command-output"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / filename


def result_metadata(*, status: SandboxAsyncJobStatus, output_file: str | None = None, output_bytes: int = 0, output_lines: int = 0, exit_code: int | None = None, run_id: str | None = None, error: str | None = None) -> SandboxCommandResultMetadata:
    return SandboxCommandResultMetadata(status=status, exit_code=exit_code, output_file=validate_output_path(output_file) if output_file else None, output_bytes=max(output_bytes, 0), output_lines=max(output_lines, 0), run_id=run_id, error=error or None)


def result_metadata_from_snapshot(snapshot: SandboxAsyncJobSnapshot) -> SandboxCommandResultMetadata:
    return result_metadata(status=snapshot.status, output_file=snapshot.output_file or None, output_bytes=snapshot.output_bytes, output_lines=snapshot.output_lines, exit_code=snapshot.exit_code, run_id=snapshot.run_id, error=snapshot.error)


def validate_output_path(output_file: str) -> str:
    stripped = output_file.strip()
    normalized = str(PurePosixPath(stripped))
    parts = PurePosixPath(normalized).parts
    filename = parts[-1] if parts else ""
    if not normalized.startswith(f"{OUTPUT_DIR}/") or normalized != stripped or parts != ("/", "tmp", "shell-command-output", filename) or not _OUTPUT_FILE_RE.fullmatch(filename):
        raise ValueError("output_file must be a command result path returned by sandbox command tools")
    return normalized


def normalize_read_range(start_line: int, line_count: int) -> tuple[int, int, int]:
    start = max(1, int(start_line))
    count = min(max(1, int(line_count)), OUTPUT_CHUNK_LINE_COUNT)
    return start, count, start + count - 1


def output_chunk(*, output_file: str, start_line: int, line_count: int, content: str) -> SandboxCommandOutputChunk:
    start, _, end = normalize_read_range(start_line, line_count)
    return SandboxCommandOutputChunk(output_file=validate_output_path(output_file), start_line=start, end_line=end, content=content)
