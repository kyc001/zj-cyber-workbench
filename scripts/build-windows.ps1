param(
    [ValidateSet("all", "installer", "portable")]
    [string]$Target = "all",
    [ValidateSet("x64")]
    [string]$Architecture = "x64",
    [string]$PythonExecutable = "",
    [switch]$Clean,
    [switch]$SkipDependencies,
    [switch]$IncludePortableTools,
    [string]$ToolProxy = "http://127.0.0.1:7897"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $RepoRoot

$BuildVenvDir = Join-Path $RepoRoot ".build-venv"

function Invoke-NativeStep {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [scriptblock]$Operation
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Operation
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Resolve-BuildPython {
    param([string]$Configured)

    $candidates = @()
    if ($Configured) {
        $candidates += [pscustomobject]@{ Command = $Configured; Prefix = @() }
    }
    if ($env:ZJ_BUILD_PYTHON) {
        $candidates += [pscustomobject]@{ Command = $env:ZJ_BUILD_PYTHON; Prefix = @() }
    }
    $venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        $candidates += [pscustomobject]@{ Command = $venvPython; Prefix = @() }
    }
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $candidates += [pscustomobject]@{ Command = $pythonCommand.Source; Prefix = @() }
    }
    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $candidates += [pscustomobject]@{ Command = $pyLauncher.Source; Prefix = @("-3.12") }
    }

    foreach ($candidate in $candidates) {
        try {
            $version = & $candidate.Command @($candidate.Prefix) -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
            if ($LASTEXITCODE -eq 0 -and $version.Trim() -eq "3.12") {
                return $candidate
            }
        }
        catch {
            continue
        }
    }
    throw "Python 3.12 was not found. Set ZJ_BUILD_PYTHON or pass -PythonExecutable <path>."
}

function Remove-WorkspacePath {
    param([Parameter(Mandatory)][string]$RelativePath)

    $workspacePrefix = $RepoRoot.TrimEnd('\') + '\'
    $target = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $RelativePath))
    if (-not $target.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean path outside workspace: $target"
    }
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "Windows packaging must run on Windows."
}

$Pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $Pnpm) {
    throw "pnpm was not found. Install Node.js and run: corepack enable"
}
$BuildPython = Resolve-BuildPython $PythonExecutable
Write-Host "Repository: $RepoRoot"
Write-Host "Python: $($BuildPython.Command) $($BuildPython.Prefix -join ' ')"
Write-Host "Target: $Target / $Architecture"

if ($Clean) {
    Write-Host "Cleaning previous Windows artifacts..." -ForegroundColor Yellow
    foreach ($relativePath in @("build", "dist", "desktop\release", ".build-venv")) {
        Remove-WorkspacePath $relativePath
    }
}

if (-not $SkipDependencies) {
    # --- Create a clean build virtual environment ---
    # A dedicated venv ensures only requirements.txt packages are present,
    # avoiding conflicts with conda packages or other system-installed libs.
    if (-not (Test-Path -LiteralPath $BuildVenvDir -PathType Container)) {
        Write-Host "Creating build virtual environment..." -ForegroundColor Cyan
        & $BuildPython.Command @($BuildPython.Prefix) -m venv $BuildVenvDir
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create build virtual environment at $BuildVenvDir."
        }
    }
    else {
        Write-Host "Build virtual environment already exists: $BuildVenvDir" -ForegroundColor Cyan
    }

    $VenvPython = Join-Path $BuildVenvDir "Scripts\python.exe"

    # When the base Python is Anaconda, PyInstaller sees `is_conda=True` but
    # `is_pure_conda=False` (venv lacks conda-meta) and emits a noisy warning.
    # An empty conda-meta directory tells PyInstaller "this is a conda-derived
    # venv" and silences it. On non-conda Pythons this has no effect because
    # PyInstaller's `is_conda` is already False.
    $BuildPythonPrefix = & $VenvPython -c "import sys; print(sys.base_prefix)"
    if (Test-Path -LiteralPath (Join-Path $BuildPythonPrefix "conda-meta") -PathType Container) {
        $null = New-Item -Path (Join-Path $BuildVenvDir "conda-meta") -ItemType Directory -Force
    }

    # Ensure pip is up-to-date inside the venv
    Invoke-NativeStep "Update pip in build venv" {
        & $VenvPython -m pip install --disable-pip-version-check --upgrade pip
    }

    Invoke-NativeStep "Install Python build dependencies in venv" {
        & $VenvPython -m pip install --disable-pip-version-check -r requirements-dev.txt
    }

    Invoke-NativeStep "Install Node.js dependencies" {
        & $Pnpm install --frozen-lockfile
    }
}
else {
    $VenvPython = Join-Path $BuildVenvDir "Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) {
        throw "Build venv not found at $BuildVenvDir. Run without -SkipDependencies first."
    }
}

$PortableToolsDir = Join-Path $RepoRoot "build\windows-tools"
if ($IncludePortableTools) {
    $installerArguments = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $PSScriptRoot "install-portable-tools.ps1"),
        "-Destination", $PortableToolsDir,
        "-Proxy", $ToolProxy
    )
    Invoke-NativeStep "Download portable security tools" {
        & powershell.exe @installerArguments
    }
    Invoke-NativeStep "Validate portable security tools" {
        & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
            -File (Join-Path $PSScriptRoot "validate-portable-tools.ps1") `
            -ToolsRoot $PortableToolsDir
    }
}
$env:ZJ_PORTABLE_TOOLS_DIR = $PortableToolsDir

Invoke-NativeStep "Build React renderer" {
    & $Pnpm --filter "@zj-security/web" build
}

Invoke-NativeStep "Build Python sidecar" {
    & $VenvPython -m PyInstaller --noconfirm --clean packaging/zj-core.spec
}
if (-not (Test-Path -LiteralPath "dist\zj-core\zj-core.exe" -PathType Leaf)) {
    throw "PyInstaller completed without producing dist\zj-core\zj-core.exe."
}

Invoke-NativeStep "Build Electron main process" {
    & $Pnpm --filter "@zj-security/desktop" build
}

if (-not $env:CSC_LINK) {
    $env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
}
$targets = switch ($Target) {
    "installer" { @("nsis") }
    "portable" { @("portable") }
    default { @("nsis", "portable") }
}
$builderArguments = @(
    "--filter", "@zj-security/desktop", "exec", "electron-builder",
    "--win"
) + $targets + @("--$Architecture")
Invoke-NativeStep "Package Electron desktop application" {
    & $Pnpm @builderArguments
}

$releaseDir = Join-Path $RepoRoot "desktop\release"
$expectedPatterns = switch ($Target) {
    "installer" { @("*-setup.exe") }
    "portable" { @("*-portable.exe") }
    default { @("*-setup.exe", "*-portable.exe") }
}
$artifacts = foreach ($pattern in $expectedPatterns) {
    $matches = @(Get-ChildItem -LiteralPath $releaseDir -Filter $pattern -File -ErrorAction SilentlyContinue)
    if (-not $matches) {
        throw "Missing expected Windows artifact: $pattern"
    }
    $matches
}
$artifacts = @($artifacts | Sort-Object FullName -Unique)

$checksums = foreach ($artifact in $artifacts) {
    $hash = Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256
    "$($hash.Hash.ToLowerInvariant())  $($artifact.Name)"
}
$checksumPath = Join-Path $releaseDir "SHA256SUMS.txt"
$checksums | Set-Content -LiteralPath $checksumPath -Encoding ascii

$package = Get-Content -Encoding utf8 -Raw -LiteralPath "desktop\package.json" | ConvertFrom-Json
$commit = (git rev-parse HEAD 2>$null)
$manifest = [ordered]@{
    product = "Zhenjun"
    version = $package.version
    architecture = $Architecture
    target = $Target
    built_at = (Get-Date).ToUniversalTime().ToString("o")
    git_commit = if ($LASTEXITCODE -eq 0) { $commit } else { $null }
    includes_portable_tools = [bool]$IncludePortableTools
    artifacts = @($artifacts | ForEach-Object { $_.Name })
}
$manifest | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $releaseDir "build-manifest.json") -Encoding utf8

Write-Host ""
Write-Host "Windows desktop build completed." -ForegroundColor Green
foreach ($artifact in $artifacts) {
    Write-Host "  $($artifact.FullName)"
}
Write-Host "  $checksumPath"
Write-Host ""
Write-Host "Runtime data will be stored per user in:" -ForegroundColor Green
Write-Host "  %LOCALAPPDATA%\Zhenjun\Data"
