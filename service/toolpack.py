from __future__ import annotations

import asyncio
import base64
import json
import os
import shlex
import shutil
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import asyncssh

from config import WORKSPACE
from logger import get_logger
from middleware.auth import AuthUser
from schema.action import RiskLevel
from schema.sandbox.containers import SandboxContainerStatus
from schema.system_user.users import SystemUserRole
from schema.toolpack import (
    ExecutionArtifact,
    ExecutionErrorCode,
    ExecutionResult,
    QueryToolpackToolsResponse,
    ToolBackend,
    ToolManifestSchema,
    ToolRunCancelResponse,
    ToolRunRequest,
    ToolRunSnapshot,
    ToolRunStatus,
    ToolSchema,
)
from service.host.hosts import DEFAULT_LOCAL_HOST_ID
from service.sandbox.commands import (
    SandboxContainerCommandResult,
    SandboxContainerCommandTimeoutError,
    cancel_running_process,
    execute_sandbox_container_command,
)
from service.sandbox.local_runtime import portable_tool_environment
from service.sandbox.records import sandbox_container_is_manageable_by_user
from service.sandbox.remote_runtime import resolve_container_host

logger = get_logger(__name__)

_MAX_STRUCTURED_STDOUT = 256 * 1024
_ARTIFACT_ROOT = WORKSPACE / "toolpack" / "artifacts"


@dataclass(frozen=True)
class _ToolDefinition:
    manifest: ToolManifestSchema
    install_hint: str
    build_args: Callable[[dict[str, Any]], list[str]]
    stdin_text: Callable[[dict[str, Any]], str] | None = None


@dataclass
class _RunningToolRun:
    snapshot: ToolRunSnapshot
    task: asyncio.Task[None]


_runs: dict[str, _RunningToolRun] = {}
_runs_lock = asyncio.Lock()


def _target_input_schema(required: str = "target") -> dict[str, Any]:
    return {
        "type": "object",
        "required": [required],
        "properties": {
            required: {"type": "string", "minLength": 1, "maxLength": 2048},
            "rps": {"type": "integer", "minimum": 1, "maximum": 50},
            "concurrency": {"type": "integer", "minimum": 1, "maximum": 20},
        },
        "additionalProperties": False,
    }


def _base_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "tool_id": {"type": "string"},
            "stdout": {"type": "string"},
            "records": {"type": "array"},
        },
        "required": ["tool_id", "stdout", "records"],
    }


_WEB_CHECK_SCRIPT = r"""
import json
import sys
import time
import urllib.error
import urllib.request

url, method, timeout_text = sys.argv[1], sys.argv[2], sys.argv[3]
timeout = max(1.0, min(float(timeout_text), 30.0))
started = time.perf_counter()
request = urllib.request.Request(url, method=method, headers={"User-Agent": "ZJ-Toolpack/1.0"})
try:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = b"" if method == "HEAD" else response.read(4096)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        headers = {key.lower(): value for key, value in response.headers.items()}
        print(json.dumps({
            "url": url,
            "method": method,
            "ok": True,
            "status_code": response.status,
            "reason": response.reason,
            "elapsed_ms": elapsed_ms,
            "content_type": headers.get("content-type", ""),
            "content_length": headers.get("content-length", ""),
            "server": headers.get("server", ""),
            "location": headers.get("location", ""),
            "body_preview_bytes": len(body),
        }, ensure_ascii=False))
except urllib.error.HTTPError as exc:
    body = b"" if method == "HEAD" else exc.read(4096)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    headers = {key.lower(): value for key, value in exc.headers.items()}
    print(json.dumps({
        "url": url,
        "method": method,
        "ok": False,
        "status_code": exc.code,
        "reason": exc.reason,
        "elapsed_ms": elapsed_ms,
        "content_type": headers.get("content-type", ""),
        "content_length": headers.get("content-length", ""),
        "server": headers.get("server", ""),
        "location": headers.get("location", ""),
        "body_preview_bytes": len(body),
    }, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"url": url, "method": method, "ok": False, "error": str(exc)}, ensure_ascii=False))
    raise SystemExit(1)
""".strip()


_TLS_INSPECT_SCRIPT = r"""
import json
import socket
import ssl
import sys

host, port_text, server_name, timeout_text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
port = int(port_text)
timeout = max(1.0, min(float(timeout_text), 30.0))
context = ssl.create_default_context()
try:
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with context.wrap_socket(sock, server_hostname=server_name or host) as tls:
            cert = tls.getpeercert() or {}
            sans = [value for kind, value in cert.get("subjectAltName", []) if kind.lower() == "dns"]
            print(json.dumps({
                "host": host,
                "port": port,
                "server_name": server_name or host,
                "ok": True,
                "tls_version": tls.version(),
                "cipher": tls.cipher()[0] if tls.cipher() else "",
                "issuer": cert.get("issuer", []),
                "subject": cert.get("subject", []),
                "not_before": cert.get("notBefore", ""),
                "not_after": cert.get("notAfter", ""),
                "dns_names": sans,
            }, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({
        "host": host,
        "port": port,
        "server_name": server_name or host,
        "ok": False,
        "error": str(exc),
    }, ensure_ascii=False))
    raise SystemExit(1)
""".strip()


_PORT_SCAN_SCRIPT = r"""
import json
import socket
import sys
import time

host, ports_text, timeout_text = sys.argv[1], sys.argv[2], sys.argv[3]
timeout = max(0.1, min(float(timeout_text), 5.0))
records = []
for item in ports_text.split(","):
    port = int(item)
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            records.append({"port": port, "open": True, "elapsed_ms": int((time.perf_counter() - started) * 1000)})
    except Exception as exc:
        records.append({
            "port": port,
            "open": False,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "error": type(exc).__name__,
        })
print(json.dumps({"host": host, "ports": records}, ensure_ascii=False))
""".strip()


_DNS_LOOKUP_SCRIPT = r"""
import json
import socket
import sys

host, timeout_text = sys.argv[1], sys.argv[2]
socket.setdefaulttimeout(max(1.0, min(float(timeout_text), 10.0)))
try:
    infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    records = []
    seen = set()
    for family, _, _, canonname, sockaddr in infos:
        address = sockaddr[0]
        key = (family, address)
        if key in seen:
            continue
        seen.add(key)
        records.append({
            "family": "A" if family == socket.AF_INET else "AAAA" if family == socket.AF_INET6 else str(family),
            "address": address,
            "canonname": canonname,
        })
    print(json.dumps({"host": host, "ok": bool(records), "records": records}, ensure_ascii=False))
    raise SystemExit(0 if records else 1)
except Exception as exc:
    print(json.dumps({"host": host, "ok": False, "error": str(exc)}, ensure_ascii=False))
    raise SystemExit(1)
""".strip()


_PING_SCRIPT = r"""
import json
import platform
import subprocess
import sys

host, count_text, timeout_text = sys.argv[1], sys.argv[2], sys.argv[3]
count = max(1, min(int(count_text), 10))
timeout = max(1, min(int(timeout_text), 10))
if platform.system().lower().startswith("win"):
    command = ["ping", "-n", str(count), "-w", str(timeout * 1000), host]
else:
    command = ["ping", "-c", str(count), "-W", str(timeout), host]
completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
print(json.dumps({
    "host": host,
    "count": count,
    "timeout_seconds": timeout,
    "ok": completed.returncode == 0,
    "exit_code": completed.returncode,
    "stdout": completed.stdout[-4096:],
    "stderr": completed.stderr[-1024:],
}, ensure_ascii=False))
raise SystemExit(completed.returncode)
""".strip()


_HTTP_HEADERS_SCRIPT = r"""
import json
import sys
import time
import urllib.error
import urllib.request

url, timeout_text = sys.argv[1], sys.argv[2]
timeout = max(1.0, min(float(timeout_text), 30.0))
started = time.perf_counter()
request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "ZJ-Toolpack/1.0"})
try:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        headers = {
            key.lower(): value
            for key, value in response.headers.items()
            if key.lower() not in {"set-cookie", "authorization"}
        }
        print(json.dumps({
            "url": url,
            "ok": True,
            "status_code": response.status,
            "reason": response.reason,
            "elapsed_ms": elapsed_ms,
            "headers": headers,
        }, ensure_ascii=False))
except urllib.error.HTTPError as exc:
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    headers = {
        key.lower(): value
        for key, value in exc.headers.items()
        if key.lower() not in {"set-cookie", "authorization"}
    }
    print(json.dumps({
        "url": url,
        "ok": False,
        "status_code": exc.code,
        "reason": exc.reason,
        "elapsed_ms": elapsed_ms,
        "headers": headers,
    }, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"url": url, "ok": False, "error": str(exc)}, ensure_ascii=False))
    raise SystemExit(1)
""".strip()


_SYSTEM_INFO_SCRIPT = r"""
import json
import os
import platform
import shutil
import socket


def memory_info():
    if os.name == "posix" and os.path.exists("/proc/meminfo"):
        data = {}
        with open("/proc/meminfo", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                key, _, value = line.partition(":")
                if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
                    data[key] = value.strip()
        return data
    return {}


usage = shutil.disk_usage(os.getcwd())
print(json.dumps({
    "hostname": socket.gethostname(),
    "user": os.environ.get("USERNAME") or os.environ.get("USER") or "",
    "platform": platform.platform(),
    "system": platform.system(),
    "release": platform.release(),
    "machine": platform.machine(),
    "python": platform.python_version(),
    "cpu_count": os.cpu_count(),
    "cwd": os.getcwd(),
    "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
    "memory": memory_info(),
}, ensure_ascii=False))
""".strip()


_DISK_USAGE_SCRIPT = r"""
import json
import os
import shutil
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
max_depth = max(0, min(int(sys.argv[2]), 4))
top_n = max(1, min(int(sys.argv[3]), 50))
root = path.resolve()
usage = shutil.disk_usage(root if root.is_dir() else root.parent)
entries = []


def size_of(entry):
    if entry.is_file() or entry.is_symlink():
        try:
            return entry.stat().st_size
        except OSError:
            return 0
    total = 0
    base_depth = len(entry.parts)
    for current, dirs, files in os.walk(entry, onerror=lambda _: None):
        depth = len(Path(current).parts) - base_depth
        if depth >= max_depth:
            dirs[:] = []
        for name in files:
            try:
                total += (Path(current) / name).stat().st_size
            except OSError:
                pass
    return total


if root.is_dir():
    for child in root.iterdir():
        entries.append({"path": str(child), "type": "dir" if child.is_dir() else "file", "size": size_of(child)})
else:
    entries.append({"path": str(root), "type": "file", "size": size_of(root)})
entries.sort(key=lambda item: item["size"], reverse=True)
print(json.dumps({
    "path": str(root),
    "disk": {"total": usage.total, "used": usage.used, "free": usage.free},
    "entries": entries[:top_n],
}, ensure_ascii=False))
""".strip()


_PROCESS_LIST_SCRIPT = r"""
import csv
import io
import json
import os
import platform
import subprocess
import sys

keyword = "" if len(sys.argv) < 2 or sys.argv[1] == "__all__" else sys.argv[1].lower()
limit = max(1, min(int(sys.argv[2] if len(sys.argv) > 2 else "50"), 200))
records = []
if platform.system().lower().startswith("win"):
    completed = subprocess.run(["tasklist", "/fo", "csv", "/nh"], capture_output=True, text=True, errors="replace")
    for row in csv.reader(io.StringIO(completed.stdout)):
        if len(row) < 5:
            continue
        record = {"image": row[0], "pid": row[1], "session": row[2], "memory": row[4]}
        if not keyword or keyword in json.dumps(record, ensure_ascii=False).lower():
            records.append(record)
else:
    command = ["ps", "-eo", "pid,ppid,user,comm,%cpu,%mem", "--no-headers"]
    completed = subprocess.run(command, capture_output=True, text=True, errors="replace")
    for line in completed.stdout.splitlines():
        parts = line.split(None, 5)
        if len(parts) < 6:
            continue
        record = {
            "pid": parts[0],
            "ppid": parts[1],
            "user": parts[2],
            "command": parts[3],
            "cpu": parts[4],
            "mem": parts[5],
        }
        if not keyword or keyword in line.lower():
            records.append(record)
print(json.dumps({"keyword": keyword, "count": len(records[:limit]), "records": records[:limit]}, ensure_ascii=False))
""".strip()


_NET_CONNECTIONS_SCRIPT = r"""
import json
import platform
import shutil
import subprocess
import sys

state_filter = "" if len(sys.argv) < 2 or sys.argv[1].lower() in {"", "all", "__all__"} else sys.argv[1].lower()
limit = max(1, min(int(sys.argv[2] if len(sys.argv) > 2 else "100"), 300))
records = []
if platform.system().lower().startswith("win"):
    command = ["netstat", "-ano"]
elif shutil.which("ss"):
    command = ["ss", "-tunlp"]
else:
    command = ["netstat", "-tunlp"]
completed = subprocess.run(command, capture_output=True, text=True, errors="replace")
for line in completed.stdout.splitlines():
    lowered = line.lower()
    if state_filter and state_filter not in lowered:
        continue
    if any(token in lowered for token in ("tcp", "udp")):
        records.append({"line": line})
print(json.dumps({
    "command": " ".join(command),
    "state_filter": state_filter,
    "count": len(records[:limit]),
    "records": records[:limit],
}, ensure_ascii=False))
""".strip()


_ENV_CHECK_SCRIPT = r"""
import json
import os
import shutil
import sys

tools = [item.strip() for item in sys.argv[1].split(",") if item.strip()]
records = [
    {"tool": tool, "path": shutil.which(tool) or "", "available": shutil.which(tool) is not None}
    for tool in tools
]
print(json.dumps({
    "path_entries": os.environ.get("PATH", "").split(os.pathsep),
    "records": records,
}, ensure_ascii=False))
""".strip()


_CURL_SCRIPT = r"""
import json
import sys
import time
import urllib.error
import urllib.request

url, method, timeout_text = sys.argv[1], sys.argv[2], sys.argv[3]
body = sys.argv[4] if len(sys.argv) > 4 else ""
timeout = max(1.0, min(float(timeout_text), 30.0))
method = method.upper()
data = body.encode("utf-8") if method in {"POST", "PUT", "PATCH"} and body else None
started = time.perf_counter()
request = urllib.request.Request(url, method=method, data=data, headers={"User-Agent": "ZJ-Toolpack/1.0"})
try:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content = b"" if method == "HEAD" else response.read(8192)
        headers = {
            k.lower(): v
            for k, v in response.headers.items()
            if k.lower() not in {"set-cookie", "authorization"}
        }
        print(json.dumps({
            "url": url,
            "method": method,
            "ok": True,
            "status_code": response.status,
            "reason": response.reason,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "headers": headers,
            "body_preview": content.decode("utf-8", errors="replace"),
        }, ensure_ascii=False))
except urllib.error.HTTPError as exc:
    content = b"" if method == "HEAD" else exc.read(8192)
    headers = {k.lower(): v for k, v in exc.headers.items() if k.lower() not in {"set-cookie", "authorization"}}
    print(json.dumps({
        "url": url,
        "method": method,
        "ok": False,
        "status_code": exc.code,
        "reason": exc.reason,
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
        "headers": headers,
        "body_preview": content.decode("utf-8", errors="replace"),
    }, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"url": url, "method": method, "ok": False, "error": str(exc)}, ensure_ascii=False))
    raise SystemExit(1)
""".strip()


_HTTP_PROBE_SCRIPT = r"""
import json
import sys
import time
import urllib.error
import urllib.request

targets = [item.strip() for item in sys.argv[1].replace("\n", ",").split(",") if item.strip()]
method, timeout_text = sys.argv[2], sys.argv[3]
timeout = max(1.0, min(float(timeout_text), 30.0))
records = []
for url in targets[:20]:
    started = time.perf_counter()
    request = urllib.request.Request(url, method=method, headers={"User-Agent": "ZJ-Toolpack/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = b"" if method == "HEAD" else response.read(4096)
            records.append({
                "url": url,
                "ok": True,
                "status_code": response.status,
                "elapsed_ms": int((time.perf_counter() - started) * 1000),
                "server": response.headers.get("server", ""),
                "content_type": response.headers.get("content-type", ""),
                "body_preview_bytes": len(body),
            })
    except urllib.error.HTTPError as exc:
        records.append({
            "url": url,
            "ok": False,
            "status_code": exc.code,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "server": exc.headers.get("server", ""),
            "content_type": exc.headers.get("content-type", ""),
        })
    except Exception as exc:
        records.append({"url": url, "ok": False, "error": str(exc)})
print(json.dumps({"count": len(records), "records": records}, ensure_ascii=False))
""".strip()


_DNS_TRACE_SCRIPT = r"""
import json
import shutil
import socket
import subprocess
import sys

host, record_type, timeout_text = sys.argv[1], sys.argv[2].upper(), sys.argv[3]
socket.setdefaulttimeout(max(1.0, min(float(timeout_text), 10.0)))
records = []
try:
    if record_type in {"A", "AAAA", "ANY"}:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        seen = set()
        for family, _, _, canonname, sockaddr in infos:
            rrtype = "A" if family == socket.AF_INET else "AAAA" if family == socket.AF_INET6 else str(family)
            if record_type != "ANY" and rrtype != record_type:
                continue
            key = (rrtype, sockaddr[0])
            if key not in seen:
                seen.add(key)
                records.append({"type": rrtype, "value": sockaddr[0], "canonname": canonname})
except Exception as exc:
    records.append({"type": record_type, "error": str(exc)})
raw_output = ""
if shutil.which("nslookup"):
    completed = subprocess.run(
        ["nslookup", "-type=" + record_type, host],
        capture_output=True,
        text=True,
        errors="replace",
        timeout=10,
    )
    raw_output = completed.stdout[-8192:] + completed.stderr[-2048:]
print(json.dumps({
    "host": host,
    "record_type": record_type,
    "records": records,
    "raw_output": raw_output,
}, ensure_ascii=False))
""".strip()


_PORT_QUICKCHECK_SCRIPT = r"""
import json
import socket
import sys
import time

host, profile, timeout_text = sys.argv[1], sys.argv[2], sys.argv[3]
profiles = {
    "common": [22, 80, 443, 3389, 5432, 3306, 6379, 8000, 8080, 8443],
    "web": [80, 443, 8000, 8080, 8443],
    "db": [1433, 1521, 3306, 5432, 6379, 9200],
}
ports = profiles.get(profile, profiles["common"])
timeout = max(0.1, min(float(timeout_text), 5.0))
records = []
for port in ports:
    started = time.perf_counter()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            records.append({"port": port, "open": True, "elapsed_ms": int((time.perf_counter() - started) * 1000)})
    except Exception as exc:
        records.append({"port": port, "open": False, "error": type(exc).__name__})
print(json.dumps({"host": host, "profile": profile, "records": records}, ensure_ascii=False))
""".strip()


_LOG_TAIL_SCRIPT = r"""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
lines = max(1, min(int(sys.argv[2]), 500))
content = path.read_text(encoding="utf-8", errors="replace").splitlines()
selected = content[-lines:]
print(json.dumps({
    "path": str(path.resolve()),
    "lines": len(selected),
    "content": "\n".join(selected),
}, ensure_ascii=False))
""".strip()


_LOG_GREP_SCRIPT = r"""
import json
import re
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
pattern, ignore_case_text, max_matches_text = sys.argv[2], sys.argv[3], sys.argv[4]
flags = re.IGNORECASE if ignore_case_text == "true" else 0
regex = re.compile(pattern, flags)
max_matches = max(1, min(int(max_matches_text), 200))
matches = []
with path.open(encoding="utf-8", errors="replace") as handle:
    for number, line in enumerate(handle, 1):
        if regex.search(line):
            matches.append({"line_number": number, "line": line.rstrip("\n")})
            if len(matches) >= max_matches:
                break
print(json.dumps({"path": str(path.resolve()), "pattern": pattern, "matches": matches}, ensure_ascii=False))
""".strip()


_FILE_HASH_SCRIPT = r"""
import hashlib
import json
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
algorithm = sys.argv[2].lower()
if algorithm not in {"sha256", "sha1", "md5"}:
    raise SystemExit("unsupported hash algorithm")
hasher = hashlib.new(algorithm)
size = 0
with path.open("rb") as handle:
    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
        size += len(chunk)
        hasher.update(chunk)
print(json.dumps({
    "path": str(path.resolve()),
    "algorithm": algorithm,
    "size": size,
    "digest": hasher.hexdigest(),
}, ensure_ascii=False))
""".strip()


_ARCHIVE_INSPECT_SCRIPT = r"""
import json
import sys
import tarfile
import zipfile
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
max_entries = max(1, min(int(sys.argv[2]), 500))
entries = []
archive_type = ""
if zipfile.is_zipfile(path):
    archive_type = "zip"
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist()[:max_entries]:
            entries.append({"name": item.filename, "size": item.file_size, "compressed_size": item.compress_size})
elif tarfile.is_tarfile(path):
    archive_type = "tar"
    with tarfile.open(path) as archive:
        for item in archive.getmembers()[:max_entries]:
            item_type = item.type.decode(errors="replace") if isinstance(item.type, bytes) else str(item.type)
            entries.append({"name": item.name, "size": item.size, "type": item_type})
else:
    raise SystemExit("unsupported archive format")
print(json.dumps({"path": str(path.resolve()), "archive_type": archive_type, "entries": entries}, ensure_ascii=False))
""".strip()


def _builtin_python_tool(
    *,
    tool_id: str,
    name: str,
    description: str,
    backend: ToolBackend,
    category: str,
    action_type: str,
    input_schema: dict[str, Any],
    script: str,
    script_args: Callable[[dict[str, Any]], list[str]],
    default_timeout_seconds: int = 30,
    max_timeout_seconds: int = 60,
    risk_level: RiskLevel = RiskLevel.L1,
) -> _ToolDefinition:
    executable = "python" if backend == ToolBackend.LOCAL else "python3"
    encoded_script = base64.b64encode(script.encode("utf-8")).decode("ascii")
    bootstrap = (
        "import base64,sys; "
        "code=sys.argv[1]; "
        "sys.argv=[sys.argv[0]]+sys.argv[2:]; "
        "exec(base64.b64decode(code).decode())"
    )
    return _ToolDefinition(
        manifest=ToolManifestSchema(
            id=tool_id,
            name=name,
            description=description,
            backend=backend,
            executable=executable,
            category=category,
            action_type=action_type,
            risk_level=risk_level,
            default_timeout_seconds=default_timeout_seconds,
            max_timeout_seconds=max_timeout_seconds,
            input_schema=input_schema,
            output_schema=_base_output_schema(),
            policy={"requires_scope": True},
        ),
        install_hint=f"{executable} runtime is required for built-in operations tools.",
        build_args=lambda payload: [executable, "-c", bootstrap, encoded_script, *script_args(payload)],
    )


def _paired_python_tools(
    *,
    suffix: str,
    name: str,
    description: str,
    category: str,
    action_type: str,
    input_schema: dict[str, Any],
    script: str,
    script_args: Callable[[dict[str, Any]], list[str]],
    default_timeout_seconds: int = 30,
    max_timeout_seconds: int = 60,
    risk_level: RiskLevel = RiskLevel.L1,
) -> dict[str, _ToolDefinition]:
    return {
        f"local.{suffix}": _builtin_python_tool(
            tool_id=f"local.{suffix}",
            name=name,
            description=description.replace("workspace", "local workspace"),
            backend=ToolBackend.LOCAL,
            category=category,
            action_type=action_type,
            input_schema=input_schema,
            script=script,
            script_args=script_args,
            default_timeout_seconds=default_timeout_seconds,
            max_timeout_seconds=max_timeout_seconds,
            risk_level=risk_level,
        ),
        f"ssh.{suffix}": _builtin_python_tool(
            tool_id=f"ssh.{suffix}",
            name=name,
            description=description.replace("workspace", "SSH workspace"),
            backend=ToolBackend.SSH,
            category=category,
            action_type=action_type,
            input_schema=input_schema,
            script=script,
            script_args=script_args,
            default_timeout_seconds=default_timeout_seconds,
            max_timeout_seconds=max_timeout_seconds,
            risk_level=risk_level,
        ),
    }


def _operations_tool_definitions() -> dict[str, _ToolDefinition]:
    tools: dict[str, _ToolDefinition] = {}
    simple_empty_schema = {"type": "object", "properties": {}, "additionalProperties": False}
    tools.update(_paired_python_tools(
        suffix="system.info",
        name="system.info",
        description="Collect read-only host and runtime facts from the workspace.",
        category="ops-system",
        action_type="ops.system.info",
        input_schema=simple_empty_schema,
        script=_SYSTEM_INFO_SCRIPT,
        script_args=lambda payload: [],
    ))
    tools.update(_paired_python_tools(
        suffix="disk.usage",
        name="disk.usage",
        description="Summarize disk usage for a bounded path from the workspace.",
        category="ops-system",
        action_type="ops.disk.usage",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string", "minLength": 1, "maxLength": 4096},
                "max_depth": {"type": "integer", "minimum": 0, "maximum": 4},
                "top_n": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "additionalProperties": False,
        },
        script=_DISK_USAGE_SCRIPT,
        script_args=lambda payload: [
            _optional_text(payload, "path", "."),
            str(_optional_int(payload, "max_depth", 1, minimum=0, maximum=4)),
            str(_optional_int(payload, "top_n", 20, minimum=1, maximum=50)),
        ],
        default_timeout_seconds=60,
        max_timeout_seconds=120,
    ))
    tools.update(_paired_python_tools(
        suffix="process.list",
        name="process.list",
        description="List running processes with an optional keyword filter.",
        category="ops-system",
        action_type="ops.process.list",
        input_schema={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "maxLength": 128},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
            "additionalProperties": False,
        },
        script=_PROCESS_LIST_SCRIPT,
        script_args=lambda payload: [
            _optional_text(payload, "keyword", "__all__") or "__all__",
            str(_optional_int(payload, "limit", 50, minimum=1, maximum=200)),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="net.connections",
        name="net.connections",
        description="List TCP/UDP connection rows from the workspace.",
        category="ops-network",
        action_type="ops.net.connections",
        input_schema={
            "type": "object",
            "properties": {
                "state": {"type": "string", "maxLength": 64},
                "limit": {"type": "integer", "minimum": 1, "maximum": 300},
            },
            "additionalProperties": False,
        },
        script=_NET_CONNECTIONS_SCRIPT,
        script_args=lambda payload: [
            _optional_text(payload, "state", "__all__") or "__all__",
            str(_optional_int(payload, "limit", 100, minimum=1, maximum=300)),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="env.check",
        name="env.check",
        description="Check PATH and common operations/security tools in the workspace.",
        category="ops-system",
        action_type="ops.env.check",
        input_schema={
            "type": "object",
            "properties": {
                "tools": {"type": "string", "minLength": 1, "maxLength": 512},
            },
            "additionalProperties": False,
        },
        script=_ENV_CHECK_SCRIPT,
        script_args=lambda payload: [
            _optional_text(payload, "tools", "python,python3,node,pnpm,git,curl,nmap,sqlmap,httpx,dnsx,ffuf"),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="curl",
        name="curl",
        description="Run a bounded HTTP request from the workspace.",
        category="ops-http",
        action_type="web.http.request",
        input_schema={
            "type": "object",
            "required": ["url"],
            "properties": {
                "url": {"type": "string", "minLength": 1, "maxLength": 2048},
                "method": {"type": "string", "enum": ["GET", "HEAD", "POST", "PUT", "PATCH"]},
                "body": {"type": "string", "maxLength": 8192},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            "additionalProperties": False,
        },
        script=_CURL_SCRIPT,
        script_args=lambda payload: [
            _required_url(payload, "url"),
            _optional_enum(payload, "method", {"GET", "HEAD", "POST", "PUT", "PATCH"}, "GET"),
            str(_optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)),
            _optional_text(payload, "body", ""),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="http.probe",
        name="http.probe",
        description="Probe up to 20 HTTP URLs from the workspace.",
        category="ops-http",
        action_type="web.http.probe",
        input_schema={
            "type": "object",
            "required": ["urls"],
            "properties": {
                "urls": {"type": "string", "minLength": 1, "maxLength": 8192},
                "method": {"type": "string", "enum": ["GET", "HEAD"]},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30},
            },
            "additionalProperties": False,
        },
        script=_HTTP_PROBE_SCRIPT,
        script_args=lambda payload: [
            _required_urls_text(payload, "urls", max_items=20),
            _optional_enum(payload, "method", {"GET", "HEAD"}, "HEAD"),
            str(_optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)),
        ],
        default_timeout_seconds=60,
        max_timeout_seconds=120,
    ))
    tools.update(_paired_python_tools(
        suffix="dns.trace",
        name="dns.trace",
        description="Resolve DNS records and include nslookup output when available.",
        category="ops-dns",
        action_type="network.dns.trace",
        input_schema={
            "type": "object",
            "required": ["host"],
            "properties": {
                "host": {"type": "string", "minLength": 1, "maxLength": 255},
                "record_type": {"type": "string", "enum": ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "ANY"]},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 10},
            },
            "additionalProperties": False,
        },
        script=_DNS_TRACE_SCRIPT,
        script_args=lambda payload: [
            _required_host(payload, "host"),
            _optional_enum(payload, "record_type", {"A", "AAAA", "MX", "TXT", "NS", "CNAME", "ANY"}, "A"),
            str(_optional_int(payload, "timeout_seconds", 5, minimum=1, maximum=10)),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="port.quickcheck",
        name="port.quickcheck",
        description="Check a predefined common/web/database port profile.",
        category="ops-network",
        action_type="network.port.quickcheck",
        input_schema={
            "type": "object",
            "required": ["host"],
            "properties": {
                "host": {"type": "string", "minLength": 1, "maxLength": 255},
                "profile": {"type": "string", "enum": ["common", "web", "db"]},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 5},
            },
            "additionalProperties": False,
        },
        script=_PORT_QUICKCHECK_SCRIPT,
        script_args=lambda payload: [
            _required_host(payload, "host"),
            _optional_enum(payload, "profile", {"common", "web", "db"}, "common").lower(),
            str(_optional_int(payload, "timeout_seconds", 1, minimum=1, maximum=5)),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="log.tail",
        name="log.tail",
        description="Read the last N lines of a text log file from the workspace.",
        category="ops-file",
        action_type="file.log.tail",
        input_schema={
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": {"type": "string", "minLength": 1, "maxLength": 4096},
                "lines": {"type": "integer", "minimum": 1, "maximum": 500},
            },
            "additionalProperties": False,
        },
        script=_LOG_TAIL_SCRIPT,
        script_args=lambda payload: [
            _required_path_text(payload, "path"),
            str(_optional_int(payload, "lines", 100, minimum=1, maximum=500)),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="log.grep",
        name="log.grep",
        description="Search a text log file for a bounded number of matches.",
        category="ops-file",
        action_type="file.log.grep",
        input_schema={
            "type": "object",
            "required": ["path", "pattern"],
            "properties": {
                "path": {"type": "string", "minLength": 1, "maxLength": 4096},
                "pattern": {"type": "string", "minLength": 1, "maxLength": 256},
                "ignore_case": {"type": "boolean"},
                "max_matches": {"type": "integer", "minimum": 1, "maximum": 200},
            },
            "additionalProperties": False,
        },
        script=_LOG_GREP_SCRIPT,
        script_args=lambda payload: [
            _required_path_text(payload, "path"),
            _required_text(payload, "pattern"),
            "true" if _optional_bool(payload, "ignore_case", True) else "false",
            str(_optional_int(payload, "max_matches", 50, minimum=1, maximum=200)),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="file.hash",
        name="file.hash",
        description="Calculate a read-only file hash from the workspace.",
        category="ops-file",
        action_type="file.hash",
        input_schema={
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": {"type": "string", "minLength": 1, "maxLength": 4096},
                "algorithm": {"type": "string", "enum": ["sha256", "sha1", "md5"]},
            },
            "additionalProperties": False,
        },
        script=_FILE_HASH_SCRIPT,
        script_args=lambda payload: [
            _required_path_text(payload, "path"),
            _optional_enum(payload, "algorithm", {"sha256", "sha1", "md5"}, "sha256"),
        ],
    ))
    tools.update(_paired_python_tools(
        suffix="archive.inspect",
        name="archive.inspect",
        description="List archive entries without extracting files.",
        category="ops-file",
        action_type="archive.inspect",
        input_schema={
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": {"type": "string", "minLength": 1, "maxLength": 4096},
                "max_entries": {"type": "integer", "minimum": 1, "maximum": 500},
            },
            "additionalProperties": False,
        },
        script=_ARCHIVE_INSPECT_SCRIPT,
        script_args=lambda payload: [
            _required_path_text(payload, "path"),
            str(_optional_int(payload, "max_entries", 100, minimum=1, maximum=500)),
        ],
    ))
    return tools


_TOOLS: dict[str, _ToolDefinition] = {
    "local.webcheck": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.webcheck",
            name="webcheck",
            description="Run a bounded HTTP health check from the local workspace.",
            backend=ToolBackend.LOCAL,
            executable="python",
            category="ops-http",
            action_type="web.http.health",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=30,
            max_timeout_seconds=60,
            input_schema={
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type": "string", "minLength": 1, "maxLength": 2048},
                    "method": {"type": "string", "enum": ["GET", "HEAD"]},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"requires_scope": True},
        ),
        install_hint="Python runtime is required for built-in local operations tools.",
        build_args=lambda payload: [
            "python",
            "-c",
            _WEB_CHECK_SCRIPT,
            _required_url(payload, "url"),
            _optional_enum(payload, "method", {"GET", "HEAD"}, "GET"),
            str(_optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)),
        ],
    ),
    "local.tls.inspect": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.tls.inspect",
            name="tls.inspect",
            description="Inspect a remote TLS certificate from the local workspace.",
            backend=ToolBackend.LOCAL,
            executable="python",
            category="ops-tls",
            action_type="web.tls.inspect",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=30,
            max_timeout_seconds=60,
            input_schema={
                "type": "object",
                "required": ["host"],
                "properties": {
                    "host": {"type": "string", "minLength": 1, "maxLength": 255},
                    "port": {"type": "integer", "minimum": 1, "maximum": 65535},
                    "server_name": {"type": "string", "minLength": 1, "maxLength": 255},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"requires_scope": True},
        ),
        install_hint="Python runtime is required for built-in local operations tools.",
        build_args=lambda payload: [
            "python",
            "-c",
            _TLS_INSPECT_SCRIPT,
            _required_host(payload, "host"),
            str(_optional_int(payload, "port", 443, minimum=1, maximum=65535)),
            str(payload.get("server_name") or ""),
            str(_optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)),
        ],
    ),
    "local.port.scan": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.port.scan",
            name="port.scan",
            description="Probe a small bounded set of TCP ports from the local workspace.",
            backend=ToolBackend.LOCAL,
            executable="python",
            category="ops-network",
            action_type="network.port.probe",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=30,
            max_timeout_seconds=60,
            input_schema={
                "type": "object",
                "required": ["host", "ports"],
                "properties": {
                    "host": {"type": "string", "minLength": 1, "maxLength": 255},
                    "ports": {"type": "string", "minLength": 1, "maxLength": 256},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 5},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"requires_scope": True, "max_ports": 32},
        ),
        install_hint="Python runtime is required for built-in local operations tools.",
        build_args=lambda payload: [
            "python",
            "-c",
            _PORT_SCAN_SCRIPT,
            _required_host(payload, "host"),
            ",".join(str(port) for port in _required_ports(payload, "ports", max_ports=32)),
            str(_optional_int(payload, "timeout_seconds", 1, minimum=1, maximum=5)),
        ],
    ),
    "local.dns.lookup": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.dns.lookup",
            name="dns.lookup",
            description="Resolve A and AAAA records with the local system resolver.",
            backend=ToolBackend.LOCAL,
            executable="python",
            category="ops-dns",
            action_type="network.dns.lookup",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=30,
            max_timeout_seconds=60,
            input_schema={
                "type": "object",
                "required": ["host"],
                "properties": {
                    "host": {"type": "string", "minLength": 1, "maxLength": 255},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 10},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"requires_scope": True},
        ),
        install_hint="Python runtime is required for built-in local operations tools.",
        build_args=lambda payload: [
            "python",
            "-c",
            _DNS_LOOKUP_SCRIPT,
            _required_host(payload, "host"),
            str(_optional_int(payload, "timeout_seconds", 5, minimum=1, maximum=10)),
        ],
    ),
    "local.ping": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.ping",
            name="ping",
            description="Run a bounded ping connectivity check from the local workspace.",
            backend=ToolBackend.LOCAL,
            executable="python",
            category="ops-network",
            action_type="network.ping",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=30,
            max_timeout_seconds=60,
            input_schema={
                "type": "object",
                "required": ["host"],
                "properties": {
                    "host": {"type": "string", "minLength": 1, "maxLength": 255},
                    "count": {"type": "integer", "minimum": 1, "maximum": 10},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 10},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"requires_scope": True, "max_count": 10},
        ),
        install_hint="Python runtime and system ping command are required.",
        build_args=lambda payload: [
            "python",
            "-c",
            _PING_SCRIPT,
            _required_host(payload, "host"),
            str(_optional_int(payload, "count", 4, minimum=1, maximum=10)),
            str(_optional_int(payload, "timeout_seconds", 2, minimum=1, maximum=10)),
        ],
    ),
    "local.http.headers": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.http.headers",
            name="http.headers",
            description="Fetch response headers with a bounded HTTP HEAD request.",
            backend=ToolBackend.LOCAL,
            executable="python",
            category="ops-http",
            action_type="web.http.headers",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=30,
            max_timeout_seconds=60,
            input_schema={
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type": "string", "minLength": 1, "maxLength": 2048},
                    "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"requires_scope": True},
        ),
        install_hint="Python runtime is required for built-in local operations tools.",
        build_args=lambda payload: [
            "python",
            "-c",
            _HTTP_HEADERS_SCRIPT,
            _required_url(payload, "url"),
            str(_optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)),
        ],
    ),
    "local.httpx": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.httpx",
            name="httpx",
            description="Probe HTTP services from the local portable workspace.",
            backend=ToolBackend.LOCAL,
            executable="httpx",
            category="web-probe",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=60,
            max_timeout_seconds=120,
            input_schema=_target_input_schema(),
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "max_concurrency": 20, "requires_scope": True},
        ),
        install_hint="Install ProjectDiscovery httpx into portable-tools or PATH.",
        build_args=lambda payload: ["httpx", "-u", _required_text(payload, "target"), "-silent", "-json"],
    ),
    "local.dnsx": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.dnsx",
            name="dnsx",
            description="Resolve DNS records from the local portable workspace.",
            backend=ToolBackend.LOCAL,
            executable="dnsx",
            category="dns-probe",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=60,
            max_timeout_seconds=120,
            input_schema=_target_input_schema("domain"),
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "max_concurrency": 20, "requires_scope": True},
        ),
        install_hint="Install ProjectDiscovery dnsx into portable-tools or PATH.",
        build_args=lambda payload: ["dnsx", "-silent", "-j"],
        stdin_text=lambda payload: _required_text(payload, "domain"),
    ),
    "local.ffuf": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="local.ffuf",
            name="ffuf",
            description="Run a bounded ffuf content discovery job locally.",
            backend=ToolBackend.LOCAL,
            executable="ffuf",
            category="web-fuzz",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=120,
            max_timeout_seconds=300,
            input_schema={
                "type": "object",
                "required": ["url", "wordlist"],
                "properties": {
                    "url": {"type": "string", "minLength": 1, "maxLength": 2048},
                    "wordlist": {"type": "string", "minLength": 1, "maxLength": 4096},
                    "rps": {"type": "integer", "minimum": 1, "maximum": 50},
                },
                "additionalProperties": False,
            },
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "requires_scope": True, "requires_fuzz_marker": True},
        ),
        install_hint="Install ffuf into portable-tools or PATH.",
        build_args=lambda payload: [
            "ffuf",
            "-u",
            _required_text(payload, "url"),
            "-w",
            _required_text(payload, "wordlist"),
            "-json",
            *_optional_rate(payload),
        ],
    ),
    "ssh.nmap": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="ssh.nmap",
            name="nmap",
            description="Run nmap from an SSH Linux workspace.",
            backend=ToolBackend.SSH,
            executable="nmap",
            category="network-scan",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=120,
            max_timeout_seconds=300,
            input_schema=_target_input_schema(),
            output_schema=_base_output_schema(),
            policy={"max_rps": 50, "max_concurrency": 20, "requires_scope": True},
        ),
        install_hint="Install nmap on the configured SSH Linux host.",
        build_args=lambda payload: ["nmap", "-oX", "-", _required_text(payload, "target")],
    ),
    "ssh.sqlmap": _ToolDefinition(
        manifest=ToolManifestSchema(
            id="ssh.sqlmap",
            name="sqlmap",
            description="Run a bounded sqlmap probe from an SSH Linux workspace.",
            backend=ToolBackend.SSH,
            executable="sqlmap",
            category="web-sql",
            action_type="security.web.scan",
            risk_level=RiskLevel.L1,
            default_timeout_seconds=300,
            max_timeout_seconds=600,
            input_schema=_target_input_schema(),
            output_schema=_base_output_schema(),
            policy={"max_rps": 10, "max_concurrency": 4, "requires_scope": True},
        ),
        install_hint="Install sqlmap on the configured SSH Linux host.",
        build_args=lambda payload: [
            "sqlmap",
            "-u",
            _required_text(payload, "target"),
            "--batch",
            "--disable-coloring",
            "--level=1",
            "--risk=1",
            "--timeout=5",
            "--retries=0",
            "--flush-session",
        ],
    ),
}

_TOOLS.update(_operations_tool_definitions())


async def list_toolpack_tools(sandbox_container_id: int | None = None) -> QueryToolpackToolsResponse:
    tools = [
        await _tool_schema(definition, sandbox_container_id=sandbox_container_id)
        for definition in _TOOLS.values()
    ]
    return QueryToolpackToolsResponse(tools=tools)


async def start_tool_run(tool_id: str, request: ToolRunRequest, user: AuthUser) -> ToolRunSnapshot:
    definition = _tool_definition(tool_id)
    await _ensure_container_permission(request.sandbox_container_id, user)
    run_id = uuid4().hex
    now = datetime.now()
    snapshot = ToolRunSnapshot(
        run_id=run_id,
        tool_id=tool_id,
        sandbox_container_id=request.sandbox_container_id,
        status=ToolRunStatus.RUNNING,
        started_at=now,
    )
    task = asyncio.create_task(
        _execute_tool_run(run_id, definition, request, started_at=now),
        name=f"toolpack-run-{run_id}",
    )
    async with _runs_lock:
        _runs[run_id] = _RunningToolRun(snapshot=snapshot, task=task)
    task.add_done_callback(lambda completed: _finish_task(run_id, completed))
    return snapshot


async def get_tool_run(run_id: str) -> ToolRunSnapshot | None:
    async with _runs_lock:
        running = _runs.get(run_id)
        return running.snapshot.model_copy(deep=True) if running is not None else None


async def cancel_tool_run(run_id: str) -> ToolRunCancelResponse:
    async with _runs_lock:
        running = _runs.get(run_id)
    if running is None:
        return ToolRunCancelResponse(run_id=run_id, canceled=False, status=ToolRunStatus.FAILED.value)
    await cancel_running_process(run_id)
    if not running.task.done():
        running.task.cancel()
    await asyncio.gather(running.task, return_exceptions=True)
    async with _runs_lock:
        status = _runs[run_id].snapshot.status if run_id in _runs else ToolRunStatus.CANCELED
    return ToolRunCancelResponse(run_id=run_id, canceled=True, status=status.value)


def resolve_tool_artifact_path(artifact_id: str):
    safe_id = artifact_id.strip()
    if not safe_id or "/" in safe_id or "\\" in safe_id or safe_id in {".", ".."}:
        raise ValueError("invalid artifact id")
    path = (_ARTIFACT_ROOT / f"{safe_id}.txt").resolve()
    root = _ARTIFACT_ROOT.resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise PermissionError("artifact path escapes toolpack artifact root") from exc
    if not path.is_file():
        raise FileNotFoundError("tool artifact not found")
    return path


async def _execute_tool_run(
    run_id: str,
    definition: _ToolDefinition,
    request: ToolRunRequest,
    *,
    started_at: datetime,
) -> None:
    try:
        await _validate_backend(definition, request.sandbox_container_id)
        _validate_policy(definition, request.input)
        if definition.manifest.backend == ToolBackend.LOCAL and not _local_tool_path(definition.manifest.executable):
            await _store_result(
                run_id,
                _error_result(
                    run_id,
                    started_at,
                    ExecutionErrorCode.TOOL_MISSING,
                    f"{definition.manifest.executable} is not installed",
                ),
                ToolRunStatus.FAILED,
            )
            return
        args = definition.build_args(request.input)
        stdin_text = definition.stdin_text(request.input) if definition.stdin_text is not None else None
        command = _shell_command(args, stdin_text=stdin_text)
        timeout = min(
            request.timeout_seconds or definition.manifest.default_timeout_seconds,
            definition.manifest.max_timeout_seconds,
        )
        command_result = await execute_sandbox_container_command(
            request.sandbox_container_id,
            _with_tool_precheck(definition, command, args=args, stdin_text=stdin_text),
            timeout,
            execution_id=run_id,
        )
        result = _result_from_command(
            run_id,
            definition,
            command_result,
            started_at=started_at,
            finished_at=datetime.now(),
        )
        await _store_result(run_id, result, ToolRunStatus.COMPLETED if result.ok else ToolRunStatus.FAILED)
    except asyncio.CancelledError:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.CANCELED, "tool run canceled"),
            ToolRunStatus.CANCELED,
        )
        raise
    except SandboxContainerCommandTimeoutError:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.TIMEOUT, "tool run timed out"),
            ToolRunStatus.FAILED,
        )
    except PermissionError as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.POLICY_DENIED, str(exc)),
            ToolRunStatus.FAILED,
        )
    except ValueError as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.POLICY_DENIED, str(exc)),
            ToolRunStatus.FAILED,
        )
    except NotImplementedError as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.PLATFORM_UNSUPPORTED, str(exc)),
            ToolRunStatus.FAILED,
        )
    except asyncssh.HostKeyNotVerifiable:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.HOST_KEY_CHANGED, "SSH host key is not trusted"),
            ToolRunStatus.FAILED,
        )
    except asyncssh.PermissionDenied:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.AUTH_FAILED, "SSH authentication failed"),
            ToolRunStatus.FAILED,
        )
    except (OSError, asyncssh.Error) as exc:
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.CONNECT_FAILED, str(exc) or "connection failed"),
            ToolRunStatus.FAILED,
        )
    except Exception as exc:
        logger.exception("toolpack run failed: %s", run_id)
        await _store_result(
            run_id,
            _error_result(run_id, started_at, ExecutionErrorCode.PROCESS_FAILED, str(exc) or "tool run failed"),
            ToolRunStatus.FAILED,
        )


async def _tool_schema(
    definition: _ToolDefinition,
    *,
    sandbox_container_id: int | None,
) -> ToolSchema:
    available: bool | None = None
    message = ""
    if definition.manifest.backend == ToolBackend.LOCAL:
        if sandbox_container_id is not None:
            _, host = await resolve_container_host(sandbox_container_id)
            if host.id != DEFAULT_LOCAL_HOST_ID:
                available = False
                message = "local tools require a local workspace"
            else:
                available = _local_tool_path(definition.manifest.executable) is not None
                message = "available" if available else "missing from portable-tools and PATH"
        else:
            available = _local_tool_path(definition.manifest.executable) is not None
            message = "available" if available else "missing from portable-tools and PATH"
    elif sandbox_container_id is None:
        message = "availability requires an SSH workspace"
    else:
        _, host = await resolve_container_host(sandbox_container_id)
        if host.id == DEFAULT_LOCAL_HOST_ID:
            available = False
            message = "Linux-heavy tools require an SSH workspace"
        else:
            message = "availability will be checked in the SSH workspace at run time"
    return ToolSchema(
        id=definition.manifest.id,
        name=definition.manifest.name,
        description=definition.manifest.description,
        backend=definition.manifest.backend,
        category=definition.manifest.category,
        available=available,
        availability_message=message,
        install_hint=definition.install_hint,
        manifest=definition.manifest,
    )


def _tool_definition(tool_id: str) -> _ToolDefinition:
    try:
        return _TOOLS[tool_id]
    except KeyError as exc:
        raise FileNotFoundError("tool not found") from exc


async def _ensure_container_permission(container_id: int, user: AuthUser) -> None:
    manageable = await sandbox_container_is_manageable_by_user(
        id=container_id,
        user_id=user.id,
        user_role=user.role,
    )
    if manageable is None:
        raise FileNotFoundError("portable workspace not found")
    if not manageable and user.role != SystemUserRole.ADMIN:
        raise PermissionError("no permission to use this portable workspace")


async def _validate_backend(definition: _ToolDefinition, container_id: int) -> None:
    container, host = await resolve_container_host(container_id)
    if container.status != SandboxContainerStatus.RUNNING:
        raise PermissionError("portable workspace is not running")
    is_local = host.id == DEFAULT_LOCAL_HOST_ID
    if definition.manifest.backend == ToolBackend.LOCAL and not is_local:
        raise NotImplementedError("local tools must run in a local workspace")
    if definition.manifest.backend == ToolBackend.SSH and is_local:
        raise NotImplementedError("Linux-heavy tools require an SSH workspace")


def _validate_policy(definition: _ToolDefinition, payload: dict[str, Any]) -> None:
    schema = definition.manifest.input_schema
    for field in schema.get("required", []):
        _required_text(payload, str(field))
    if definition.manifest.id == "local.webcheck":
        _required_url(payload, "url")
        _optional_enum(payload, "method", {"GET", "HEAD"}, "GET")
        _optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)
    if definition.manifest.id == "local.tls.inspect":
        _required_host(payload, "host")
        _optional_int(payload, "port", 443, minimum=1, maximum=65535)
        _optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)
    if definition.manifest.id == "local.port.scan":
        _required_host(payload, "host")
        _required_ports(payload, "ports", max_ports=int(definition.manifest.policy.get("max_ports", 32)))
        _optional_int(payload, "timeout_seconds", 1, minimum=1, maximum=5)
    if definition.manifest.id == "local.dns.lookup":
        _required_host(payload, "host")
        _optional_int(payload, "timeout_seconds", 5, minimum=1, maximum=10)
    if definition.manifest.id == "local.ping":
        _required_host(payload, "host")
        _optional_int(payload, "count", 4, minimum=1, maximum=10)
        _optional_int(payload, "timeout_seconds", 2, minimum=1, maximum=10)
    if definition.manifest.id == "local.http.headers":
        _required_url(payload, "url")
        _optional_int(payload, "timeout_seconds", 10, minimum=1, maximum=30)
    max_rps = int(definition.manifest.policy.get("max_rps", 50))
    max_concurrency = int(definition.manifest.policy.get("max_concurrency", 20))
    if int(payload.get("rps") or 1) > max_rps:
        raise PermissionError(f"rps exceeds policy limit {max_rps}")
    if int(payload.get("concurrency") or 1) > max_concurrency:
        raise PermissionError(f"concurrency exceeds policy limit {max_concurrency}")
    if definition.manifest.id == "local.ffuf" and "FUZZ" not in _required_text(payload, "url"):
        raise PermissionError("ffuf url must contain FUZZ marker")


def _required_text(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str):
        raise ValueError(f"{field} is required")
    value = value.strip()
    if not value:
        raise ValueError(f"{field} is required")
    if len(value) > 4096 or any(ord(char) < 32 for char in value):
        raise ValueError(f"{field} is invalid")
    return value


def _required_url(payload: dict[str, Any], field: str) -> str:
    value = _required_text(payload, field)
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{field} must be an http or https URL")
    return value


def _required_urls_text(payload: dict[str, Any], field: str, *, max_items: int) -> str:
    value = _required_text_allow_newlines(payload, field)
    items = [item.strip() for item in value.replace("\n", ",").split(",") if item.strip()]
    if not items:
        raise ValueError(f"{field} is required")
    if len(items) > max_items:
        raise PermissionError(f"{field} count exceeds policy limit {max_items}")
    for item in items:
        parsed = urlsplit(item)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError(f"{field} contains an invalid http or https URL")
    return "\n".join(items)


def _required_text_allow_newlines(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str):
        raise ValueError(f"{field} is required")
    value = value.strip()
    if not value:
        raise ValueError(f"{field} is required")
    if len(value) > 8192 or any((ord(char) < 32 and char not in {"\n", "\r", "\t"}) for char in value):
        raise ValueError(f"{field} is invalid")
    return value


def _required_host(payload: dict[str, Any], field: str) -> str:
    value = _required_text(payload, field)
    if "://" in value or "/" in value or "\\" in value or any(char.isspace() for char in value):
        raise ValueError(f"{field} must be a host name or IP address")
    return value


def _required_path_text(payload: dict[str, Any], field: str) -> str:
    value = _required_text(payload, field)
    if "\x00" in value:
        raise ValueError(f"{field} is invalid")
    return value


def _optional_text(payload: dict[str, Any], field: str, default: str) -> str:
    value = payload.get(field)
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    value = value.strip()
    if not value:
        return default
    if len(value) > 4096 or any(ord(char) < 32 for char in value):
        raise ValueError(f"{field} is invalid")
    return value


def _optional_bool(payload: dict[str, Any], field: str, default: bool) -> bool:
    value = payload.get(field)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise ValueError(f"{field} must be a boolean")


def _optional_enum(payload: dict[str, Any], field: str, allowed: set[str], default: str) -> str:
    value = str(payload.get(field) or default)
    if value in allowed:
        return value
    upper_value = value.upper()
    if upper_value in allowed:
        return upper_value
    lower_value = value.lower()
    if lower_value in allowed:
        return lower_value
    if value not in allowed:
        raise ValueError(f"{field} must be one of {', '.join(sorted(allowed))}")
    return value


def _optional_int(payload: dict[str, Any], field: str, default: int, *, minimum: int, maximum: int) -> int:
    raw_value = payload.get(field, default)
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be an integer") from exc
    if value < minimum or value > maximum:
        raise PermissionError(f"{field} must be between {minimum} and {maximum}")
    return value


def _required_ports(payload: dict[str, Any], field: str, *, max_ports: int) -> list[int]:
    raw_value = _required_text(payload, field)
    ports: list[int] = []
    for part in raw_value.split(","):
        item = part.strip()
        if not item:
            continue
        if "-" in item:
            start_text, end_text = item.split("-", 1)
            start, end = int(start_text), int(end_text)
            if start > end:
                raise ValueError(f"{field} range is invalid")
            ports.extend(range(start, end + 1))
        else:
            ports.append(int(item))
    normalized = sorted(set(ports))
    if not normalized or any(port < 1 or port > 65535 for port in normalized):
        raise ValueError(f"{field} contains an invalid TCP port")
    if len(normalized) > max_ports:
        raise PermissionError(f"port count exceeds policy limit {max_ports}")
    return normalized


def _optional_rate(payload: dict[str, Any]) -> list[str]:
    rps = payload.get("rps")
    if rps is None:
        return []
    return ["-rate", str(max(1, min(int(rps), 50)))]


def _local_tool_path(executable: str) -> str | None:
    return shutil.which(executable, path=portable_tool_environment().get("PATH"))


def _shell_command(tokens: list[str], *, stdin_text: str | None = None) -> str:
    if os.name == "nt":
        return _powershell_command(tokens, stdin_text=stdin_text)
    command = " ".join(shlex.quote(token) for token in tokens)
    if stdin_text is None:
        return command
    return f"printf '%s\\n' {shlex.quote(stdin_text)} | {command}"


def _powershell_command(tokens: list[str], *, stdin_text: str | None = None) -> str:
    quoted = " ".join(_powershell_quote(token) for token in tokens)
    if stdin_text is not None:
        return f"{_powershell_quote(stdin_text)} | & {quoted}; exit $LASTEXITCODE"
    return f"& {quoted}; exit $LASTEXITCODE"


def _powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _with_tool_precheck(
    definition: _ToolDefinition,
    command: str,
    *,
    args: list[str],
    stdin_text: str | None,
) -> str:
    if definition.manifest.backend == ToolBackend.LOCAL and os.name == "nt":
        executable = _powershell_quote(definition.manifest.executable)
        return (
            f"if (-not (Get-Command {executable} -ErrorAction SilentlyContinue)) "
            "{ exit 127 }; "
            f"{_powershell_command(args, stdin_text=stdin_text)}"
        )
    executable = shlex.quote(definition.manifest.executable)
    return f"command -v {executable} >/dev/null 2>&1 || exit 127; exec {command}"


def _result_from_command(
    run_id: str,
    definition: _ToolDefinition,
    command_result: SandboxContainerCommandResult,
    *,
    started_at: datetime,
    finished_at: datetime,
) -> ExecutionResult:
    output = command_result.output or ""
    if command_result.exit_code == 127:
        return ExecutionResult(
            ok=False,
            execution_id=run_id,
            summary=f"{definition.manifest.executable} is not installed",
            structured={"tool_id": definition.manifest.id, "records": [], "stdout": ""},
            exit_code=command_result.exit_code,
            started_at=started_at,
            finished_at=finished_at,
            error_code=ExecutionErrorCode.TOOL_MISSING,
        )
    artifact_refs: list[ExecutionArtifact] = []
    truncated = len(output.encode()) > _MAX_STRUCTURED_STDOUT
    structured_stdout = output
    if truncated:
        artifact_refs.append(_write_artifact(run_id, output))
        structured_stdout = output.encode()[:_MAX_STRUCTURED_STDOUT].decode(errors="replace")
    records = _parse_output_records(output)
    ok = command_result.exit_code == 0
    return ExecutionResult(
        ok=ok,
        execution_id=run_id,
        summary="tool completed" if ok else "tool exited with a non-zero status",
        structured={
            "tool_id": definition.manifest.id,
            "stdout": structured_stdout,
            "records": records,
        },
        artifact_refs=artifact_refs,
        exit_code=command_result.exit_code,
        started_at=started_at,
        finished_at=finished_at,
        truncated=truncated,
        error_code=None if ok else ExecutionErrorCode.PROCESS_FAILED,
    )


def _parse_output_records(output: str) -> list[Any]:
    records: list[Any] = []
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            records.append(json.loads(stripped))
        except ValueError:
            records.append({"line": stripped})
    return records


def _write_artifact(run_id: str, output: str) -> ExecutionArtifact:
    _ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    path = _ARTIFACT_ROOT / f"{run_id}.stdout.txt"
    path.write_text(output, encoding="utf-8")
    return ExecutionArtifact(
        id=path.stem,
        path=str(path.relative_to(WORKSPACE)),
        media_type="text/plain",
        size=path.stat().st_size,
    )


def _error_result(
    run_id: str,
    started_at: datetime,
    error_code: ExecutionErrorCode,
    summary: str,
) -> ExecutionResult:
    finished_at = datetime.now()
    return ExecutionResult(
        ok=False,
        execution_id=run_id,
        summary=summary,
        structured={"records": []},
        artifact_refs=[],
        exit_code=None,
        started_at=started_at,
        finished_at=finished_at,
        truncated=False,
        error_code=error_code,
    )


async def _store_result(run_id: str, result: ExecutionResult, status: ToolRunStatus) -> None:
    async with _runs_lock:
        running = _runs.get(run_id)
        if running is None:
            return
        running.snapshot.status = status
        running.snapshot.result = result
        running.snapshot.finished_at = result.finished_at


def _finish_task(run_id: str, task: asyncio.Task[None]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("toolpack task failed: %s", run_id)
