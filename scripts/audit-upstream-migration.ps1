param(
    [string]$Upstream = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $Upstream) {
    $Upstream = Join-Path $repoRoot "Z3r0"
}
$upstreamRoot = (Resolve-Path -LiteralPath $Upstream).Path
$tracked = @(git -C $upstreamRoot ls-files)
if ($LASTEXITCODE -ne 0 -or -not $tracked) {
    throw "Unable to read the upstream Git file list from $upstreamRoot"
}

$rows = foreach ($path in $tracked) {
    $currentPath = Join-Path $repoRoot ($path -replace '/', '\')
    if (Test-Path -LiteralPath $currentPath) {
        [pscustomobject]@{ Path = $path; Status = "present"; Replacement = $path }
        continue
    }

    if ($path -match '^sandbox/\.agents/skills/(.+)$') {
        $replacement = "skills/$($Matches[1])"
        if (Test-Path -LiteralPath (Join-Path $repoRoot ($replacement -replace '/', '\'))) {
            [pscustomobject]@{ Path = $path; Status = "relocated"; Replacement = $replacement }
        } else {
            [pscustomobject]@{ Path = $path; Status = "unexpected_missing"; Replacement = $replacement }
        }
        continue
    }

    $replacement = switch -Regex ($path) {
        '^sandbox/\.agents/SKILL_TEMPLATE\.md$' { 'skills/SKILL_TEMPLATE.md'; break }
        '^sandbox/\.agents/validate-skills\.sh$' { 'scripts/validate-portable-skills.ps1'; break }
        default { '' }
    }
    if ($replacement) {
        $status = if (Test-Path -LiteralPath (Join-Path $repoRoot ($replacement -replace '/', '\'))) { "adapted" } else { "unexpected_missing" }
        [pscustomobject]@{ Path = $path; Status = $status; Replacement = $replacement }
        continue
    }

    $intentional = $path -match '^docs/' `
        -or $path -match '^sandbox/(?!\.agents/skills/)' `
        -or $path -match '(^|/)(Dockerfile|docker-compose\.(dev|prod)\.yml|\.dockerignore)$' `
        -or $path -match '^(assets/z3r0-logo\.png|CHANGELOG\.md|README_zh\.md|TERMINOLOGY\.md)$' `
        -or $path -match '^scripts/deploy-docs-pages\.sh$' `
        -or $path -match '^web/(landing|landing\.seo\.ts|package-lock\.json)' `
        -or $path -match '^web/src/(assets/z3r0-logo\.png|features/auth/|features/landing/|landing-)' `
        -or $path -eq 'web/src/shared/auth/session.ts' `
        -or $path -match '^web/(vite\.landing\.config\.ts)$' `
        -or $path -eq 'web/src/app/styles/login.css'
    [pscustomobject]@{
        Path = $path
        Status = if ($intentional) { "intentional_replacement" } else { "unexpected_missing" }
        Replacement = if ($intentional) { "portable/no-login/project-docs" } else { "" }
    }
}

$rows | Group-Object Status | Sort-Object Name | ForEach-Object {
    [pscustomobject]@{ Status = $_.Name; Count = $_.Count }
} | Format-Table -AutoSize

$unexpected = @($rows | Where-Object Status -eq "unexpected_missing")
if ($unexpected) {
    $unexpected | Format-Table -AutoSize
    throw "Upstream migration audit found $($unexpected.Count) unclassified missing files"
}

$upstreamOpenApiPath = Join-Path $upstreamRoot "web\openapi.json"
$currentOpenApiPath = Join-Path $repoRoot "web\openapi.json"
if (-not (Test-Path -LiteralPath $upstreamOpenApiPath) -or -not (Test-Path -LiteralPath $currentOpenApiPath)) {
    throw "OpenAPI files are required for upstream API parity auditing"
}
$upstreamApi = Get-Content -LiteralPath $upstreamOpenApiPath -Raw -Encoding utf8 | ConvertFrom-Json
$currentApi = Get-Content -LiteralPath $currentOpenApiPath -Raw -Encoding utf8 | ConvertFrom-Json
$upstreamPaths = @($upstreamApi.paths.PSObject.Properties.Name)
$currentPaths = @($currentApi.paths.PSObject.Properties.Name)
$allowedRemovedPaths = @("/api/system-users/login")
$missingPaths = @(Compare-Object $upstreamPaths $currentPaths | Where-Object {
    $_.SideIndicator -eq "<=" -and $_.InputObject -notin $allowedRemovedPaths
} | ForEach-Object { $_.InputObject })
if ($missingPaths) {
    throw "Upstream API paths are missing: $($missingPaths -join ', ')"
}

$httpMethods = @("get", "post", "put", "patch", "delete")
$missingOperations = @()
foreach ($path in $upstreamPaths) {
    if ($path -in $allowedRemovedPaths -or $path -notin $currentPaths) {
        continue
    }
    $upstreamMethods = @($upstreamApi.paths.PSObject.Properties[$path].Value.PSObject.Properties.Name | Where-Object {
        $_ -in $httpMethods
    })
    $currentMethods = @($currentApi.paths.PSObject.Properties[$path].Value.PSObject.Properties.Name | Where-Object {
        $_ -in $httpMethods
    })
    $missingOperations += @(Compare-Object $upstreamMethods $currentMethods | Where-Object {
        $_.SideIndicator -eq "<="
    } | ForEach-Object { "$($_.InputObject.ToUpper()) $path" })
}
if ($missingOperations) {
    throw "Upstream API operations are missing: $($missingOperations -join ', ')"
}

$requiredPortableReplacements = @(
    "service/host/connection.py",
    "service/sandbox/local_runtime.py",
    "service/sandbox/remote_runtime.py",
    "service/sandbox/remote_files.py",
    "scripts/install-portable-tools.ps1",
    "scripts/validate-portable-tools.ps1",
    "scripts/validate-portable-skills.ps1",
    "desktop/electron-builder.yml"
)
$missingReplacements = @($requiredPortableReplacements | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $repoRoot ($_ -replace '/', '\')))
})
if ($missingReplacements) {
    throw "Portable replacement files are missing: $($missingReplacements -join ', ')"
}

$upstreamSkillFiles = @($tracked | Where-Object { $_ -match '^sandbox/\.agents/skills/' } | ForEach-Object {
    $_ -replace '^sandbox/\.agents/skills/', ''
}) + @("SKILL_TEMPLATE.md")
$portableSkillFiles = @(Get-ChildItem (Join-Path $repoRoot "skills") -Recurse -File | ForEach-Object {
    $_.FullName.Substring((Join-Path $repoRoot "skills").Length + 1).Replace('\', '/')
})
$skillDiff = @(Compare-Object $upstreamSkillFiles $portableSkillFiles)
if ($skillDiff) {
    $skillDiff | Format-Table -AutoSize
    throw "Skill migration file set does not match the upstream baseline"
}

$runtimeFiles = @(
    Get-ChildItem (Join-Path $repoRoot "core"), (Join-Path $repoRoot "handler"), `
        (Join-Path $repoRoot "middleware"), (Join-Path $repoRoot "model"), `
        (Join-Path $repoRoot "router"), (Join-Path $repoRoot "schema"), `
        (Join-Path $repoRoot "service"), (Join-Path $repoRoot "desktop\src"), `
        (Join-Path $repoRoot "web\src") -Recurse -File -Include *.py,*.ts,*.tsx
)
$forbiddenRuntime = @($runtimeFiles | Select-String -Pattern '(^|\s)(from\s+docker|import\s+docker)|docker-py|/var/run/docker\.sock|postgresql\+|\basyncpg\b|\bpsycopg\b')
if ($forbiddenRuntime) {
    $forbiddenRuntime | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
    throw "Forbidden Docker/PostgreSQL runtime dependency detected"
}

if (Test-Path -LiteralPath (Join-Path $repoRoot "web\src\features\auth\LoginPage.tsx")) {
    throw "Login page must not exist in the portable desktop product"
}
$routerText = Get-Content -LiteralPath (Join-Path $repoRoot "router\system_user\users.py") -Raw -Encoding utf8
if ($routerText -match '["'']\/login["'']') {
    throw "Login API must not be registered"
}
$authenticationResidue = @($runtimeFiles | Select-String -Pattern 'X-ZJ-Access-Token|AccessTokenAuth|decode_access_token|ZJ_DESKTOP_MODE')
if ($authenticationResidue) {
    $authenticationResidue | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
    throw "Portable login/token authentication residue detected"
}
$specText = Get-Content -LiteralPath (Join-Path $repoRoot "packaging\zj-core.spec") -Raw -Encoding utf8
if ($specText -match '(?i)\.env|api.?key') {
    throw "Portable package spec must not include environment files or API keys"
}

$ignoredReference = git -C $repoRoot check-ignore -v "Z3r0/README.md"
if ($LASTEXITCODE -ne 0 -or $ignoredReference -notmatch '/Z3r0/') {
    throw "The original Z3r0 directory is not protected by the root ignore rule"
}

Write-Output "Upstream migration audit passed: $($rows.Count) tracked files classified"
Write-Output "Upstream API parity passed: $($upstreamPaths.Count) paths checked; login intentionally removed"
