#!/usr/bin/env bash
# Idempotently rewrite ALLOWED_HOSTS / CORS / CSRF in /home/ubuntu/app/backend/.env
# so the new api subdomain + the current (51.21.140.88) and old (16.16.146.231) IPs
# all stay valid. Backs up the file first.

set -euo pipefail

ENV_FILE="/home/ubuntu/app/backend/.env"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE" >&2
    exit 1
fi

cp "$ENV_FILE" "${ENV_FILE}.bak.${STAMP}"
echo "Backed up to ${ENV_FILE}.bak.${STAMP}"

# Strip the three keys (and any trailing CR from previous edits) — we'll re-append clean values.
sed -i \
    -e '/^DJANGO_ALLOWED_HOSTS=/d' \
    -e '/^DJANGO_CORS_ALLOWED_ORIGINS=/d' \
    -e '/^DJANGO_CSRF_TRUSTED_ORIGINS=/d' \
    "$ENV_FILE"

# Make sure file ends with a newline so we don't glue keys together.
[[ -s "$ENV_FILE" && "$(tail -c1 "$ENV_FILE")" != "" ]] && echo >> "$ENV_FILE" || true

cat >> "$ENV_FILE" <<'EOF'
DJANGO_ALLOWED_HOSTS=api.reading-room.baileyandbeauco.com,51.21.140.88,16.16.146.231,localhost,127.0.0.1
DJANGO_CORS_ALLOWED_ORIGINS=https://api.reading-room.baileyandbeauco.com,https://51.21.140.88,https://16.16.146.231,http://localhost:3000,http://127.0.0.1:3000
DJANGO_CSRF_TRUSTED_ORIGINS=https://api.reading-room.baileyandbeauco.com,https://51.21.140.88,https://16.16.146.231,http://127.0.0.1,http://localhost,http://127.0.0.1:3000,http://localhost:3000
EOF

echo "--- new values ---"
grep -E '^DJANGO_(ALLOWED_HOSTS|CORS_ALLOWED_ORIGINS|CSRF_TRUSTED_ORIGINS)=' "$ENV_FILE"
