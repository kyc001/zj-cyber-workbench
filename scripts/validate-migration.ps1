param(
    [switch]$IncludePortableTools
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $repoRoot

function Invoke-Python {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PythonArgs)
    $venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        & $venvPython @PythonArgs
    } else {
        & uv run python @PythonArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Python command failed: $($PythonArgs -join ' ')"
    }
}

Invoke-Python -m pytest -q
Invoke-Python scripts/export_schema.py
& pnpm --filter @zj-security/web generate:api
if ($LASTEXITCODE -ne 0) { throw "OpenAPI TypeScript generation failed" }
& pnpm typecheck
if ($LASTEXITCODE -ne 0) { throw "TypeScript typecheck failed" }
& pnpm build
if ($LASTEXITCODE -ne 0) { throw "Web/Desktop build failed" }
Invoke-Python -m ruff check --select F .
& powershell -ExecutionPolicy Bypass -File scripts/audit-upstream-migration.ps1
if ($LASTEXITCODE -ne 0) { throw "Upstream migration audit failed" }
& powershell -ExecutionPolicy Bypass -File scripts/validate-portable-skills.ps1
if ($LASTEXITCODE -ne 0) { throw "Portable skill validation failed" }

if ($IncludePortableTools) {
    & powershell -ExecutionPolicy Bypass -File scripts/validate-portable-tools.ps1
    if ($LASTEXITCODE -ne 0) { throw "Portable tool validation failed" }
    Invoke-Python scripts/validate_workspace_runtime.py --workspace-id 1
}

& git diff --check
if ($LASTEXITCODE -ne 0) { throw "Git whitespace validation failed" }
Write-Output "Complete migration validation passed"
