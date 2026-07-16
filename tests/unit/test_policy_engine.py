import unittest
from uuid import uuid4

from core.policy_engine import evaluate_action
from schema.action import PolicyEffect, ProposedAction, RiskLevel
from schema.incident import AuthorizationScope, TargetEnvironment


class PolicyEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.target_id = uuid4()
        self.incident_id = uuid4()
        self.scope = AuthorizationScope(
            allowed_target_ids={self.target_id},
            allowed_action_types={"linux.service.status", "linux.service.restart", "web.load.test"},
            maximum_risk_level=RiskLevel.L3,
            max_load_test_rps=100,
            max_load_test_concurrency=10,
            max_load_test_duration_seconds=60,
        )

    def action(self, **overrides) -> ProposedAction:
        values = {
            "project_id": 1,
            "incident_id": self.incident_id,
            "target_id": self.target_id,
            "action_type": "linux.service.status",
            "risk_level": RiskLevel.L0,
            "reason": "Read service state",
        }
        values.update(overrides)
        return ProposedAction(**values)

    def test_read_only_in_scope_action_is_allowed(self) -> None:
        decision = evaluate_action(self.action(), self.scope, environment=TargetEnvironment.PRODUCTION)
        self.assertEqual(PolicyEffect.ALLOW, decision.effect)

    def test_out_of_scope_target_is_denied(self) -> None:
        decision = evaluate_action(
            self.action(target_id=uuid4()),
            self.scope,
            environment=TargetEnvironment.TEST,
        )
        self.assertEqual(PolicyEffect.DENY, decision.effect)
        self.assertIn("target_out_of_scope", decision.reason_codes)

    def test_reversible_write_requires_approval(self) -> None:
        action = self.action(
            action_type="linux.service.restart",
            risk_level=RiskLevel.L2,
            is_write=True,
            rollback_steps=["linux.service.restart"],
        )
        decision = evaluate_action(action, self.scope, environment=TargetEnvironment.PRODUCTION)
        self.assertEqual(PolicyEffect.REQUIRE_APPROVAL, decision.effect)

    def test_load_test_limit_is_hard_denial(self) -> None:
        action = self.action(
            action_type="web.load.test",
            risk_level=RiskLevel.L3,
            is_load_test=True,
            requested_rps=101,
            requested_concurrency=10,
            requested_duration_seconds=60,
        )
        decision = evaluate_action(action, self.scope, environment=TargetEnvironment.TEST)
        self.assertEqual(PolicyEffect.DENY, decision.effect)
        self.assertIn("load_test_rps_exceeded", decision.reason_codes)


if __name__ == "__main__":
    unittest.main()

