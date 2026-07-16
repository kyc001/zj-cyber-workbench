from schema.incident import IncidentStatus


class IncidentTransitionError(ValueError):
    pass


_ALLOWED_TRANSITIONS: dict[IncidentStatus, frozenset[IncidentStatus]] = {
    IncidentStatus.CREATED: frozenset({IncidentStatus.PLANNING, IncidentStatus.CANCELLED}),
    IncidentStatus.PLANNING: frozenset({IncidentStatus.DIAGNOSING, IncidentStatus.CANCELLED, IncidentStatus.FAILED}),
    IncidentStatus.DIAGNOSING: frozenset(
        {IncidentStatus.AWAITING_APPROVAL, IncidentStatus.VERIFYING, IncidentStatus.CANCELLED, IncidentStatus.FAILED}
    ),
    IncidentStatus.AWAITING_APPROVAL: frozenset(
        {IncidentStatus.EXECUTING, IncidentStatus.CANCELLED, IncidentStatus.FAILED}
    ),
    IncidentStatus.EXECUTING: frozenset(
        {
            IncidentStatus.VERIFYING,
            IncidentStatus.FAILED,
            IncidentStatus.CANCELLED,
            IncidentStatus.ROLLBACK_REQUIRED,
        }
    ),
    IncidentStatus.VERIFYING: frozenset(
        {IncidentStatus.COMPLETED, IncidentStatus.ROLLBACK_REQUIRED, IncidentStatus.FAILED}
    ),
    IncidentStatus.ROLLBACK_REQUIRED: frozenset({IncidentStatus.ROLLING_BACK}),
    IncidentStatus.ROLLING_BACK: frozenset({IncidentStatus.ROLLED_BACK, IncidentStatus.FAILED}),
    IncidentStatus.COMPLETED: frozenset(),
    IncidentStatus.FAILED: frozenset(),
    IncidentStatus.CANCELLED: frozenset(),
    IncidentStatus.ROLLED_BACK: frozenset(),
}


def require_incident_transition(
    current: IncidentStatus,
    target: IncidentStatus,
    *,
    final_conclusion: str = "",
) -> None:
    if target not in _ALLOWED_TRANSITIONS[current]:
        raise IncidentTransitionError(f"illegal incident transition: {current.value} -> {target.value}")
    if target == IncidentStatus.COMPLETED and not final_conclusion.strip():
        raise IncidentTransitionError("completed incidents require a final conclusion")

