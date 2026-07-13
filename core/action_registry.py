from dataclasses import dataclass

from schema.action import RiskLevel


@dataclass(frozen=True, slots=True)
class ActionSpec:
    action_type: str
    platforms: tuple[str, ...]
    risk_level: RiskLevel
    required_scope: tuple[str, ...]
    timeout_seconds: int
    max_output_bytes: int
    idempotent: bool
    requires_backup: bool = False
    requires_verification: bool = False
    requires_rollback: bool = False


class ActionRegistry:
    def __init__(self, specs: tuple[ActionSpec, ...] = ()) -> None:
        self._specs: dict[str, ActionSpec] = {}
        for spec in specs:
            self.register(spec)

    def register(self, spec: ActionSpec) -> None:
        if spec.action_type in self._specs:
            raise ValueError(f"duplicate action type: {spec.action_type}")
        self._specs[spec.action_type] = spec

    def require(self, action_type: str) -> ActionSpec:
        try:
            return self._specs[action_type]
        except KeyError as exc:
            raise KeyError(f"unknown action type: {action_type}") from exc

    def all(self) -> tuple[ActionSpec, ...]:
        return tuple(self._specs.values())

