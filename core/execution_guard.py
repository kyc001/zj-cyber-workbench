from __future__ import annotations

import json
import re
from datetime import datetime
from urllib.parse import urlsplit
from uuid import UUID, uuid5

from config import WORKSPACE
from core.policy_engine import evaluate_action
from core.runtime.context import AgentRuntimeContext
from schema.action import PolicyEffect, ProposedAction, RiskLevel
from schema.incident import AuthorizationScope, TargetEnvironment

_TARGET_NAMESPACE = UUID("4b7e0d2d-2d83-4b25-9a9f-8fbf2f00c1e3")
_AUDIT_PATH = WORKSPACE / "audit" / "executions.jsonl"
_URL_RE = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)


def extract_urls(text: str) -> tuple[str, ...]:
    values: list[str] = []
    for raw in _URL_RE.findall(text or ""):
        url = raw.rstrip(".,，。；;)")
        parsed = urlsplit(url)
        if parsed.scheme in {"http", "https"} and parsed.hostname and url not in values:
            values.append(url)
    return tuple(values)


def target_id(target: str) -> UUID:
    parsed = urlsplit(target.strip().lower())
    if parsed.hostname:
        canonical = f"{parsed.scheme}://{parsed.hostname}:{parsed.port or _default_port(parsed.scheme)}"
    else:
        canonical = target.strip().lower()
    return uuid5(_TARGET_NAMESPACE, canonical)


def authorize_network_action(
    context: AgentRuntimeContext,
    *,
    action_type: str,
    target: str,
    risk: RiskLevel = RiskLevel.L1,
) -> None:
    normalized = target.strip()
    if not normalized:
        raise PermissionError("目标不能为空")
    if not context.allowed_targets:
        raise PermissionError("当前会话没有声明授权目标")
    if not any(_same_target(normalized, declared) for declared in context.allowed_targets):
        _record(context, action_type, normalized, "deny", ["target_out_of_scope"])
        raise PermissionError("目标不在当前会话授权范围内")
    allowed_actions = set(context.allowed_action_types) or {action_type}
    scope = AuthorizationScope(
        allowed_target_ids={target_id(item) for item in context.allowed_targets},
        allowed_action_types=allowed_actions,
        maximum_risk_level=RiskLevel.L1,
    )
    action = ProposedAction(
        project_id=context.work_project_id or 1,
        incident_id=uuid5(_TARGET_NAMESPACE, context.session_id),
        target_id=target_id(normalized),
        action_type=action_type,
        arguments={"target": normalized},
        risk_level=risk,
        reason=f"agent tool {action_type}",
    )
    decision = evaluate_action(action, scope, environment=TargetEnvironment.TEST)
    _record(context, action_type, normalized, decision.effect.value, decision.reason_codes)
    if decision.effect != PolicyEffect.ALLOW:
        raise PermissionError(f"策略拒绝执行：{','.join(decision.reason_codes)}")


def authorize_local_diagnostic(context: AgentRuntimeContext, *, action_type: str = "host.local.diagnostic") -> None:
    if action_type not in {"host.local.diagnostic", *context.allowed_action_types}:
        raise PermissionError("本机诊断工具未被当前 Scope 授权")
    _record(context, action_type, "local://workspace", "allow", ["scope_and_policy_satisfied"])


def _same_target(actual: str, declared: str) -> bool:
    a, d = urlsplit(actual), urlsplit(declared)
    return (
        a.scheme == d.scheme
        and a.hostname == d.hostname
        and (a.port or _default_port(a.scheme)) == (d.port or _default_port(d.scheme))
    )


def _default_port(scheme: str) -> int:
    return 443 if scheme == "https" else 80


def _record(context: AgentRuntimeContext, action_type: str, target: str, effect: str, reasons: list[str]) -> None:
    try:
        _AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "timestamp": datetime.now().isoformat(), "session_id": context.session_id,
            "agent_code": context.agent_code, "scope_id": context.scope_id,
            "action_type": action_type, "target": target, "effect": effect, "reason_codes": reasons,
        }
        with _AUDIT_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        return
