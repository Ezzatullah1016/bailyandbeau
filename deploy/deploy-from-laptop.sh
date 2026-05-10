#!/usr/bin/env bash
# deploy/deploy-from-laptop.sh — mac/linux equivalent of run-deploy.ps1
#
#     ./deploy/deploy-from-laptop.sh           # ssh in and run update.sh
#     ./deploy/deploy-from-laptop.sh --push    # git push first

set -euo pipefail

SERVER_IP="${SERVER_IP:-51.21.140.88}"
USER_NAME="${USER_NAME:-ubuntu}"
PEM="${PEM:-backend/keys/deployment.pem}"
APP_DIR="${APP_DIR:-/home/ubuntu/app}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$PEM" ]]; then
    if [[ -f "$REPO_ROOT/baileyandbeauco-key.pem" ]]; then
        PEM="$REPO_ROOT/baileyandbeauco-key.pem"
        echo "[deploy] Using $PEM" >&2
    elif [[ -f "$REPO_ROOT/baileyandbeaukey.pem" ]]; then
        PEM="$REPO_ROOT/baileyandbeaukey.pem"
        echo "[deploy] Using $PEM" >&2
    else
        echo "PEM not found at $PEM (nor baileyandbeauco-key.pem / baileyandbeaukey.pem in repo root)" >&2
        exit 1
    fi
fi
chmod 400 "$PEM" || true

if [[ "${1:-}" == "--push" ]]; then
    echo "[deploy] git push origin HEAD"
    git push origin HEAD
fi

SSH=( ssh -i "$PEM" -o StrictHostKeyChecking=accept-new )
TARGET="${USER_NAME}@${SERVER_IP}"

echo "[deploy] SSH to $TARGET ..."
"${SSH[@]}" "$TARGET" "echo 'connected: '\$(hostname); test -d $APP_DIR || { echo 'app dir missing'; exit 1; }"

echo "[deploy] running update.sh ..."
"${SSH[@]}" "$TARGET" "bash $APP_DIR/deploy/update.sh"

echo
echo "[deploy] Done — https://$SERVER_IP/"
