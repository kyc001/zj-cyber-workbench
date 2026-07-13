from __future__ import annotations

import asyncio
import json
import os
import re
import ssl
from datetime import datetime
from urllib.parse import urljoin, urlsplit

import httpx
from agents import RunContextWrapper, function_tool

from core.execution_guard import authorize_network_action
from core.runtime.context import AgentRuntimeContext

_MAX_BODY_BYTES = 128 * 1024
_MAX_LINKS = 100
_COMMON_PORTS = (80, 443, 8080, 8443)


@function_tool
async def http_request(
    ctx: RunContextWrapper[AgentRuntimeContext],
    url: str,
    method: str = "GET",
    timeout_seconds: int = 15,
) -> str:
    """对 Scope 内 URL 发起一次受限 HTTP GET/HEAD 请求并返回摘要。"""
    method = method.strip().upper()
    if method not in {"GET", "HEAD"}:
        return _error("仅允许 GET 或 HEAD 只读请求")
    try:
        authorize_network_action(ctx.context, action_type="web.http.health", target=url)
        timeout = max(1, min(int(timeout_seconds), 30))
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False, max_redirects=0) as client:
            response = await client.request(method, url, headers={"User-Agent": "ZJ-Authorized-Assessment/1.0"})
        body = response.content[:_MAX_BODY_BYTES] if method != "HEAD" else b""
        return json.dumps({
            "ok": True, "url": str(response.url), "status_code": response.status_code,
            "headers": _safe_headers(response.headers), "content_type": response.headers.get("content-type", ""),
            "redirect_location": response.headers.get("location", ""),
            "body": body.decode(errors="replace"), "body_truncated": len(response.content) > len(body),
        }, ensure_ascii=False)
    except Exception as exc:
        return _error(str(exc) or "HTTP 请求失败")


@function_tool
async def browser_fetch(ctx: RunContextWrapper[AgentRuntimeContext], url: str, timeout_seconds: int = 15) -> str:
    """以无头 HTTP 浏览器模式读取网页标题、链接和表单，不执行 JavaScript。"""
    try:
        authorize_network_action(ctx.context, action_type="web.http.health", target=url)
        timeout = max(1, min(int(timeout_seconds), 30))
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False, max_redirects=0) as client:
            response = await client.get(url, headers={"User-Agent": "ZJ-Browser-Fetch/1.0"})
        html = response.content[:_MAX_BODY_BYTES].decode(errors="replace")
        links = []
        for href in re.findall(r"<a[^>]+href=[\"']([^\"']+)", html, re.IGNORECASE):
            absolute = urljoin(str(response.url), href)
            if absolute not in links:
                links.append(absolute)
            if len(links) >= _MAX_LINKS:
                break
        title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
        forms = len(re.findall(r"<form\b", html, re.IGNORECASE))
        return json.dumps({"ok": True, "url": str(response.url), "status_code": response.status_code, "redirect_location": response.headers.get("location", ""), "title": _strip_html(title_match.group(1)) if title_match else "", "links": links, "forms": forms, "html_bytes": len(response.content), "html_preview": html[:16_384]}, ensure_ascii=False)
    except Exception as exc:
        return _error(str(exc) or "网页读取失败")


@function_tool
async def web_security_scan(ctx: RunContextWrapper[AgentRuntimeContext], url: str, timeout_seconds: int = 15) -> str:
    """执行低频、非破坏性的 Web 暴露面检查：状态、重定向、TLS 和安全 Header。"""
    try:
        authorize_network_action(ctx.context, action_type="security.web.scan", target=url)
        timeout = max(1, min(int(timeout_seconds), 30))
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False, max_redirects=0) as client:
            started = datetime.now()
            response = await client.get(url, headers={"User-Agent": "ZJ-Safe-Web-Scanner/1.0"})
        headers = {key.lower(): value for key, value in response.headers.items()}
        findings: list[dict[str, str]] = []
        required = {
            "strict-transport-security": "缺少 HSTS（仅 HTTPS 站点建议）",
            "content-security-policy": "缺少 Content-Security-Policy",
            "x-content-type-options": "缺少 X-Content-Type-Options",
            "x-frame-options": "缺少 X-Frame-Options 或等价 CSP frame-ancestors",
        }
        for header, message in required.items():
            if header not in headers and not (header == "x-frame-options" and "frame-ancestors" in headers.get("content-security-policy", "").lower()):
                findings.append({"kind": "header", "severity": "low", "message": message})
        if response.url.scheme == "https":
            tls = await _inspect_tls(response.url.hostname or "", response.url.port or 443)
        else:
            tls = {"checked": False, "reason": "目标使用 HTTP"}
        return json.dumps({"ok": True, "target": url, "final_url": str(response.url), "status_code": response.status_code, "redirect_location": response.headers.get("location", ""), "elapsed_ms": int((datetime.now() - started).total_seconds() * 1000), "headers": _safe_headers(response.headers), "tls": tls, "findings": findings}, ensure_ascii=False)
    except Exception as exc:
        return _error(str(exc) or "Web 安全扫描失败")


@function_tool
async def port_probe(ctx: RunContextWrapper[AgentRuntimeContext], target: str, ports: list[int] | None = None, timeout_seconds: int = 2) -> str:
    """对 Scope 内主机执行小范围 TCP 端口连通性检查，不进行服务利用。"""
    host, scheme_port = _target_host_port(target)
    selected = ports or ((scheme_port,) if scheme_port else _COMMON_PORTS)
    selected = sorted({int(port) for port in selected if 1 <= int(port) <= 65535})[:32]
    try:
        authorize_network_action(ctx.context, action_type="network.port.probe", target=_host_scope_url(target, host, scheme_port))
        timeout = max(0.2, min(float(timeout_seconds), 5.0))
        results = await asyncio.gather(*(_probe_port(host, port, timeout) for port in selected))
        return json.dumps({"ok": True, "host": host, "ports": results}, ensure_ascii=False)
    except Exception as exc:
        return _error(str(exc) or "端口检查失败")


@function_tool
async def ssh_command(ctx: RunContextWrapper[AgentRuntimeContext], target: str, command: str, username: str = "", port: int = 22, credential_ref: str = "", timeout_seconds: int = 15) -> str:
    """通过已配置 Host Key 和凭据引用执行远程只读 SSH 命令；不接收明文密码。"""
    try:
        authorize_network_action(ctx.context, action_type="ssh.command", target=f"ssh://{target}:{port}")
        if not username or not command.strip():
            return _error("SSH 需要 username 和 command")
        import asyncssh

        from config import WORKSPACE
        known_hosts = WORKSPACE / "ssh" / "known_hosts"
        credential = _load_ssh_credential(credential_ref)
        connection_kwargs: dict[str, object] = {
            "port": port,
            "username": credential.get("username") or username,
            "known_hosts": str(known_hosts),
            "connect_timeout": max(1, min(timeout_seconds, 30)),
        }
        if credential.get("password"):
            connection_kwargs["password"] = credential["password"]
        if credential.get("private_key"):
            connection_kwargs["client_keys"] = [credential["private_key"]]
        connection = await asyncssh.connect(target, **connection_kwargs)
        try:
            result = await asyncio.wait_for(connection.run(command, check=False), timeout=max(1, min(timeout_seconds, 30)))
        finally:
            connection.close()
            await connection.wait_closed()
        return json.dumps({"ok": result.exit_status == 0, "target": target, "exit_code": result.exit_status, "stdout": result.stdout[:_MAX_BODY_BYTES], "stderr": result.stderr[:_MAX_BODY_BYTES]}, ensure_ascii=False)
    except Exception as exc:
        return _error(str(exc) or "SSH 执行失败")


async def _probe_port(host: str, port: int, timeout: float) -> dict[str, object]:
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        writer.close()
        await writer.wait_closed()
        return {"port": port, "open": True}
    except Exception:
        return {"port": port, "open": False}


async def _inspect_tls(host: str, port: int) -> dict[str, object]:
    try:
        context = ssl.create_default_context()
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port, ssl=context, server_hostname=host), timeout=5)
        cert = writer.get_extra_info("peercert") or {}
        writer.close()
        await writer.wait_closed()
        return {"checked": True, "subject": cert.get("subject", ""), "issuer": cert.get("issuer", ""), "expires": cert.get("notAfter", "")}
    except Exception as exc:
        return {"checked": False, "error": str(exc)}


def _target_host_port(target: str) -> tuple[str, int | None]:
    parsed = urlsplit(target if "://" in target else f"http://{target}")
    if not parsed.hostname:
        raise ValueError("目标主机无效")
    return parsed.hostname, parsed.port


def _host_scope_url(target: str, host: str, port: int | None) -> str:
    parsed = urlsplit(target if "://" in target else f"http://{target}")
    scheme = parsed.scheme if parsed.scheme in {"http", "https"} else "http"
    return f"{scheme}://{host}:{port or (443 if scheme == 'https' else 80)}"


def _safe_headers(headers: httpx.Headers) -> dict[str, str]:
    return {key.lower(): value[:512] for key, value in headers.items() if key.lower() not in {"set-cookie", "authorization"}}


def _strip_html(value: str) -> str:
    return re.sub(r"<[^>]+>", "", value).strip()


def _load_ssh_credential(reference: str) -> dict[str, str]:
    """Resolve a local SSH credential reference without accepting plaintext secrets in tool arguments."""
    ref = reference.strip()
    if not ref:
        return {}
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", ref):
        raise ValueError("SSH credential_ref 格式无效")
    prefix = f"ZJ_SSH_CREDENTIAL_{ref.upper().replace('-', '_')}"
    credential = {
        "username": os.environ.get(f"{prefix}_USERNAME", "").strip(),
        "password": os.environ.get(f"{prefix}_PASSWORD", ""),
        "private_key": os.environ.get(f"{prefix}_PRIVATE_KEY", "").strip(),
    }
    if any(credential.values()):
        return credential
    from config import WORKSPACE
    path = WORKSPACE / "ssh" / "credentials.json"
    if not path.is_file():
        raise ValueError("未找到 SSH credential_ref；请在 .env 或工作区 credentials.json 配置")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        item = payload.get(ref, {}) if isinstance(payload, dict) else {}
    except (OSError, ValueError) as exc:
        raise ValueError("SSH 凭据文件无法读取") from exc
    if not isinstance(item, dict):
        raise ValueError("SSH credential_ref 不存在")
    return {key: str(item.get(key) or "") for key in ("username", "password", "private_key")}


def _error(message: str) -> str:
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)
