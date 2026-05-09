#!/usr/bin/env bash
# Bailey & Beau — update an existing deployment on the EC2 instance.
#
# Production target: Ubuntu 24.04 (eu-north-1) at https://51.21.140.88
# Repo lives at /home/ubuntu/app and tracks origin/main.
#
# The server is pre-provisioned with:
#   - gunicorn  (systemd unit `gunicorn.service`) on 127.0.0.1:8000
#   - pm2       process `bailyandbeau-frontend` on 127.0.0.1:3001
#   - nginx     terminating TLS on :443, reverse-proxying /api, /admin,
#               /super-admin, /webhooks → gunicorn and everything else → Next.js
#
# Usage (from a workstation with the deployment key):
#   ssh -i backend/keys/deployment.pem ubuntu@51.21.140.88 \
#       'bash /home/ubuntu/app/deploy/update.sh'
#
# Or run directly on the server as the `ubuntu` user:
#   bash /home/ubuntu/app/deploy/update.sh
#
# This script is idempotent. It:
#   1. git fetch && git reset --hard origin/$BRANCH
#   2. Installs Python deps into backend/venv
#   3. Runs Django migrate + collectstatic
#   4. Installs frontend deps and runs `npm run build`
#   5. Restarts gunicorn (systemd) and the bailyandbeau-frontend pm2 process
#   6. Reloads nginx
#
# The production backend/.env lives only on the server (gitignored). It
# contains Django, Sentry, Stripe, LiveKit, S3 and DB credentials.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/app}"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
VENV_DIR="$BACKEND_DIR/venv"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-bailyandbeau-frontend}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

cd "$APP_DIR"

log "Fetching latest from origin/$BRANCH"
git fetch --all --prune
git reset --hard "origin/$BRANCH"

log "Backend: installing Python dependencies"
if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install --upgrade pip wheel >/dev/null
"$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements.txt"

log "Backend: running migrations"
cd "$BACKEND_DIR"
"$VENV_DIR/bin/python" manage.py migrate --noinput

log "Backend: collecting static files"
"$VENV_DIR/bin/python" manage.py collectstatic --noinput

log "Frontend: installing Node dependencies"
cd "$FRONTEND_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

log "Frontend: production build"
npm run build

log "Restarting gunicorn (Django)"
sudo systemctl restart gunicorn

log "Restarting frontend (pm2: $PM2_APP)"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  pm2 start npm --name "$PM2_APP" -- run start -- -p 3001
fi
pm2 save >/dev/null

log "Reloading nginx"
sudo systemctl reload nginx

log "Deployment complete."
echo "Backend status:"
sudo systemctl status gunicorn --no-pager --lines=3 || true
echo
echo "Frontend status:"
pm2 list | grep -E "$PM2_APP|name" || true
