from __future__ import annotations

from pathlib import Path

import asyncssh

from config import WORKSPACE
from model.host.hosts import ManagedHost


SSH_CONNECT_TIMEOUT_SECONDS = 10


def known_hosts_path() -> Path:
    path = WORKSPACE / "ssh" / "known_hosts"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=True)
    return path


async def connect_managed_host(host: ManagedHost) -> asyncssh.SSHClientConnection:
    return await asyncssh.connect(
        host.ip_address,
        port=host.ssh_port,
        username=host.host_account,
        password=host.host_password or None,
        known_hosts=str(known_hosts_path()),
        connect_timeout=SSH_CONNECT_TIMEOUT_SECONDS,
    )
