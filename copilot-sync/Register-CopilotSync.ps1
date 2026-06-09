<#
.SYNOPSIS
  Registers a weekly Windows Scheduled Task that pulls Copilot Money
  transactions into the BHM Finance OneDrive folder.

.DESCRIPTION
  Runs pull_copilot.py every Monday at 7:00 AM (and on demand via Task
  Scheduler). Adjust -OutputDir to your local OneDrive sync path for
  "BHM Finance\BHM - Investment Strategy".

.EXAMPLE
  .\Register-CopilotSync.ps1 -OutputDir "$env:OneDrive\Brook @ INEX\Claude\PROJECTS\BHM Finance\BHM - Investment Strategy"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [string]$TaskName = "Copilot Money Sync",

    [string]$At = "07:00",

    [ValidateSet("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")]
    [string]$DayOfWeek = "Monday"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutputDir)) {
    throw "Output dir not found: $OutputDir  (is OneDrive sync set up on this machine?)"
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = (Get-Command py -ErrorAction Stop).Source }

$script = Join-Path $PSScriptRoot "pull_copilot.py"
if (-not (Test-Path $script)) { throw "pull_copilot.py not found next to this script." }

$action = New-ScheduledTaskAction -Execute $python `
    -Argument "`"$script`" --output-dir `"$OutputDir`"" `
    -WorkingDirectory $PSScriptRoot

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DayOfWeek -At $At

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Description "Pulls Copilot Money transactions to OneDrive (BHM Finance)" -Force

Write-Host "Registered task '$TaskName' — $DayOfWeek at $At." -ForegroundColor Green
Write-Host "Test it now with:  Start-ScheduledTask -TaskName '$TaskName'"
