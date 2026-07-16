import unittest

from schema.incident import IncidentStatus
from service.incident_service import IncidentTransitionError, require_incident_transition


class IncidentTransitionTests(unittest.TestCase):
    def test_valid_transition(self) -> None:
        require_incident_transition(IncidentStatus.CREATED, IncidentStatus.PLANNING)

    def test_illegal_transition_is_rejected(self) -> None:
        with self.assertRaises(IncidentTransitionError):
            require_incident_transition(IncidentStatus.CREATED, IncidentStatus.COMPLETED)

    def test_completion_requires_conclusion(self) -> None:
        with self.assertRaises(IncidentTransitionError):
            require_incident_transition(IncidentStatus.VERIFYING, IncidentStatus.COMPLETED)
        require_incident_transition(
            IncidentStatus.VERIFYING,
            IncidentStatus.COMPLETED,
            final_conclusion="Service restored and independently verified.",
        )


if __name__ == "__main__":
    unittest.main()

