#!/usr/bin/env bash
# deploy/deploy-from-laptop.sh — mac/linux equivalent of run-deploy.ps1
# Usage:
#     ./deploy/deploy-from-laptop.sh [--bootstrap]

set -euo pipefail

SERVER_IP="${SERVER_IP:-16.16.146.231}"
USER="${USER_NAME:-ubuntu}"
PEM="${PEM:-backend/keys/deployment.pem}"
REMOTE_DIR="${REMOTE_DIR:-/opt/baileybeau}"

if [[ ! -f "$PEM" ]]; then
    echo "PEM not found at $PEM" >&2
    exit 1
fi
chmod 400 "$PEM" || true

SSH=( ssh -i "$PEM" -o StrictHostKeyChecking=accept-new )
TARGET="${USER}@${SERVER_IP}"

echo "[deploy] testing SSH to $TARGET ..."
"${SSH[@]}" "$TARGET" 'echo ok: $(hostname) $(uname -srm)'

if [[ "${1:-}" == "--bootstrap" ]]; then
    echo "[deploy] bootstrapping server (one-time)..."
    scp -i "$PEM" -o StrictHostKeyChecking=accept-new \
        deploy/server-bootstrap.sh "$TARGET:/tmp/server-bootstrap.sh"
    "${SSH[@]}" "$TARGET" 'bash /tmp/server-bootstrap.sh && rm -f /tmp/server-bootstrap.sh'
fi

echo "[deploy] ensuring $REMOTE_DIR ..."
"${SSH[@]}" "$TARGET" "sudo mkdir -p $REMOTE_DIR && sudo chown -R $USER:$USER $REMOTE_DIR"

echo "[deploy] rsync code ..."
rsync -az --delete -e "ssh -i $PEM -o StrictHostKeyChecking=accept-new" \
    --exclude=.git/ \
    --exclude=node_modules/ \
    --exclude=.venv/ \
    --exclude=.next/ \
    --exclude=backend/keys/ \
    --exclude='*.pem' \
    --exclude='*.sqlite3' \
    --exclude=backend/media/ \
    --exclude=backend/.env \
    --exclude=frontend/.env.local \
    --exclude=frontend/.env.production.local \
    --exclude=__pycache__/ \
    ./ "$TARGET:$REMOTE_DIR/"

echo "[deploy] running remote deploy.sh ..."
"${SSH[@]}" "$TARGET" "bash $REMOTE_DIR/deploy/deploy.sh"

echo
echo "[deploy] done — http://$SERVER_IP/"
