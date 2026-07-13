param(
    [Parameter(Position = 0)]
[ValidateSet("doctor", "install", "backend", "web", "ui", "desktop", "test", "e2e", "package")]
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
    "backend" {
        $env:ZJ_BIND_HOST = "127.0.0.1"
        $env:ZJ_BIND_PORT = "8000"
        uv run python main.py
    }
    "web" {
        $env:VITE_DESKTOP_MODE = "true"
        pnpm --filter @zj-security/web dev
    }
    "ui" {
        # Fast browser UI loop: run the real backend from source and Vite with desktop auth enabled.
        # This path never builds PyInstaller or Electron and is the default development feedback loop.
        $previousBindHost = $env:ZJ_BIND_HOST
        $previousBindPort = $env:ZJ_BIND_PORT
        $previousViteDesktopMode = $env:VITE_DESKTOP_MODE
        $env:ZJ_BIND_HOST = "127.0.0.1"
        $env:ZJ_BIND_PORT = "8000"
        $env:VITE_DESKTOP_MODE = "true"
        $backend = Start-Process -FilePath "uv" -ArgumentList @("run", "python", "main.py") -WorkingDirectory $RepoRoot -PassThru -NoNewWindow
        try {
            pnpm --filter @zj-security/web dev
        } finally {
            if ($backend -and -not $backend.HasExited) {
                Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
            }
            $env:ZJ_BIND_HOST = $previousBindHost
            $env:ZJ_BIND_PORT = $previousBindPort
            $env:VITE_DESKTOP_MODE = $previousViteDesktopMode
        }
    }
    "desktop" {
        $env:ZJ_START_SIDECAR = "0"
        pnpm --filter @zj-security/desktop dev
    }
    "test" {
        uv run python -m unittest discover -s tests -p "test_*.py"
        pnpm typecheck
    }
    "e2e" {
        & "$PSScriptRoot\validate-migration.ps1"
    }
    "package" {
        & "$PSScriptRoot\package-portable.ps1"
    }
}
