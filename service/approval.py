from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

from config import WORKSPACE, get_config
from core.approval_gate import action_hash, issue_approval_token, verify_approval_token
from core.policy_engine import evaluate_action
from schema.approval import ApprovalClaims, ApprovalStatus
from schema.approval_api import ApprovalCreateRequest, ApprovalRecord

_ROOT = WORKSPACE / "approvals"


def evaluate(request: ApprovalCreateRequest):
    return evaluate_action(request.action, request.scope, environment=request.environment)


def create(request: ApprovalCreateRequest, *, requester_id: int, default_approver_id: int) -> ApprovalRecord:
    decision = evaluate(request)
    if decision.effect.value == "deny":
        raise PermissionError("策略拒绝该操作：" + ",".join(decision.reason_codes))
    now = datetime.now()
    expires = now + timedelta(seconds=decision.approval_ttl_seconds or 300)
    record = ApprovalRecord(
        approval_id=request.action.id,
        action=request.action,
        decision=decision,
        status=ApprovalStatus.PENDING.value,
        requester_id=requester_id,
        approver_id=request.approver_id or default_approver_id,
        created_at=now,
        expires_at=expires,
    )
    _write(record)
    return record


def list_records() -> list[ApprovalRecord]:
    _ROOT.mkdir(parents=True, exist_ok=True)
    records: list[ApprovalRecord] = []
    for path in sorted(_ROOT.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            records.append(ApprovalRecord.model_validate_json(path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return records


def get(approval_id: UUID) -> ApprovalRecord | None:
    path = _ROOT / f"{approval_id}.json"
    if not path.is_file():
        return None
    try:
        return ApprovalRecord.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def decide(approval_id: UUID, *, approver_id: int, approved: bool) -> tuple[ApprovalRecord, str]:
    record = get(approval_id)
    if record is None:
        raise FileNotFoundError("approval not found")
    if record.approver_id != approver_id:
        raise PermissionError("approval belongs to another approver")
    if datetime.now() >= record.expires_at:
        record.status = ApprovalStatus.EXPIRED.value
        _write(record)
        raise PermissionError("approval expired")
    if record.status != ApprovalStatus.PENDING.value:
        raise ValueError("approval is no longer pending")
    if not approved:
        record.status = ApprovalStatus.REJECTED.value
        _write(record)
        return record, ""
    record.status = ApprovalStatus.GRANTED.value
    _write(record)
    claims = ApprovalClaims(
        approval_id=record.approval_id,
        project_id=record.action.project_id,
        incident_id=record.action.incident_id,
        action_id=record.action.id,
        action_hash=action_hash(record.action),
        target_id=record.action.target_id,
        approver_id=approver_id,
        expires_at=record.expires_at,
    )
    return record, issue_approval_token(claims, _secret())


def consume(*, action, token: str, approver_id: int) -> tuple[ApprovalRecord, ApprovalClaims]:
    claims = verify_approval_token(token, _secret(), action=action, approver_id=approver_id)
    record = get(claims.approval_id)
    if record is None or record.status != ApprovalStatus.GRANTED.value:
        raise PermissionError("approval is not granted")
    record.status = ApprovalStatus.CONSUMED.value
    _write(record)
    return record, claims


def _write(record: ApprovalRecord) -> None:
    _ROOT.mkdir(parents=True, exist_ok=True)
    path = _ROOT / f"{record.approval_id}.json"
    path.write_text(record.model_dump_json(indent=2), encoding="utf-8")


def _secret() -> bytes:
    return get_config().system.encrypt_key.encode("utf-8")
