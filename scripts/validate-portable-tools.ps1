param(
    [string]$ToolsRoot = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ToolsRoot) {
    $ToolsRoot = Join-Path $repoRoot ".zj\tools"
}
$ToolsRoot = (Resolve-Path -LiteralPath $ToolsRoot).Path

function Assert-Command {
    param([string]$RelativePath, [string[]]$Arguments)
    $path = Join-Path $ToolsRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing portable tool: $RelativePath"
    }
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & $path @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) {
        throw "$RelativePath failed validation: $($output | Select-Object -First 3)"
    }
    Write-Output "${RelativePath}: ok"
}

Assert-Command "ffuf\ffuf.exe" @("-V")
Assert-Command "httpx\httpx.exe" @("-version")
Assert-Command "dnsx\dnsx.exe" @("-version")
Assert-Command "subfinder\subfinder.exe" @("-version")
Assert-Command "gobuster\gobuster.exe" @("--help")
Assert-Command "amass\amass.exe" @("-version")
Assert-Command "uv\uv.exe" @("--version")
Assert-Command "python\python.exe" @("--version")
Assert-Command "observer_ward\observer_ward.exe" @("--help")
Assert-Command "agent-browser-cli\agent-browser-cli.exe" @("--help")

$chrome = Get-ChildItem (Join-Path $ToolsRoot "chrome") -Recurse -Filter chrome.exe | Select-Object -First 1
if (-not $chrome -or -not $chrome.VersionInfo.ProductVersion) {
    throw "Chrome for Testing is missing or has no version metadata"
}
$manifest = Get-ChildItem (Join-Path $ToolsRoot "agent-browser-cli") -Recurse -Filter manifest.json | Select-Object -First 1
if (-not $manifest) {
    throw "agent-browser-cli Chrome extension is missing"
}

foreach ($tool in @("ffuf", "httpx", "dnsx", "subfinder", "gobuster", "amass", "uv", "observer_ward", "agent-browser-cli")) {
    $license = Get-ChildItem (Join-Path $ToolsRoot $tool) -File | Where-Object Name -Match "^(LICENSE|COPYING|NOTICE)" | Select-Object -First 1
    if (-not $license) {
        throw "Portable tool $tool is missing its license file"
    }
}

Write-Output "chrome: $($chrome.VersionInfo.ProductVersion)"
Write-Output "Portable tool validation passed"
