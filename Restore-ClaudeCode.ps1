<#
.SYNOPSIS
    Restores a Claude Code backup zip into %USERPROFILE%\.claude\ on this machine.

.DESCRIPTION
    Run this on your NEW laptop, after copying the zip produced by
    Backup-ClaudeCode.ps1.

    Usage:
      # Either drag the zip onto this script, or run from PowerShell:
      powershell -ExecutionPolicy Bypass -File .\Restore-ClaudeCode.ps1 -ZipPath "C:\path\to\claude-backup-YYYYMMDD-HHMMSS.zip"

    If you omit -ZipPath the script looks on the Desktop for the newest
    claude-backup-*.zip and uses that.

    If an existing %USERPROFILE%\.claude\ is found, it is renamed to
    .claude.bak-<timestamp> rather than deleted.
#>

[CmdletBinding()]
param(
    [string]$ZipPath
)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "=== Claude Code restore ===" -ForegroundColor Cyan

# 1. Resolve the zip.
if (-not $ZipPath) {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $candidate = Get-ChildItem -Path $desktop -Filter 'claude-backup-*.zip' -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending |
                 Select-Object -First 1
    if (-not $candidate) {
        Write-Host "ERROR: No -ZipPath given and no claude-backup-*.zip found on Desktop." -ForegroundColor Red
        Write-Host 'Run:  powershell -ExecutionPolicy Bypass -File .\Restore-ClaudeCode.ps1 -ZipPath "C:\path\to\backup.zip"'
        exit 1
    }
    $ZipPath = $candidate.FullName
    Write-Host ("Found backup on Desktop : {0}" -f $ZipPath)
}

if (-not (Test-Path $ZipPath)) {
    Write-Host "ERROR: Zip not found at $ZipPath" -ForegroundColor Red
    exit 1
}

$targetParent = $env:USERPROFILE
$targetDir    = Join-Path $targetParent '.claude'

# 2. Back up any existing .claude on the new machine.
if (Test-Path $targetDir) {
    $stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backup = Join-Path $targetParent (".claude.bak-{0}" -f $stamp)
    Write-Host ("Existing .claude found. Moving it aside to: {0}" -f $backup) -ForegroundColor Yellow
    Rename-Item -Path $targetDir -NewName (Split-Path $backup -Leaf)
}

# 3. Extract.
$staging = Join-Path $env:TEMP ("claude-restore-{0}" -f (Get-Date -Format 'yyyyMMddHHmmss'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    Write-Host "Extracting zip..."
    Expand-Archive -Path $ZipPath -DestinationPath $staging -Force

    $extractedClaude = Join-Path $staging '.claude'
    if (-not (Test-Path $extractedClaude)) {
        # Fallback: maybe the zip didn't include the parent folder; treat staging as the .claude payload.
        $extractedClaude = $staging
    }

    Write-Host ("Installing into : {0}" -f $targetDir)
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    robocopy $extractedClaude $targetDir /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Write-Host "Robocopy reported errors during restore." -ForegroundColor Red
        exit 1
    }
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

# 4. Report what landed.
$sessionFiles = @()
$projectsDir = Join-Path $targetDir 'projects'
if (Test-Path $projectsDir) {
    $sessionFiles = Get-ChildItem -Path $projectsDir -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue
}
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ("Restored to     : {0}" -f $targetDir)
Write-Host ("Sessions present: {0} chat transcripts" -f $sessionFiles.Count)
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Open a new PowerShell / terminal."
Write-Host "  2. Run:  claude   (or open the Claude Code app)"
Write-Host "  3. Inside a project directory, use /resume to see your old sessions."
Write-Host ""
Write-Host "If you are prompted to log in, run:  claude login" -ForegroundColor Yellow
Write-Host "(That only happens if the OAuth token in the backup is expired or missing.)"
