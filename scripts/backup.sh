#!/usr/bin/env bash
# Nightly backup → S3 with Telegram failure notification.
#
# Includes:
#   - admin/data/*.db + *.json
#   - sites/*/content/  +  sites/*/.env
#   - /var/www/technologyfoc.us/.env
#   - /etc/nginx/sites-available/  (all generated configs)
#   - /etc/sudoers.d/               (sudo grants)
#   - /etc/systemd/system/*.service (platform service units, filtered)
#   - /etc/letsencrypt/             (SSL certs)
#
# Excludes: node_modules, .git, *.log, SQLite shm/wal

set -uo pipefail

PLATFORM_ROOT="${PLATFORM_ROOT:-/var/www/technologyfoc.us}"
S3_BUCKET="${BACKUP_S3_BUCKET:-technologyfoc-us}"
S3_PREFIX="${BACKUP_S3_PREFIX:-backups/platform}"
STAGING="${BACKUP_STAGING:-/tmp/platform-backup}"

# Load AWS + Telegram env from platform .env (avoid sourcing entire file)
while IFS='=' read -r k v; do
  case "$k" in
    AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_REGION|AWS_DEFAULT_REGION|\
    TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)
      export "$k"="$v" ;;
  esac
done < <(grep -E '^(AWS_|TELEGRAM_)' "$PLATFORM_ROOT/.env" 2>/dev/null)
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-us-east-1}}"

telegram() {
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return
  [ -z "${TELEGRAM_CHAT_ID:-}" ]   && return
  curl -s -o /dev/null \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "text=$1" || true
}

ts=$(date +%Y%m%d-%H%M%S)
day=$(date +%Y-%m-%d)
out="$STAGING/$day.tar.gz"
mkdir -p "$STAGING"

trap 'rc=$?; if [ $rc -ne 0 ]; then telegram "❌ <b>Backup FAILED</b> on $(hostname) — see journalctl -u platform-backup"; fi' EXIT

cd "$PLATFORM_ROOT"

# Glob a curated list of system unit files (avoid pulling all of /etc/systemd)
sys_units=()
for u in andresanz andresanz-admin andresanz-deploy 914-io randomcategory-com gratitude-bot platform-backup; do
  f="/etc/systemd/system/${u}.service"
  [ -f "$f" ] && sys_units+=("$f")
done

tar --warning=no-file-changed --warning=no-file-removed \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='*-shm' \
    --exclude='*-wal' \
    --exclude='admin/views' \
    --exclude='admin/public' \
    --exclude='admin/scripts' \
    --exclude='core' \
    --exclude='scripts' \
    -czf "$out" \
    admin/data \
    sites \
    .env \
    /etc/nginx/sites-available \
    /etc/sudoers.d \
    /etc/letsencrypt \
    "${sys_units[@]}" \
    2>/dev/null || { telegram "❌ <b>Backup tar failed</b> on $(hostname)"; exit 1; }

size=$(du -h "$out" | cut -f1)

# Upload
if ! aws s3 cp "$out" "s3://$S3_BUCKET/$S3_PREFIX/$day.tar.gz" \
     --storage-class STANDARD_IA \
     --metadata "ts=$ts,host=$(hostname)" \
     --quiet; then
  telegram "❌ <b>Backup S3 upload failed</b> on $(hostname) — $day.tar.gz ($size)"
  exit 1
fi

echo "[backup] $day.tar.gz ($size) → s3://$S3_BUCKET/$S3_PREFIX/"

# Prune old dailies beyond 7; keep first-of-month forever
aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" 2>/dev/null \
  | awk '{print $4}' \
  | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gz$' \
  | sort -r | tail -n +8 \
  | while read -r f; do
    if [[ "$f" =~ ^[0-9]{4}-[0-9]{2}-01\.tar\.gz$ ]]; then continue; fi
    aws s3 rm "s3://$S3_BUCKET/$S3_PREFIX/$f" --quiet
    echo "[backup] pruned $f"
  done

rm -f "$out"
trap - EXIT  # success — disarm failure trap
