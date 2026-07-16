param(
    [int]$BackendPort = 18080,
    [int]$WebPort = 15173
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$TempRoot = [IO.Path]::GetFullPath([IO.Path]::Combine([IO.Path]::GetTempPath(), "zj-d-e2e-$([guid]::NewGuid().ToString('N'))"))
$Backend = $null
$Web = $null
$TestEnvironmentNames = @(
    "ZJ_DATA_DIR", "ZJ_BIND_HOST", "ZJ_BIND_PORT",
    "ZJ_OPENAI_BASE_URL", "ZJ_OPENAI_API_KEY", "ZJ_OPENAI_MODEL",
    "VITE_DESKTOP_MODE", "VITE_BACKEND_URL", "D_E2E_BASE_URL"
)
$OriginalEnvironment = @{}
foreach ($name in $TestEnvironmentNames) {
    $OriginalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Timed out waiting for $Url"
}

function Stop-TestProcess([Diagnostics.Process]$Process) {
    if ($null -ne $Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        $Process.WaitForExit(5000) | Out-Null
    }
}

Set-Location -LiteralPath $RepoRoot
New-Item -ItemType Directory -Path $TempRoot | Out-Null

try {
    $agents = [ordered]@{}
    foreach ($code in @("cso", "cae", "cce", "cie", "cpe", "cre")) {
        $agents[$code] = [ordered]@{
            code = $code
            name = "D E2E $($code.ToUpperInvariant())"
            description = "Deterministic D-group browser test agent"
            base_url = "mock://diagnostic_text"
            api_key = ""
            model = "zj-mock"
            use_responses = $false
            context_window = 1000000
        }
    }
    $config = [ordered]@{
        system = [ordered]@{
            listen_addr = "127.0.0.1"
            listen_port = $BackendPort
            encrypt_key = "d-e2e-only-encryption-key-00000000000000000000000000000000"
        }
        agents = $agents
    }
    $configJson = $config | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText(
        (Join-Path $TempRoot "config.json"),
        $configJson,
        [Text.UTF8Encoding]::new($false)
    )

    $env:ZJ_DATA_DIR = $TempRoot
    $env:ZJ_BIND_HOST = "127.0.0.1"
    $env:ZJ_BIND_PORT = "$BackendPort"
    $env:ZJ_OPENAI_BASE_URL = "mock://diagnostic_text"
    $env:ZJ_OPENAI_API_KEY = ""
    $env:ZJ_OPENAI_MODEL = "zj-mock"
    $env:VITE_DESKTOP_MODE = "true"
    $env:VITE_BACKEND_URL = "http://127.0.0.1:$BackendPort"
    $env:D_E2E_BASE_URL = "http://127.0.0.1:$WebPort"

    $Backend = Start-Process -FilePath "$RepoRoot/.venv/Scripts/python.exe" `
        -ArgumentList "main.py" `
        -WorkingDirectory $RepoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $TempRoot "backend.out.log") `
        -RedirectStandardError (Join-Path $TempRoot "backend.err.log") `
        -PassThru
    Wait-Http "http://127.0.0.1:$BackendPort/api/agents"

    $Web = Start-Process -FilePath "node" `
        -ArgumentList @(
            "$RepoRoot/web/node_modules/vite/bin/vite.js",
            "--config", "$RepoRoot/web/vite.app.config.ts",
            "--host", "127.0.0.1",
            "--port", "$WebPort",
            "--strictPort"
        ) `
        -WorkingDirectory "$RepoRoot/web" `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $TempRoot "web.out.log") `
        -RedirectStandardError (Join-Path $TempRoot "web.err.log") `
        -PassThru
    Wait-Http "http://127.0.0.1:$WebPort/playground"

    pnpm exec playwright test tests/e2e/d-playground.spec.ts --config playwright.config.ts
    if ($LASTEXITCODE -ne 0) { throw "D-group browser E2E failed" }
} finally {
    Stop-TestProcess $Web
    Stop-TestProcess $Backend
    foreach ($name in $TestEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($name, $OriginalEnvironment[$name], "Process")
    }

    $ResolvedTemp = [IO.Path]::GetFullPath($TempRoot)
    $SystemTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($ResolvedTemp.StartsWith($SystemTemp, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($ResolvedTemp).StartsWith("zj-d-e2e-", [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $ResolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}
