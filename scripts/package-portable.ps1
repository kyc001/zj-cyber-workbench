param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

if ($Clean) {
    $workspacePrefix = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
    foreach ($target in @("build", "dist", "desktop\release")) {
        $resolved = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $target))
        if (-not $resolved.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to clean path outside workspace: $resolved"
        }
        if (Test-Path -LiteralPath $resolved) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

pnpm --filter @zj-security/web build
if ($LASTEXITCODE -ne 0) {
    throw "Web build failed with exit code $LASTEXITCODE."
}

uv run pyinstaller --noconfirm --clean packaging/zj-core.spec
if ($LASTEXITCODE -ne 0) {
    throw "Sidecar build failed with exit code $LASTEXITCODE."
}

pnpm --filter @zj-security/desktop build
if ($LASTEXITCODE -ne 0) {
    throw "Desktop build failed with exit code $LASTEXITCODE."
}

pnpm --filter @zj-security/desktop exec electron-builder --win portable --x64
if ($LASTEXITCODE -ne 0) {
    throw "Portable packaging failed with exit code $LASTEXITCODE."
}

Write-Host "Portable artifacts are in desktop/release." -ForegroundColor Green
