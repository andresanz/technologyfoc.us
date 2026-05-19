# ── restic backup — Michele's laptop → s3:sanz-backups/michele ───────────────
# Run via Windows Task Scheduler as SYSTEM or Michele's account
# Schedule: daily, e.g. 2:00 AM
#
# First-time setup (run once in PowerShell as admin):
#   restic -r s3:s3.amazonaws.com/sanz-backups/michele init
# ─────────────────────────────────────────────────────────────────────────────

# ── Credentials ───────────────────────────────────────────────────────────────
$env:AWS_ACCESS_KEY_ID     = "REPLACE_WITH_ACCESS_KEY"
$env:AWS_SECRET_ACCESS_KEY = "REPLACE_WITH_SECRET_KEY"
$env:RESTIC_REPOSITORY     = "s3:s3.amazonaws.com/sanz-backups/michele"
$env:RESTIC_PASSWORD       = "REPLACE_WITH_REPO_PASSWORD"

# ── Paths to back up ──────────────────────────────────────────────────────────
$BackupPaths = @(
    "C:\Google Drive",
    "C:\Users\Michele"
)

# ── Exclusions ────────────────────────────────────────────────────────────────
$Excludes = @(
    "C:\Users\Michele\AppData",
    "C:\Users\Michele\OneDrive",
    "*.tmp",
    "*.temp",
    "~$*"
)

# ── Log file ──────────────────────────────────────────────────────────────────
$LogFile = "C:\restic-logs\backup-michele.log"
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $LogFile "`n=== Backup started: $Timestamp ==="

# ── Run backup ────────────────────────────────────────────────────────────────
$ExcludeArgs = $Excludes | ForEach-Object { "--exclude=$_" }

restic backup $BackupPaths $ExcludeArgs --verbose 2>&1 | Tee-Object -Append -FilePath $LogFile

# ── Prune old snapshots ───────────────────────────────────────────────────────
# Keep: 7 daily, 4 weekly, 6 monthly
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune 2>&1 |
    Tee-Object -Append -FilePath $LogFile

# ── Check repo health (weekly — only on Sundays) ──────────────────────────────
if ((Get-Date).DayOfWeek -eq "Sunday") {
    restic check 2>&1 | Tee-Object -Append -FilePath $LogFile
}

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $LogFile "=== Backup finished: $Timestamp ==="
