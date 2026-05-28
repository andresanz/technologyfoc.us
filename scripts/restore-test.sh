#!/usr/bin/env bash
# Monthly: pull latest backup from S3, extract to /tmp, verify integrity,
# Telegram-notify the result. Detects silent backup rot.

set -uo pipefail

PLATFORM_ROOT="${PLATFORM_ROOT:-/var/www/technologyfoc.us}"
S3_BUCKET="${BACKUP_S3_BUCKET:-technologyfoc-us}"
S3_PREFIX="${BACKUP_S3_PREFIX:-backups/platform}"
TEST_DIR="/tmp/backup-restore-test"

while IFS='=' read -r k v; do
  case "$k" in
    AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_REGION|AWS_DEFAULT_REGION|TELEGRAM_BOT_TOKEN|TELEGRAM_CHAT_ID)
      export "$k"="$v" ;;
  esac
done < <(grep -E '^(AWS_|TELEGRAM_)' "$PLATFORM_ROOT/.env" 2>/dev/null)
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-${AWS_REGION:-us-east-1}}"

telegram() {
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return
  curl -s -o /dev/null \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "text=$1" || true
}

fail() {
  telegram "❌ <b>Restore drill FAILED</b> — $1"
  rm -rf "$TEST_DIR"
  exit 1
}

rm -rf "$TEST_DIR" && mkdir -p "$TEST_DIR"

LATEST=$(aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" 2>/dev/null \
         | awk '{print $4}' | sort -r | head -1)
[ -z "$LATEST" ] && fail "no backup found in s3://$S3_BUCKET/$S3_PREFIX/"

aws s3 cp "s3://$S3_BUCKET/$S3_PREFIX/$LATEST" "$TEST_DIR/$LATEST" --quiet \
  || fail "download of $LATEST failed"

size=$(du -h "$TEST_DIR/$LATEST" | cut -f1)

# Tar integrity
tar -tzf "$TEST_DIR/$LATEST" > /dev/null \
  || fail "tar integrity check failed on $LATEST"

# Extract critical bits
mkdir -p "$TEST_DIR/x"
tar -xzf "$TEST_DIR/$LATEST" -C "$TEST_DIR/x" admin/data/domains.db 2>/dev/null \
  || fail "domains.db missing from $LATEST"

# Smoke-test the DB
count=$(sqlite3 "$TEST_DIR/x/admin/data/domains.db" "SELECT COUNT(*) FROM domains" 2>/dev/null)
[ -z "$count" ] && fail "domains.db query failed"
[ "$count" -lt 1 ] && fail "domains.db empty"

# Count content files
contentN=$(tar -tzf "$TEST_DIR/$LATEST" | grep -cE '^sites/[^/]+/content/(posts|pages)/.+\.md$')
[ "$contentN" -lt 1 ] && fail "no content .md files in backup"

telegram "✅ <b>Restore drill OK</b>%0A$LATEST ($size)%0A$count domains · $contentN content files"
rm -rf "$TEST_DIR"
