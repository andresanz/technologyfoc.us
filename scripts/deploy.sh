#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/var/log/andresanz-deploy.log"

set -a; source "$APP_DIR/.env"; set +a

tg() {
  TOKEN="${DEPLOY_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
  CHAT="${DEPLOY_TELEGRAM_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}"
  if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then return; fi
  curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    -d chat_id="${CHAT}" -d text="$1" > /dev/null
}
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

cd "$APP_DIR"

BEFORE=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin --quiet
git reset --hard origin/"$BRANCH" --quiet
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  log "Already up to date"
  exit 0
fi

log "Deployed ${BEFORE:0:7} -> ${AFTER:0:7}"

# npm install if package.json changed
if git diff --name-only "$BEFORE" "$AFTER" | grep -q 'package\.json'; then
  log "Running npm install..."
  npm install --omit=dev --silent
fi

# restart both processes
systemctl restart andresanz
systemctl restart andresanz-admin
tg "andresanz.com deployed ${BEFORE:0:7} -> ${AFTER:0:7}"
