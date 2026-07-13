import unittest
from datetime import datetime, timedelta
from uuid import uuid4

from core.approval_gate import ApprovalTokenError, action_hash, issue_approval_token, verify_approval_token
from schema.action import ProposedAction, RiskLevel
from schema.approval import ApprovalClaims


class ApprovalGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.secret = b"a" * 32
        self.action = ProposedAction(
            project_id=1,
            incident_id=uuid4(),
            target_id=uuid4(),
            action_type="linux.service.restart",
            arguments={"service": "nginx"},
            risk_level=RiskLevel.L2,
            reason="Reload validated configuration",
            is_write=True,
            rollback_steps=["linux.service.restart"],
        )
        self.claims = ApprovalClaims(
            project_id=1,
            incident_id=self.action.incident_id,
            action_id=self.action.id,
            action_hash=action_hash(self.action),
            target_id=self.action.target_id,
            approver_id=7,
            expires_at=datetime.now() + timedelta(minutes=5),
        )

    def test_token_round_trip(self) -> None:
        token = issue_approval_token(self.claims, self.secret)
        verified = verify_approval_token(token, self.secret, action=self.action, approver_id=7)
        self.assertEqual(self.claims.approval_id, verified.approval_id)

    def test_action_change_invalidates_token(self) -> None:
        token = issue_approval_token(self.claims, self.secret)
        changed = self.action.model_copy(update={"arguments": {"service": "sshd"}})
        with self.assertRaises(ApprovalTokenError):
            verify_approval_token(token, self.secret, action=changed, approver_id=7)


if __name__ == "__main__":
    unittest.main()

