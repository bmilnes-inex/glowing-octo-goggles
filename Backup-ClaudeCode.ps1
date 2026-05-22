<#
.SYNOPSIS
    Backs up Claude Code user data into a single zip you can move to another machine.

.DESCRIPTION
    Run this on your OLD laptop. It archives %USERPROFILE%\.claude\ (config,
    OAuth token, project chat history, agents, skills, keybindings) into a
    timestamped zip on your Desktop.

    To run:
      1. Right-click this file -> Run with PowerShell
         (or open PowerShell and run:  powershell -ExecutionPolicy Bypass -File .\Backup-ClaudeCode.ps1 )
      2. Copy the resulting zip to a USB stick / OneDrive / wherever.
      3. On the new laptop, run Restore-ClaudeCode.ps1 against that zip.
#>

[CmdletBinding()]
param(
    [string]$OutputDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

$claudeDir = Join-Path $env:USERPROFILE '.claude'

Write-Host ""
Write-Host "=== Claude Code backup ===" -ForegroundColor Cyan
Write-Host "Source: $claudeDir"

if (-not (Test-Path $claudeDir)) {
    Write-Host "ERROR: $claudeDir does not exist on this machine." -ForegroundColor Red
    Write-Host "Are you running this on the laptop where you USE Claude Code?"
    exit 1
}

# Summarise what we're backing up so the user sees something useful.
$sessionFiles = @()
$projectsDir = Join-Path $claudeDir 'projects'
if (Test-Path $projectsDir) {
    $sessionFiles = Get-ChildItem -Path $projectsDir -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue
}
$totalBytes = (Get-ChildItem -Path $claudeDir -Recurse -Force -ErrorAction SilentlyContinue |
               Measure-Object -Property Length -Sum).Sum
$totalMB = [math]::Round(($totalBytes / 1MB), 1)

Write-Host ("Sessions found : {0} chat transcripts" -f $sessionFiles.Count)
Write-Host ("Total size     : {0} MB" -f $totalMB)
Write-Host ""

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$zipPath   = Join-Path $OutputDir ("claude-backup-{0}.zip" -f $timestamp)

Write-Host "Creating archive: $zipPath" -ForegroundColor Cyan

# Compress-Archive doesn't include the parent folder name unless we point at the dir itself.
# We want the zip to contain a top-level '.claude' folder for an obvious restore.
$staging = Join-Path $env:TEMP ("claude-backup-stage-{0}" -f $timestamp)
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    # Use robocopy for speed and to handle long paths / locked files gracefully.
    $robocopyLog = Join-Path $env:TEMP ("claude-backup-robocopy-{0}.log" -f $timestamp)
    robocopy $claudeDir (Join-Path $staging '.claude') /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP > $robocopyLog
    # Robocopy exit codes < 8 are success (informational).
    if ($LASTEXITCODE -ge 8) {
        Write-Host "Robocopy reported errors. See $robocopyLog" -ForegroundColor Red
        exit 1
    }

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $staging '.claude') -DestinationPath $zipPath -CompressionLevel Optimal
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

$zipMB = [math]::Round(((Get-Item $zipPath).Length / 1MB), 1)
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ("Backup file : {0}" -f $zipPath)
Write-Host ("Backup size : {0} MB" -f $zipMB)
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Copy this zip to the new laptop (USB, OneDrive, network share, etc.)."
Write-Host "  2. On the new laptop, run Restore-ClaudeCode.ps1 and point it at the zip."
Write-Host ""
Write-Host "NOTE: this backup contains your OAuth token (~/.claude/.claude.json)." -ForegroundColor Yellow
Write-Host "      Treat it like a password. Don't email it or upload it to anywhere public."
