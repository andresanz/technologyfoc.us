# Michele Laptop — daily backup to S3
# Sources: C:\Users, C:\Google Drive
# Destinations: Amazon-S3:/sanz/MicheleLaptop/Backups/<timestamp>/
# Schedule: Task Scheduler, daily 2am
#
# Self-updating: downloads latest version from GitHub before running.
# On first install, save this file to C:\Users\sanzm\Scripts\backup.ps1

$ScriptUrl  = "https://raw.githubusercontent.com/andresanz/andresanz-sites/main/scripts/michele-backup.ps1"
$ScriptPath = $MyInvocation.MyCommand.Path

# -- Self-update --
if ($ScriptPath) {
    try {
        $latest = (Invoke-WebRequest -Uri $ScriptUrl -UseBasicParsing).Content
        $current = Get-Content $ScriptPath -Raw
        if ($latest -ne $current) {
            Write-Host "Script updated from GitHub. Restarting..."
            Set-Content $ScriptPath $latest -Encoding UTF8
            & powershell.exe -ExecutionPolicy Bypass -File $ScriptPath
            exit
        }
    } catch {
        Write-Host "Could not check for updates: $_"
    }
}

$RcloneExe = "$env:USERPROFILE\rclone\rclone.exe"
$BucketPath = "Amazon-S3:/sanz/MicheleLaptop"
$Date       = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogDir     = "$env:USERPROFILE\Scripts\Logs"
$LogFile    = "$LogDir\backup-$Date.log"
$Dest       = "$BucketPath/Backups/$Date"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Run-Rclone($src, $destSuffix) {
    $target = "$Dest/$destSuffix"
    $excludes = @(
        "--exclude", "AppData/Local/**",
        "--exclude", "AppData/LocalLow/**",
        "--exclude", "AppData/Roaming/Microsoft/Windows/**",
        "--exclude", "*.tmp",
        "--exclude", "*.temp",
        "--exclude", "Thumbs.db",
        "--exclude", "desktop.ini",
        "--exclude", "ntuser.*",
        "--exclude", "`$RECYCLE.BIN/**"
    )
    & $RcloneExe copy $src $target @excludes `
        --ignore-errors `
        --log-file $LogFile `
        --log-level INFO
    return $LASTEXITCODE
}

$errors = 0

Write-Host "Backing up C:\Users..."
$rc = Run-Rclone "C:\Users" "Users"
if ($rc -ne 0) { Write-Host "WARNING: C:\Users exited $rc"; $errors++ }

if (Test-Path "C:\Google Drive") {
    Write-Host "Backing up C:\Google Drive..."
    $rc = Run-Rclone "C:\Google Drive" "GoogleDrive"
    if ($rc -ne 0) { Write-Host "WARNING: C:\Google Drive exited $rc"; $errors++ }
} else {
    Write-Host "C:\Google Drive not found, skipping."
    Add-Content $LogFile "$(Get-Date -Format 'u') WARN: C:\Google Drive not found, skipping."
}

Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ" | Set-Content "$env:USERPROFILE\.backup_home.timestamp"
Write-Host "Backup $(if ($errors -eq 0) { 'complete' } else { "finished with $errors error(s)" }). Log: $LogFile"
