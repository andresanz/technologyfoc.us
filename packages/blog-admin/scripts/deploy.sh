#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="blog-admin"
LOG="/var/log/blog-admin-deploy.log"

# Load env for Telegram creds
set -a; source "$APP_DIR/.env"; set +a

tg() {
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" -d text="$1" > /dev/null
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

cd "$APP_DIR"
BEFORE=$(git rev-parse HEAD)
git fetch origin master --quiet
git reset --hard FETCH_HEAD --quiet
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  log "Deployed ${BEFORE:0:7} -> ${AFTER:0:7}"
  systemctl restart "$SERVICE"
  tg "blog-admin deployed ${BEFORE:0:7} -> ${AFTER:0:7}"
else
  log "Already up to date"
fi
