from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from config import WORKSPACE, PermissionMode, get_config, read_config_file, write_config_file
from core.runtime.context import AgentRuntimeContext
from schema.action import RiskLevel
from schema.runtime_permissions import (
    RuntimePermissionDecision,
    RuntimePermissionRequest,
    RuntimePermissionRule,
    RuntimePermissionStatus,
)

_RULES_PATH = WORKSPACE / "permissions" / "always-allow.json"
_AUDIT_PATH = WORKSPACE / "audit" / "permissions.jsonl"


@dataclass
class _PendingPermission:
    request: RuntimePermissionRequest
    event: asyncio.Event
    decision: RuntimePermissionDecision | None = None


_pending: dict[UUID, _PendingPermission] = {}
_lock = asyncio.Lock()


async def require_permission(
    context: AgentRuntimeContext,
    *,
    action_type: str,
    target: str,
    reason: str,
    risk_level: RiskLevel,
    details: dict[str, object] | None = None,
) -> str | None:
    settings = get_config().permissions
    if settings.mode == PermissionMode.FULL_ACCESS:
        return
    if _rule_matches(action_type, target):
        _audit(context, action_type, target, "allow", "always_allow")
        return RuntimePermissionDecision.ALWAYS_ALLOW.value

    request = RuntimePermissionRequest(
        session_id=context.session_id,
        agent_code=context.agent_code,
        agent_name=context.agent_code,
        requester_id=context.user.id,
        action_type=action_type,
        target=target,
        reason=reason,
        risk_level=risk_level,
        details=dict(details or {}),
        expires_at=datetime.now() + timedelta(seconds=settings.approval_timeout_seconds),
    )
    pending = _PendingPermission(request=request, event=asyncio.Event())
    async with _lock:
        _pending[request.id] = pending
    try:
        await asyncio.wait_for(pending.event.wait(), timeout=settings.approval_timeout_seconds)
    except TimeoutError as exc:
        request.status = RuntimePermissionStatus.EXPIRED
        _audit(context, action_type, target, "deny", "expired")
        raise PermissionError("授权请求已超时") from exc
    finally:
        async with _lock:
            _pending.pop(request.id, None)

    if get_config().permissions.mode == PermissionMode.FULL_ACCESS:
        return
    if pending.decision not in {RuntimePermissionDecision.ALLOW_ONCE, RuntimePermissionDecision.ALWAYS_ALLOW}:
        _audit(context, action_type, target, "deny", "user_rejected")
        raise PermissionError("用户拒绝了该操作")
    _audit(context, action_type, target, "allow", pending.decision.value)
    return pending.decision.value


async def list_pending(*, requester_id: int) -> list[RuntimePermissionRequest]:
    now = datetime.now()
    async with _lock:
        values = [
            pending.request.model_copy(deep=True)
            for pending in _pending.values()
            if pending.request.requester_id == requester_id and pending.request.expires_at > now
        ]
    return sorted(values, key=lambda item: item.created_at)


async def decide(
    request_id: UUID,
    *,
    requester_id: int,
    decision: RuntimePermissionDecision,
) -> RuntimePermissionRequest:
    async with _lock:
        pending = _pending.get(request_id)
        if pending is None or pending.request.requester_id != requester_id:
            raise FileNotFoundError("授权请求不存在或已结束")
        if decision == RuntimePermissionDecision.ALWAYS_ALLOW:
            _add_rule(pending.request.action_type, pending.request.target)
        pending.decision = decision
        pending.request.status = (
            RuntimePermissionStatus.REJECTED
            if decision == RuntimePermissionDecision.REJECT
            else RuntimePermissionStatus.ALLOWED
        )
        result = pending.request.model_copy(deep=True)
        pending.event.set()
        return result


def get_settings():
    return get_config().permissions.model_copy(deep=True)


async def update_mode(mode: PermissionMode):
    async with _lock:
        file_cfg = read_config_file()
        file_cfg.permissions.mode = mode
        write_config_file(file_cfg)
        get_config().permissions = file_cfg.permissions.model_copy(deep=True)
        if mode == PermissionMode.FULL_ACCESS:
            for pending in _pending.values():
                pending.decision = RuntimePermissionDecision.ALLOW_ONCE
                pending.request.status = RuntimePermissionStatus.ALLOWED
                pending.event.set()
    return get_settings()


def list_rules() -> list[RuntimePermissionRule]:
    return _load_rules()


def clear_rules() -> int:
    rules = _load_rules()
    _RULES_PATH.unlink(missing_ok=True)
    return len(rules)


def _rule_matches(action_type: str, target: str) -> bool:
    return any(rule.action_type == action_type and rule.target == target for rule in _load_rules())


def _add_rule(action_type: str, target: str) -> None:
    rules = _load_rules()
    if any(rule.action_type == action_type and rule.target == target for rule in rules):
        return
    rules.append(RuntimePermissionRule(action_type=action_type, target=target))
    _RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    _RULES_PATH.write_text(
        json.dumps([rule.model_dump(mode="json") for rule in rules], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_rules() -> list[RuntimePermissionRule]:
    if not _RULES_PATH.is_file():
        return []
    try:
        payload = json.loads(_RULES_PATH.read_text(encoding="utf-8"))
        return [RuntimePermissionRule.model_validate(item) for item in payload if isinstance(item, dict)]
    except (OSError, ValueError):
        return []


def _audit(
    context: AgentRuntimeContext,
    action_type: str,
    target: str,
    effect: str,
    source: str,
) -> None:
    try:
        _AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "timestamp": datetime.now().isoformat(),
            "session_id": context.session_id,
            "agent_code": context.agent_code,
            "requester_id": context.user.id,
            "action_type": action_type,
            "target": target,
            "effect": effect,
            "source": source,
        }
        with _AUDIT_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        return
