param(
    [string]$SkillsDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $SkillsDir) {
    $SkillsDir = Join-Path $repoRoot "skills"
}
$root = (Resolve-Path -LiteralPath $SkillsDir).Path
$skillFiles = Get-ChildItem -LiteralPath $root -Directory | ForEach-Object {
    Get-Item -LiteralPath (Join-Path $_.FullName "SKILL.md") -ErrorAction SilentlyContinue
} | Where-Object { $_ }

if (-not $skillFiles) {
    throw "No SKILL.md files found under $root"
}

foreach ($skillFile in $skillFiles) {
    $skillName = $skillFile.Directory.Name
    $lines = Get-Content -LiteralPath $skillFile.FullName -Encoding UTF8
    if ($lines.Count -lt 4 -or $lines[0] -ne "---") {
        throw "$($skillFile.FullName): missing YAML front matter"
    }
    $end = [Array]::IndexOf($lines, "---", 1)
    if ($end -lt 2) {
        throw "$($skillFile.FullName): unterminated YAML front matter"
    }
    $declaredName = ($lines[1..($end - 1)] | Where-Object { $_ -match '^name:\s*(.+)$' } | ForEach-Object { $Matches[1].Trim() } | Select-Object -First 1)
    $description = ($lines[1..($end - 1)] | Where-Object { $_ -match '^description:\s*(.+)$' } | ForEach-Object { $Matches[1].Trim() } | Select-Object -First 1)
    if ($declaredName -ne $skillName) {
        throw "$($skillFile.FullName): name '$declaredName' does not match directory '$skillName'"
    }
    if (-not $description -or $description.Length -gt 320) {
        throw "$($skillFile.FullName): invalid description"
    }
    $h1 = ($lines | Where-Object { $_ -match '^#\s+(.+)$' } | ForEach-Object { $Matches[1].Trim() } | Select-Object -First 1)
    if ($h1 -ne $skillName) {
        throw "$($skillFile.FullName): H1 '$h1' does not match skill name '$skillName'"
    }
}

Write-Output "Portable skill validation passed: $($skillFiles.Count) skills"
