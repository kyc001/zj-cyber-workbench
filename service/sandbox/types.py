from dataclasses import dataclass
from typing import Literal

from model.sandbox.containers import SandboxContainer


SandboxContainerProtocol = Literal["tcp", "udp"]


@dataclass(frozen=True)
class SandboxContainerRecord:
    container: SandboxContainer
    image_name: str
    supports_tor: bool
    control_proxy_port: int
    owner_username: str
    host_display_name: str
    host_ip_address: str
    host_account: str
    host_ssh_port: int
    host_execution_backend: Literal["local", "ssh"]
    egress_label: str = ""


@dataclass(frozen=True)
class SandboxContainerMutationResult:
    record: SandboxContainerRecord | None
    succeeded: bool
    message: str = ""
    not_found: bool = False


@dataclass(frozen=True)
class SandboxContainerCommandResult:
    output: str
    exit_code: int


@dataclass(frozen=True)
class SandboxContainerSelection:
    id: int
    generation: int


@dataclass(frozen=True)
class SandboxContainerToolBinding:
    id: int
    generation: int
