#!/usr/bin/env bash
set -u
echo "--- Host: api subdomain on / should 404 ---"
curl -sk -o /dev/null -w "code=%{http_code}\n" \
    -H "Host: api.reading-room.baileyandbeauco.com" \
    https://127.0.0.1/

echo "--- Host: api subdomain on /api/v1/health/ should 200 ---"
curl -sk -o /dev/null -w "code=%{http_code}\n" \
    -H "Host: api.reading-room.baileyandbeauco.com" \
    https://127.0.0.1/api/v1/health/

echo "--- Host: bare IP on / should 200 (frontend) ---"
curl -sk -o /dev/null -w "code=%{http_code}\n" \
    -H "Host: 51.21.140.88" \
    https://127.0.0.1/

echo "--- Host: bare IP on /api/v1/health/ should 200 ---"
curl -sk -o /dev/null -w "code=%{http_code}\n" \
    -H "Host: 51.21.140.88" \
    https://127.0.0.1/api/v1/health/
