#!/usr/bin/env bash
# Runs ON the EC2 server (called via SSH from run-deploy.ps1 / deploy-from-laptop.sh).
# Assumes:
#   - server-bootstrap.sh has been run once already
#   - app code has been rsync'd (or git-pulled) into /opt/baileybeau/{backend,frontend}
#   - /etc/baileybeau/backend.env and /etc/baileybeau/frontend.env exist (chmod 600)

set -euo pipefail
cd /opt/baileybeau

REPO_ROOT="/opt/baileybeau"
BACKEND="${REPO_ROOT}/backend"
FRONTEND="${REPO_ROOT}/frontend"
DEPLOY_DIR="${REPO_ROOT}/deploy"

echo "==> Backend: virtualenv + dependencies"
cd "${BACKEND}"
if [[ ! -d .venv ]]; then
    python3 -m venv .venv
fi
./.venv/bin/pip install --upgrade pip wheel
./.venv/bin/pip install -r requirements.txt
./.venv/bin/pip install gunicorn

echo "==> Backend: env + migrate + collectstatic"
test -f /etc/baileybeau/backend.env || { echo "missing /etc/baileybeau/backend.env"; exit 1; }
# Symlink so manage.py finds it via load_dotenv(BASE_DIR/.env)
sudo ln -sf /etc/baileybeau/backend.env "${BACKEND}/.env"
mkdir -p "${BACKEND}/media" "${BACKEND}/staticfiles"

set -a; source /etc/baileybeau/backend.env; set +a
./.venv/bin/python manage.py migrate --noinput
./.venv/bin/python manage.py collectstatic --noinput

echo "==> Frontend: install + build"
cd "${FRONTEND}"
test -f /etc/baileybeau/frontend.env || { echo "missing /etc/baileybeau/frontend.env"; exit 1; }
ln -sf /etc/baileybeau/frontend.env "${FRONTEND}/.env.production"
npm ci
npm run build

echo "==> systemd: install unit files + nginx config"
sudo install -m 644 "${DEPLOY_DIR}/bailey-backend.service"  /etc/systemd/system/baileybeau-backend.service
sudo install -m 644 "${DEPLOY_DIR}/bailey-frontend.service" /etc/systemd/system/baileybeau-frontend.service
sudo install -m 644 "${DEPLOY_DIR}/nginx.conf" /etc/nginx/sites-available/baileybeau
sudo ln -sf /etc/nginx/sites-available/baileybeau /etc/nginx/sites-enabled/baileybeau
sudo rm -f /etc/nginx/sites-enabled/default

sudo systemctl daemon-reload
sudo systemctl enable --now baileybeau-backend.service
sudo systemctl restart baileybeau-backend.service
sudo systemctl enable --now baileybeau-frontend.service
sudo systemctl restart baileybeau-frontend.service

sudo nginx -t
sudo systemctl reload nginx

echo
echo "==> Deployed."
echo "    Health:  http://16.16.146.231/api/v1/health/"
echo "    App:     http://16.16.146.231/"
echo "    Admin:   http://16.16.146.231/super-admin/"
