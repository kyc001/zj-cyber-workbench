from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

ROOT_PATH = Path(__file__).resolve().parents[1]
if str(ROOT_PATH) not in sys.path:
    sys.path.insert(0, str(ROOT_PATH))

import database
from config import load_config
from service.sandbox.commands import execute_sandbox_container_command


CHECKS = (
    ("python --version", "Python 3.12.10"),
    ("uv --version", "uv 0.11.28"),
    ("ffuf -V", "ffuf version"),
    ("httpx -version", "Current Version"),
    ("dnsx -version", "Current Version"),
    ("subfinder -version", "Current Version"),
    ("gobuster --help", "USAGE:"),
    ("amass -version", "v5.1.1"),
    ("observer_ward --help", "observer_ward"),
    ("agent-browser-cli --help", "Usage:"),
    (
        "(Get-Item ([Environment]::GetEnvironmentVariable('CHROME_BIN'))).VersionInfo.ProductVersion",
        "145.0.7632.117",
    ),
    (
        "Test-Path ([Environment]::GetEnvironmentVariable('ZJ_CHROME_EXTENSION_DIR'))",
        "True",
    ),
)


async def validate(container_id: int) -> None:
    for command, expected in CHECKS:
        result = await execute_sandbox_container_command(container_id, command, 30)
        output = result.output.strip()
        if result.exit_code != 0 or expected not in output:
            raise RuntimeError(
                f"workspace command failed: {command!r}, exit={result.exit_code}, output={output[:500]!r}"
            )
        print(f"ok: {command.split()[0]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate tools through the actual workspace command runtime")
    parser.add_argument("--workspace-id", type=int, default=1)
    args = parser.parse_args()
    load_config()
    database.init_engine()
    asyncio.run(validate(args.workspace_id))
    print("Workspace runtime validation passed")


if __name__ == "__main__":
    main()
