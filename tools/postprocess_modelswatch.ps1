Param(
  [switch]$UseLLM,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $root "..")
Set-Location $repo

$python = "python"
$script = "tools/modelswatch_tagging.py"

$cmd = @($python, $script)
if ($UseLLM) { $cmd += "--use-llm" }
if ($DryRun) { $cmd += "--dry-run" }

Write-Host "Running: $($cmd -join ' ')" -ForegroundColor Cyan
& $python $script @($cmd | Select-Object -Skip 2)

if ($LASTEXITCODE -ne 0) {
  Write-Error "Tagging failed with exit code $LASTEXITCODE"
  exit $LASTEXITCODE
}

Write-Host "Tagging completed." -ForegroundColor Green
