from datetime import datetime

from schema.action import PolicyDecision, PolicyEffect, ProposedAction, RiskLevel
from schema.incident import AuthorizationScope, TargetEnvironment

_RISK_ORDER = {
    RiskLevel.L0: 0,
    RiskLevel.L1: 1,
    RiskLevel.L2: 2,
    RiskLevel.L3: 3,
}


def evaluate_action(
    action: ProposedAction,
    scope: AuthorizationScope,
    *,
    environment: TargetEnvironment,
    now: datetime | None = None,
) -> PolicyDecision:
    """Evaluate immutable scope and action facts; prompts cannot override this result."""
    evaluated_at = now or datetime.now()
    reasons: list[str] = []

    if action.target_id not in scope.allowed_target_ids:
        reasons.append("target_out_of_scope")
    if action.action_type not in scope.allowed_action_types:
        reasons.append("action_type_out_of_scope")
    if scope.valid_from and evaluated_at < scope.valid_from:
        reasons.append("scope_not_yet_valid")
    if scope.valid_until and evaluated_at >= scope.valid_until:
        reasons.append("scope_expired")
    if _RISK_ORDER[action.risk_level] > _RISK_ORDER[scope.maximum_risk_level]:
        reasons.append("risk_exceeds_scope")
    if action.is_write and not action.rollback_steps:
        reasons.append("write_missing_rollback")
    reasons.extend(_load_test_violations(action, scope))

    constraints = _scope_constraints(scope)
    if reasons:
        return PolicyDecision(
            effect=PolicyEffect.DENY,
            risk_level=action.risk_level,
            reason_codes=reasons,
            constraints=constraints,
            decided_at=evaluated_at,
        )

    requires_approval = (
        _RISK_ORDER[action.risk_level] >= _RISK_ORDER[RiskLevel.L2]
        or (environment == TargetEnvironment.PRODUCTION and action.is_write)
    )
    return PolicyDecision(
        effect=PolicyEffect.REQUIRE_APPROVAL if requires_approval else PolicyEffect.ALLOW,
        risk_level=action.risk_level,
        reason_codes=["approval_required"] if requires_approval else ["scope_and_policy_satisfied"],
        constraints=constraints,
        approval_ttl_seconds=300 if requires_approval else None,
        decided_at=evaluated_at,
    )


def _load_test_violations(action: ProposedAction, scope: AuthorizationScope) -> list[str]:
    if not action.is_load_test:
        return []
    checks = (
        ("load_test_rps_exceeded", action.requested_rps, scope.max_load_test_rps),
        ("load_test_concurrency_exceeded", action.requested_concurrency, scope.max_load_test_concurrency),
        (
            "load_test_duration_exceeded",
            action.requested_duration_seconds,
            scope.max_load_test_duration_seconds,
        ),
    )
    violations: list[str] = []
    for reason, requested, maximum in checks:
        if requested is None or maximum is None or requested > maximum:
            violations.append(reason)
    return violations


def _scope_constraints(scope: AuthorizationScope) -> dict[str, int | str | None]:
    return {
        "maximum_risk_level": scope.maximum_risk_level.value,
        "max_load_test_rps": scope.max_load_test_rps,
        "max_load_test_concurrency": scope.max_load_test_concurrency,
        "max_load_test_duration_seconds": scope.max_load_test_duration_seconds,
    }

