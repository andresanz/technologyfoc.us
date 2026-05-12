# Michele Laptop — daily backup to S3
# Sources: C:\Users, C:\Google Drive
# Destinations: Amazon-S3:/sanz/MicheleLaptop/Backups/<timestamp>/
# Schedule: Task Scheduler, daily 2am

$RcloneExe      = "$env:USERPROFILE\rclone\rclone.exe"
$BucketPath     = "Amazon-S3:/sanz/MicheleLaptop"
$Date           = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogDir         = "$env:USERPROFILE\Scripts\Logs"
$LogFile        = "$LogDir\backup-$Date.log"
$Dest           = "$BucketPath/Backups/$Date"
$TelegramToken  = $env:TELEGRAM_BOT_TOKEN
$TelegramChat   = $env:TELEGRAM_CHAT_ID

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Send-Telegram($msg) {
    if (-not $TelegramToken -or -not $TelegramChat) { return }
    try {
        $body = @{ chat_id = $TelegramChat; text = $msg; parse_mode = "HTML" } | ConvertTo-Json
        Invoke-RestMethod -Uri "https://api.telegram.org/bot$TelegramToken/sendMessage" `
            -Method Post -Body $body -ContentType "application/json" | Out-Null
    } catch {}
}

function Run-Rclone($src, $destSuffix, $extraExcludes = @()) {
    $target = "$Dest/$destSuffix"
    $baseExcludes = @(
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
    $allExcludes = $baseExcludes + $extraExcludes
    & $RcloneExe copy $src $target @allExcludes `
        --ignore-errors `
        --log-file $LogFile `
        --log-level INFO
    return $LASTEXITCODE
}

$startTime = Get-Date
Send-Telegram "🔄 <b>Michele backup starting</b> ($Date)"

$errors = 0

# -- C:\Users --
Write-Host "Backing up C:\Users..."
$rc = Run-Rclone "C:\Users" "Users"
if ($rc -ne 0) {
    Write-Host "WARNING: C:\Users backup exited with code $rc"
    $errors++
}

# -- C:\Google Drive --
if (Test-Path "C:\Google Drive") {
    Write-Host "Backing up C:\Google Drive..."
    $rc = Run-Rclone "C:\Google Drive" "GoogleDrive"
    if ($rc -ne 0) {
        Write-Host "WARNING: C:\Google Drive backup exited with code $rc"
        $errors++
    }
} else {
    Write-Host "C:\Google Drive not found, skipping."
    Add-Content $LogFile "$(Get-Date -Format 'u') WARN: C:\Google Drive not found, skipping."
}

# -- Timestamp marker --
Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ" | Set-Content "$env:USERPROFILE\.backup_home.timestamp"

$duration = [math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)

if ($errors -eq 0) {
    Send-Telegram "✅ <b>Michele backup complete</b>`n${duration}m · $Date"
    Write-Host "Backup complete in ${duration}m. Log: $LogFile"
} else {
    Send-Telegram "⚠️ <b>Michele backup finished with $errors error(s)</b>`n${duration}m · $Date`nSee log for details."
    Write-Host "Backup finished with $errors error(s). Log: $LogFile"
}
