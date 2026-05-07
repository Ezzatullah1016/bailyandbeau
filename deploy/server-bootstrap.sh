#!/usr/bin/env bash
# First-time setup on a fresh Ubuntu 22.04/24.04 EC2 instance.
# Run as the `ubuntu` user (uses sudo internally).
#
#     curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/server-bootstrap.sh | bash
#
# Or scp this file and run:  bash server-bootstrap.sh

set -euo pipefail

APP_DIR="/opt/baileybeau"
APP_USER="ubuntu"
NODE_MAJOR="20"

echo "[1/7] apt update + upgrade"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "[2/7] system packages"
sudo apt-get install -y \
    git curl ca-certificates build-essential pkg-config \
    python3 python3-venv python3-dev \
    libpq-dev poppler-utils \
    nginx postgresql postgresql-contrib

echo "[3/7] node.js ${NODE_MAJOR}.x via NodeSource"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}* ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
fi
node -v
npm -v

echo "[4/7] app directory: ${APP_DIR}"
sudo mkdir -p "${APP_DIR}" /etc/baileybeau
sudo chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
sudo chmod 750 /etc/baileybeau

echo "[5/7] postgres role + database (idempotent)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='baileybeau'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE ROLE baileybeau LOGIN PASSWORD 'changeme-then-rotate' CREATEDB;"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='baileybeau'" | grep -q 1 \
    || sudo -u postgres createdb -O baileybeau baileybeau

echo "[6/7] systemd unit files (placeholders, replaced by deploy.sh on first deploy)"
sudo install -m 644 /dev/stdin /etc/systemd/system/baileybeau-backend.service <<'UNIT'
[Unit]
Description=Bailey & Beau placeholder (run deploy.sh)
[Service]
Type=oneshot
ExecStart=/bin/true
[Install]
WantedBy=multi-user.target
UNIT
sudo install -m 644 /etc/systemd/system/baileybeau-backend.service /etc/systemd/system/baileybeau-frontend.service
sudo systemctl daemon-reload

echo "[7/7] firewall (UFW) — allow ssh + http"
if command -v ufw >/dev/null 2>&1; then
    sudo ufw allow OpenSSH || true
    sudo ufw allow 'Nginx Full' || true
fi

echo
echo "Bootstrap complete."
echo "Next: from your laptop, run deploy/run-deploy.ps1 (Windows) or deploy/deploy-from-laptop.sh (mac/linux)."
