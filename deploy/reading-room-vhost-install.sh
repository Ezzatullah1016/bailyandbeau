#!/usr/bin/env bash
# Run ON THE EC2 instance (as ubuntu), with sudo:
#   sudo bash reading-room-vhost-install.sh
# Or from laptop (see reading-room-from-laptop.ps1).
#
# Creates nginx vhost for reading-room.baileyandbeauco.com → same upstreams as DEPLOY.md.
# If no TLS cert exists yet, obtains one via Let's Encrypt webroot (needs CERTBOT_EMAIL).

set -euo pipefail

DOMAIN="reading-room.baileyandbeauco.com"
WEBROOT="/var/www/certbot"
CONF="/etc/nginx/sites-available/${DOMAIN}.conf"
LIVE_SUB="/etc/letsencrypt/live/${DOMAIN}"
LIVE_APEX_FALLBACK="/etc/letsencrypt/live/baileyandbeauco.com"

log() { printf '\n==> %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash $0"
  exit 1
fi

pick_cert_dir() {
  if [[ -d "${LIVE_SUB}" ]]; then
    echo "${LIVE_SUB}"
  elif [[ -d "${LIVE_APEX_FALLBACK}" ]]; then
    echo "${LIVE_APEX_FALLBACK}"
  else
    echo ""
  fi
}

write_ssl_conf() {
  local cert_dir="$1"
  cat >"${CONF}" <<NGINX
# Managed by repo deploy/reading-room-vhost-install.sh
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate     ${cert_dir}/fullchain.pem;
    ssl_certificate_key ${cert_dir}/privkey.pem;

    client_max_body_size 25M;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /super-admin/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /webhooks/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
NGINX
}

write_http_challenge_only() {
  cat >"${CONF}" <<NGINX
# Temporary: HTTP + ACME webroot for certbot
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        return 200 'tls pending';
        add_header Content-Type text/plain;
    }
}
NGINX
}

CERT_DIR="$(pick_cert_dir)"
mkdir -p "${WEBROOT}/.well-known/acme-challenge"

if [[ -n "${CERT_DIR}" ]]; then
  log "Using certificate directory: ${CERT_DIR}"
  write_ssl_conf "${CERT_DIR}"
else
  log "No certificate found at ${LIVE_SUB} or ${LIVE_APEX_FALLBACK}."
  if [[ -z "${CERTBOT_EMAIL:-}" ]]; then
    echo "Export CERTBOT_EMAIL='you@domain.com' and re-run to issue a Let's Encrypt cert via webroot."
    echo "Example: sudo CERTBOT_EMAIL=admin@baileyandbeauco.com bash $0"
    exit 1
  fi
  write_http_challenge_only
fi

ln -sf "${CONF}" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx

if [[ -z "$(pick_cert_dir)" ]]; then
  log "Requesting certificate for ${DOMAIN} (webroot)…"
  certbot certonly \
    --webroot -w "${WEBROOT}" \
    -d "${DOMAIN}" \
    --non-interactive --agree-tos \
    --email "${CERTBOT_EMAIL}" \
    --keep-until-expiring
  CERT_DIR="$(pick_cert_dir)"
  if [[ -z "${CERT_DIR}" ]]; then
    echo "certbot did not create ${LIVE_SUB}; check certbot output and DNS A record for ${DOMAIN}."
    exit 1
  fi
  write_ssl_conf "${CERT_DIR}"
  nginx -t
  systemctl reload nginx
fi

log "Done. Test: curl -sI https://${DOMAIN}/ | head -5"
