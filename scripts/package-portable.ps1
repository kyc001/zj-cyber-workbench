param(
    [switch]$Clean,
    [switch]$SkipDependencies,
    [switch]$IncludePortableTools,
    [string]$ToolProxy = "http://127.0.0.1:7897",
    [string]$PythonExecutable = ""
)

$arguments = @{
    Target = "portable"
    Clean = $Clean
    SkipDependencies = $SkipDependencies
    IncludePortableTools = $IncludePortableTools
    ToolProxy = $ToolProxy
    PythonExecutable = $PythonExecutable
}

& (Join-Path $PSScriptRoot "build-windows.ps1") @arguments
exit $LASTEXITCODE
