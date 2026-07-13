param(
    [string]$Proxy = "http://127.0.0.1:7897",
    [string]$Destination = "",
    [string]$PythonVersion = "3.12.10",
    [string]$ChromeVersion = "145.0.7632.117"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Destination) {
    $Destination = Join-Path $repoRoot ".zj\tools"
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$headers = @{ "User-Agent" = "zj-portable-tool-installer" }
$tools = @(
    @{ Name = "ffuf"; Repo = "ffuf/ffuf"; Pattern = "windows_amd64\.zip$" },
    @{ Name = "httpx"; Repo = "projectdiscovery/httpx"; Pattern = "windows_amd64\.zip$" },
    @{ Name = "dnsx"; Repo = "projectdiscovery/dnsx"; Pattern = "windows_amd64\.zip$" },
    @{ Name = "subfinder"; Repo = "projectdiscovery/subfinder"; Pattern = "windows_amd64\.zip$" },
    @{ Name = "gobuster"; Repo = "OJ/gobuster"; Pattern = "Windows_x86_64\.zip$" },
    @{ Name = "amass"; Repo = "owasp-amass/amass"; Pattern = "windows_amd64\.(zip|tar\.gz)$" },
    @{ Name = "uv"; Repo = "astral-sh/uv"; Pattern = "uv-x86_64-pc-windows-msvc\.zip$" },
    @{ Name = "observer_ward"; Repo = "emo-crab/observer_ward"; Pattern = "x86_64-pc-windows-(gnu|msvc)\.zip$"; BinaryPattern = "*windows*.exe" },
    @{ Name = "agent-browser-cli"; Repo = "sleepinginsummer/agent-browser-cli"; Pattern = "win32-x64-[0-9.]+\.tgz$" }
)

foreach ($tool in $tools) {
    $target = Join-Path $Destination $tool.Name
    $exe = Join-Path $target ($tool.Name + ".exe")
    if (Test-Path $exe) {
        Write-Output "$($tool.Name): already installed"
        continue
    }
    $release = Invoke-RestMethod -Proxy $Proxy -Headers $headers "https://api.github.com/repos/$($tool.Repo)/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -match $tool.Pattern } | Select-Object -First 1
    if (-not $asset) {
        Write-Warning "$($tool.Name): no matching Windows amd64 release asset"
        continue
    }
    $suffix = if ($asset.name.EndsWith(".tar.gz")) { ".tar.gz" } elseif ($asset.name.EndsWith(".tgz")) { ".tgz" } else { ".zip" }
    $archive = Join-Path $env:TEMP ("zj-" + $tool.Name + "-" + [guid]::NewGuid().ToString("N") + $suffix)
    try {
        Write-Output "$($tool.Name): downloading $($asset.name)"
        Invoke-WebRequest -UseBasicParsing -Proxy $Proxy -Headers $headers -Uri $asset.browser_download_url -OutFile $archive
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        if ($suffix -in @(".tar.gz", ".tgz")) {
            & tar.exe -xzf $archive -C $target
            if ($LASTEXITCODE -ne 0) { throw "tar extraction failed for $($tool.Name)" }
        }
        else {
            Expand-Archive -LiteralPath $archive -DestinationPath $target -Force
        }
        $binaryPattern = if ($tool.BinaryPattern) { $tool.BinaryPattern } else { $tool.Name + ".exe" }
        $nestedExe = Get-ChildItem -Path $target -Recurse -Filter $binaryPattern | Select-Object -First 1
        if ($nestedExe -and $nestedExe.FullName -ne $exe) {
            Copy-Item -LiteralPath $nestedExe.FullName -Destination $exe -Force
        }
        if (-not (Test-Path $exe)) {
            Write-Warning "$($tool.Name): archive did not contain $($tool.Name).exe"
            continue
        }
        Write-Output "$($tool.Name): installed $($release.tag_name)"
    }
    finally {
        Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    }
}

$pythonRoot = Join-Path $Destination "python"
$pythonExe = Join-Path $pythonRoot "python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonArchive = Join-Path $env:TEMP ("zj-python-" + [guid]::NewGuid().ToString("N") + ".zip")
    try {
        Write-Output "python: downloading embedded $PythonVersion"
        Invoke-WebRequest -UseBasicParsing -Proxy $Proxy -Headers $headers -Uri "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" -OutFile $pythonArchive
        New-Item -ItemType Directory -Force -Path $pythonRoot | Out-Null
        Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRoot -Force
    }
    finally {
        Remove-Item -LiteralPath $pythonArchive -Force -ErrorAction SilentlyContinue
    }
}

$browserRoot = Join-Path $Destination "agent-browser-cli"
$extensionRoot = Join-Path $browserRoot "chrome-extension"
if ((Test-Path (Join-Path $browserRoot "agent-browser-cli.exe")) -and -not (Test-Path (Join-Path $extensionRoot "manifest.json"))) {
    $release = Invoke-RestMethod -Proxy $Proxy -Headers $headers "https://api.github.com/repos/sleepinginsummer/agent-browser-cli/releases/latest"
    $extensionAsset = $release.assets | Where-Object name -eq "chrome-extensions.zip" | Select-Object -First 1
    if ($extensionAsset) {
        $extensionArchive = Join-Path $env:TEMP ("zj-agent-browser-extension-" + [guid]::NewGuid().ToString("N") + ".zip")
        $extensionUnpack = Join-Path $env:TEMP ("zj-agent-browser-extension-" + [guid]::NewGuid().ToString("N"))
        try {
            Write-Output "agent-browser-cli: downloading Chrome extension"
            Invoke-WebRequest -UseBasicParsing -Proxy $Proxy -Headers $headers -Uri $extensionAsset.browser_download_url -OutFile $extensionArchive
            Expand-Archive -LiteralPath $extensionArchive -DestinationPath $extensionUnpack -Force
            $manifest = Get-ChildItem -LiteralPath $extensionUnpack -Recurse -Filter manifest.json | Select-Object -First 1
            if ($manifest) {
                New-Item -ItemType Directory -Force -Path $extensionRoot | Out-Null
                Copy-Item -Path (Join-Path $manifest.Directory.FullName "*") -Destination $extensionRoot -Recurse -Force
            }
        }
        finally {
            Remove-Item -LiteralPath $extensionArchive -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $extensionUnpack -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

$chromeRoot = Join-Path $Destination "chrome"
$chromeExe = Get-ChildItem -LiteralPath $chromeRoot -Recurse -Filter chrome.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $chromeExe) {
    $chromeArchive = Join-Path $env:TEMP ("zj-chrome-" + [guid]::NewGuid().ToString("N") + ".zip")
    try {
        Write-Output "chrome: downloading Chrome for Testing $ChromeVersion"
        Invoke-WebRequest -UseBasicParsing -Proxy $Proxy -Headers $headers -Uri "https://storage.googleapis.com/chrome-for-testing-public/$ChromeVersion/win64/chrome-win64.zip" -OutFile $chromeArchive
        New-Item -ItemType Directory -Force -Path $chromeRoot | Out-Null
        Expand-Archive -LiteralPath $chromeArchive -DestinationPath $chromeRoot -Force
    }
    finally {
        Remove-Item -LiteralPath $chromeArchive -Force -ErrorAction SilentlyContinue
    }
}

Write-Warning "sqlmap: use an SSH Linux execution workspace; Windows Defender quarantines the upstream runtime"

$licenseDownloads = @(
    @{ Tool = "amass"; Name = "LICENSE"; Uri = "https://raw.githubusercontent.com/owasp-amass/amass/main/LICENSE" },
    @{ Tool = "uv"; Name = "LICENSE-APACHE"; Uri = "https://raw.githubusercontent.com/astral-sh/uv/main/LICENSE-APACHE" },
    @{ Tool = "uv"; Name = "LICENSE-MIT"; Uri = "https://raw.githubusercontent.com/astral-sh/uv/main/LICENSE-MIT" },
    @{ Tool = "agent-browser-cli"; Name = "LICENSE"; Uri = "https://raw.githubusercontent.com/sleepinginsummer/agent-browser-cli/main/LICENSE" }
)
foreach ($license in $licenseDownloads) {
    $toolRoot = Join-Path $Destination $license.Tool
    $licensePath = Join-Path $toolRoot $license.Name
    if ((Test-Path $toolRoot) -and -not (Test-Path $licensePath)) {
        Invoke-WebRequest -UseBasicParsing -Proxy $Proxy -Headers $headers -Uri $license.Uri -OutFile $licensePath
    }
}

Get-ChildItem -LiteralPath $Destination -Recurse -Filter debug.log -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Output "Portable tools root: $Destination"
