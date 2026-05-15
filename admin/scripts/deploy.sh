#!/bin/bash
set -e

REPO_DIR="/var/www/server02"
SERVICE="blog-admin"

cd "$REPO_DIR"
BEFORE=$(git rev-parse HEAD)
git pull --ff-only
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" != "$AFTER" ]; then
  echo "Deployed ${BEFORE:0:7} -> ${AFTER:0:7}"
  systemctl restart "$SERVICE"
else
  echo "Already up to date"
fi
