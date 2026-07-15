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


DEFAULT_ACTION_REGISTRY = ActionRegistry((
    ActionSpec("host.local.diagnostic", ("windows",), RiskLevel.L0, ("local",), 30, 256_000, True),
    ActionSpec("ssh.command", ("linux",), RiskLevel.L1, ("ssh",), 120, 512_000, False),
    ActionSpec("ssh.shell", ("linux",), RiskLevel.L1, ("ssh",), 0, 512_000, False),
    ActionSpec("ssh.sftp.list", ("linux",), RiskLevel.L0, ("ssh", "file"), 30, 256_000, True),
    ActionSpec("ssh.sftp.upload", ("linux",), RiskLevel.L2, ("ssh", "file"), 60, 256_000, False, True, True, True),
    ActionSpec("ssh.sftp.download", ("linux",), RiskLevel.L1, ("ssh", "file"), 60, 256_000, True),
    ActionSpec("linux.service.status", ("linux",), RiskLevel.L0, ("ssh",), 30, 256_000, True),
    ActionSpec("linux.service.restart", ("linux",), RiskLevel.L2, ("ssh",), 120, 256_000, False, False, True, True),
    ActionSpec("linux.log.tail", ("linux",), RiskLevel.L0, ("ssh",), 30, 512_000, True),
    ActionSpec("linux.disk.summary", ("linux",), RiskLevel.L0, ("ssh",), 30, 256_000, True),
    ActionSpec("linux.network.connections", ("linux",), RiskLevel.L0, ("ssh",), 30, 256_000, True),
    ActionSpec("windows.service.status", ("windows",), RiskLevel.L0, ("powershell",), 30, 256_000, True),
    ActionSpec(
        "windows.service.restart",
        ("windows",),
        RiskLevel.L2,
        ("powershell",),
        120,
        256_000,
        False,
        False,
        True,
        True,
    ),
    ActionSpec("windows.eventlog.query", ("windows",), RiskLevel.L0, ("powershell",), 60, 512_000, True),
    ActionSpec("windows.file.backup", ("windows",), RiskLevel.L1, ("file",), 60, 256_000, True),
    ActionSpec("windows.file.replace", ("windows",), RiskLevel.L2, ("file",), 60, 256_000, False, True, True, True),
    ActionSpec("web.http.health", ("windows", "linux"), RiskLevel.L0, ("web",), 30, 256_000, True),
    ActionSpec("web.http.headers", ("windows", "linux"), RiskLevel.L1, ("web",), 30, 256_000, True),
    ActionSpec("web.tls.inspect", ("windows", "linux"), RiskLevel.L1, ("web",), 30, 256_000, True),
    ActionSpec("network.dns.lookup", ("windows", "linux"), RiskLevel.L1, ("web",), 30, 256_000, True),
    ActionSpec("network.ping", ("windows", "linux"), RiskLevel.L1, ("web",), 30, 256_000, True),
    ActionSpec("network.port.probe", ("windows", "linux"), RiskLevel.L1, ("web",), 60, 256_000, True),
    ActionSpec("web.port.probe", ("windows", "linux"), RiskLevel.L1, ("web",), 60, 256_000, True),
    ActionSpec("tool.ffuf.run", ("windows",), RiskLevel.L1, ("web", "tool"), 300, 512_000, False),
    ActionSpec("tool.httpx.run", ("windows",), RiskLevel.L1, ("web", "tool"), 120, 512_000, True),
    ActionSpec("tool.dnsx.run", ("windows",), RiskLevel.L1, ("web", "tool"), 120, 512_000, True),
    ActionSpec("tool.subfinder.run", ("windows",), RiskLevel.L1, ("web", "tool"), 180, 512_000, True),
    ActionSpec("tool.nmap.ssh", ("linux",), RiskLevel.L1, ("ssh", "tool"), 300, 512_000, False),
    ActionSpec("load.k6.run", ("windows", "linux"), RiskLevel.L2, ("web", "load"), 600, 512_000, False),
))
