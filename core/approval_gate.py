import base64
import hashlib
import hmac
import json
from datetime import datetime

from pydantic import ValidationError

from schema.action import ProposedAction
from schema.approval import ApprovalClaims


class ApprovalTokenError(ValueError):
    pass


def action_hash(action: ProposedAction) -> str:
    payload = action.model_dump(mode="json", exclude={"id"})
    canonical = json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def issue_approval_token(claims: ApprovalClaims, secret: bytes) -> str:
    _validate_secret(secret)
    body = claims.model_dump_json().encode("utf-8")
    signature = hmac.new(secret, body, hashlib.sha256).digest()
    return f"{_encode(body)}.{_encode(signature)}"


def verify_approval_token(
    token: str,
    secret: bytes,
    *,
    action: ProposedAction,
    approver_id: int,
    now: datetime | None = None,
) -> ApprovalClaims:
    _validate_secret(secret)
    try:
        body_part, signature_part = token.split(".", maxsplit=1)
        body = _decode(body_part)
        signature = _decode(signature_part)
    except (ValueError, TypeError) as exc:
        raise ApprovalTokenError("malformed approval token") from exc

    expected_signature = hmac.new(secret, body, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected_signature):
        raise ApprovalTokenError("invalid approval token signature")
    try:
        claims = ApprovalClaims.model_validate_json(body)
    except ValidationError as exc:
        raise ApprovalTokenError("invalid approval token claims") from exc

    evaluated_at = now or datetime.now()
    if evaluated_at >= claims.expires_at:
        raise ApprovalTokenError("approval token expired")
    if claims.action_id != action.id or claims.action_hash != action_hash(action):
        raise ApprovalTokenError("approval token does not match action")
    if claims.target_id != action.target_id or claims.incident_id != action.incident_id:
        raise ApprovalTokenError("approval token does not match target or incident")
    if claims.project_id != action.project_id or claims.approver_id != approver_id:
        raise ApprovalTokenError("approval token does not match project or approver")
    return claims


def _validate_secret(secret: bytes) -> None:
    if len(secret) < 32:
        raise ValueError("approval token secret must contain at least 32 bytes")


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)

