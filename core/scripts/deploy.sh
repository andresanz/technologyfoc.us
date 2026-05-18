#!/bin/bash
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="blog-blog-core"
LOG="/var/log/blog-blog-core-deploy.log"
set -a; source "$APP_DIR/.env"; set +a
tg() { TOKEN="${DEPLOY_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"; CHAT="${DEPLOY_TELEGRAM_CHAT_ID:-${TELEGRAM_CHAT_ID:-}}"; [ -z "$TOKEN" ] || [ -z "$CHAT" ] && return; curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" -d chat_id="${CHAT}" -d text="$1" > /dev/null; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"; }
cd "$APP_DIR"
BEFORE=$(git rev-parse HEAD)
git stash --quiet
BRANCH=$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)
  git pull --rebase origin "$BRANCH" --quiet
git stash pop --quiet 2>/dev/null || true
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" != "$AFTER" ]; then
  log "Deployed ${BEFORE:0:7} -> ${AFTER:0:7}"
  systemctl restart "$SERVICE"
  tg "$SERVICE deployed ${BEFORE:0:7} -> ${AFTER:0:7}"
else
  log "Already up to date"
fi
