from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from schema.action import RiskLevel
from schema.local_actions import LocalPowerShellActionSchema, QueryLocalPowerShellActionsResponse
from schema.toolpack import ExecutionErrorCode, ExecutionResult


@dataclass(frozen=True)
class _PowerShellAction:
    id: str
    name: str
    description: str
    command: str
    risk_level: RiskLevel = RiskLevel.L0


_ACTIONS: dict[str, _PowerShellAction] = {
    "system.summary": _PowerShellAction(
        id="system.summary",
        name="System summary",
        description="Collect OS, CPU, memory, and disk summary.",
        command=(
            "Get-ComputerInfo | Select-Object OsName,OsVersion,CsName,CsProcessors,CsTotalPhysicalMemory; "
            "Get-Volume | Select-Object DriveLetter,FileSystemLabel,Size,SizeRemaining"
        ),
    ),
    "process.list": _PowerShellAction(
        id="process.list",
        name="Process list",
        description="List local processes without command-line secrets.",
        command="Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Depth 2",
    ),
    "service.list": _PowerShellAction(
        id="service.list",
        name="Service list",
        description="List Windows services and status.",
        command="Get-Service | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Depth 2",
    ),
    "network.ports": _PowerShellAction(
        id="network.ports",
        name="Network ports",
        description="List TCP listeners and connections.",
        command=(
            "Get-NetTCPConnection | "
            "Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State | "
            "ConvertTo-Json -Depth 2"
        ),
    ),
    "firewall.status": _PowerShellAction(
        id="firewall.status",
        name="Firewall status",
        description="Read Windows Firewall profile status.",
        command=(
            "Get-NetFirewallProfile | "
            "Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction | "
            "ConvertTo-Json -Depth 2"
        ),
    ),
    "scheduled_tasks.list": _PowerShellAction(
        id="scheduled_tasks.list",
        name="Scheduled tasks",
        description="List scheduled tasks and states.",
        command="Get-ScheduledTask | Select-Object TaskName,TaskPath,State | ConvertTo-Json -Depth 2",
    ),
}


def list_local_powershell_actions() -> QueryLocalPowerShellActionsResponse:
    enabled = os.name == "nt"
    return QueryLocalPowerShellActionsResponse(
        actions=[
            LocalPowerShellActionSchema(
                id=action.id,
                name=action.name,
                description=action.description,
                risk_level=action.risk_level,
                read_only=True,
                enabled=enabled,
            )
            for action in _ACTIONS.values()
        ]
    )


async def run_local_powershell_action(action_id: str, *, timeout_seconds: int) -> ExecutionResult:
    run_id = uuid4().hex
    started_at = datetime.now()
    action = _ACTIONS.get(action_id)
    if action is None:
        raise FileNotFoundError("PowerShell action not found")
    if os.name != "nt":
        return _error_result(
            run_id,
            started_at,
            ExecutionErrorCode.PLATFORM_UNSUPPORTED,
            "PowerShell diagnostics require Windows.",
        )
    try:
        process = await asyncio.create_subprocess_exec(
            "powershell.exe",
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            action.command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds)
    except TimeoutError:
        process.kill()
        await process.wait()
        return _error_result(run_id, started_at, ExecutionErrorCode.TIMEOUT, "PowerShell action timed out.")
    output = (stdout or b"").decode(errors="replace")
    finished_at = datetime.now()
    ok = process.returncode == 0
    return ExecutionResult(
        ok=ok,
        execution_id=run_id,
        summary="PowerShell action completed" if ok else "PowerShell action failed",
        structured={"action_id": action.id, "stdout": output},
        exit_code=process.returncode,
        started_at=started_at,
        finished_at=finished_at,
        truncated=False,
        error_code=None if ok else ExecutionErrorCode.PROCESS_FAILED,
    )


def _error_result(
    run_id: str,
    started_at: datetime,
    error_code: ExecutionErrorCode,
    summary: str,
) -> ExecutionResult:
    return ExecutionResult(
        ok=False,
        execution_id=run_id,
        summary=summary,
        structured={},
        started_at=started_at,
        finished_at=datetime.now(),
        error_code=error_code,
    )
