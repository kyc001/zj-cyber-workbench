"""Docker compatibility surface backed by the portable workspace runtime."""

from dataclasses import dataclass

from schema.sandbox.containers import SandboxContainerStatus


@dataclass(frozen=True)
class DockerContainerState:
    exists: bool
    status: str = "running"


def docker_status_to_sandbox_status(status: str) -> SandboxContainerStatus:
    return SandboxContainerStatus.RUNNING if status.lower() in {"running", "created"} else SandboxContainerStatus.STOPPED


def inspect_container_state_sync(host, container_hash: str) -> DockerContainerState:
    del host, container_hash
    return DockerContainerState(exists=True, status="running")


def create_container_sync(*args, **kwargs):
    del args, kwargs
    raise RuntimeError("Docker is disabled in portable mode")


def start_container_sync(*args, **kwargs):
    del args, kwargs


def stop_container_sync(*args, **kwargs):
    del args, kwargs


def pause_container_sync(*args, **kwargs):
    del args, kwargs


def resume_container_sync(*args, **kwargs):
    del args, kwargs


def remove_container_sync(*args, **kwargs):
    del args, kwargs
