param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

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
uv run pyinstaller --noconfirm --clean packaging/zj-core.spec
pnpm --filter @zj-security/desktop build
pnpm --filter @zj-security/desktop exec electron-builder --win portable --x64

Write-Host "Portable artifacts are in desktop/release." -ForegroundColor Green
