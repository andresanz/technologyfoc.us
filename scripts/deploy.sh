#!/bin/bash
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/var/log/andresanz-deploy.log"

set -a; source "$APP_DIR/.env"; set +a

tg() {
  if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then return; fi
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="${TELEGRAM_CHAT_ID}" -d text="$1" > /dev/null
}
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }

cd "$APP_DIR"

BEFORE=$(git rev-parse HEAD)
DIRTY=$(git diff --quiet HEAD 2>/dev/null; echo $?)
[ "$DIRTY" = "1" ] && git stash --quiet
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git pull --rebase origin "$BRANCH" --quiet
[ "$DIRTY" = "1" ] && git stash pop --quiet 2>/dev/null || true
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
