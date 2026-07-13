from enum import StrEnum


class OpsRuntimeNode(StrEnum):
    RESOLVE_PROJECT_SCOPE = "resolve_project_scope"
    CLASSIFY_REQUEST_RISK = "classify_request_risk"
    CREATE_INCIDENT = "create_incident"
    DELEGATE_DIAGNOSTICS = "delegate_diagnostics"
    COLLECT_EVIDENCE = "collect_evidence"
    PROPOSE_ACTIONS = "propose_actions"
    POLICY_CHECK = "policy_check"
    APPROVAL_GATE = "approval_gate"
    EXECUTE_ACTION = "execute_action"
    PERSIST_EVIDENCE = "persist_evidence"
    BUILD_CHANGESET = "build_changeset"
    VERIFY_CHANGESET = "verify_changeset"
    ROLLBACK_CHANGESET = "rollback_changeset"
    GENERATE_INCIDENT_SUMMARY = "generate_incident_summary"


OPS_RUNTIME_ORDER = tuple(OpsRuntimeNode)

