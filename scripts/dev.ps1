param(
    [Parameter(Position = 0)]
    [ValidateSet("doctor", "install", "backend", "web", "desktop", "test", "e2e", "package")]
    [string]$Command = "doctor"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

function Find-Tool([string]$Name) {
    return Get-Command $Name -ErrorAction SilentlyContinue
}

function Show-Version([string]$Name, [scriptblock]$VersionCommand) {
    if (-not (Find-Tool $Name)) {
        Write-Host "[missing] $Name" -ForegroundColor Red
        return $false
    }
    $version = & $VersionCommand 2>&1 | Select-Object -First 1
    Write-Host "[ok] $Name $version" -ForegroundColor Green
    return $true
}

function Invoke-Doctor {
    $ok = $true
    $ok = (Show-Version "node" { node --version }) -and $ok
    $ok = (Show-Version "pnpm" { pnpm --version }) -and $ok
    $ok = (Show-Version "python" { python --version }) -and $ok
    $ok = (Show-Version "uv" { uv --version }) -and $ok
    $ok = (Show-Version "git" { git --version }) -and $ok

    Write-Host "[ok] Docker is not required or used" -ForegroundColor Green

    Write-Host "[ok] First start creates .zj/config.json automatically" -ForegroundColor Green
    if (-not $ok) { exit 1 }
}

switch ($Command) {
    "doctor" { Invoke-Doctor }
    "install" {
        uv sync
        pnpm install
    }
    "backend" { uv run python main.py }
    "web" { pnpm --filter @zj-security/web dev }
    "desktop" {
        $env:ZJ_START_SIDECAR = "0"
        pnpm --filter @zj-security/desktop dev
    }
    "test" {
        uv run python -m unittest discover -s tests -p "test_*.py"
        pnpm typecheck
    }
    "e2e" { throw "Electron E2E is owned by D and is not implemented in the Day 1 skeleton." }
    "package" {
        & "$PSScriptRoot\package-portable.ps1"
    }
}
