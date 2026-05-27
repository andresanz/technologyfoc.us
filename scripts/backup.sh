#!/usr/bin/env bash
# Nightly backup → S3
#
# Includes:
#   - admin/data/*.db + *.json  (domains DB, analytics DB, gratitude state, etc.)
#   - sites/*/content/          (markdown source — already in git, but for safety)
#   - sites/*/.env              (NOT in git, contains secrets)
#   - /var/www/technologyfoc.us/.env  (platform .env)
#
# Excludes node_modules, .git, *.log, *-shm, *-wal
#
# Retention: 7 daily, plus monthly snapshots forever (S3 lifecycle handles).

set -euo pipefail

PLATFORM_ROOT="${PLATFORM_ROOT:-/var/www/technologyfoc.us}"
S3_BUCKET="${BACKUP_S3_BUCKET:-andresanz-com}"
S3_PREFIX="${BACKUP_S3_PREFIX:-backups/platform}"
STAGING="${BACKUP_STAGING:-/tmp/platform-backup}"

# Load AWS creds from platform .env
set -a; . "$PLATFORM_ROOT/.env"; set +a

ts=$(date +%Y%m%d-%H%M%S)
day=$(date +%Y-%m-%d)
out="$STAGING/$day.tar.gz"

mkdir -p "$STAGING"

cd "$PLATFORM_ROOT"

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
    .env 2>/dev/null || true

size=$(du -h "$out" | cut -f1)

# Upload to S3 with metadata
aws s3 cp "$out" "s3://$S3_BUCKET/$S3_PREFIX/$day.tar.gz" \
  --storage-class STANDARD_IA \
  --metadata "ts=$ts,host=$(hostname)" \
  --quiet

echo "[backup] $day.tar.gz ($size) → s3://$S3_BUCKET/$S3_PREFIX/"

# Prune old daily backups beyond 7 — but keep day-01 of each month forever
aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" | awk '{print $4}' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.tar\.gz$' \
  | sort -r | tail -n +8 | while read -r f; do
    # Keep first-of-month snapshots
    if [[ "$f" =~ ^[0-9]{4}-[0-9]{2}-01\.tar\.gz$ ]]; then continue; fi
    aws s3 rm "s3://$S3_BUCKET/$S3_PREFIX/$f" --quiet
    echo "[backup] pruned $f"
  done

# Cleanup local staging
rm -f "$out"
