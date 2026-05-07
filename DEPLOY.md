# Deploying Bailey & Beau to EC2

Target: `http://16.16.146.231` · user: `ubuntu` · key: `backend/keys/deployment.pem` (already gitignored).

> **Security:** never commit `.pem`, `.env`, or DB dumps. `.gitignore` blocks `*.pem`, `backend/.env`, `frontend/.env.*`, and `backend/keys/`.

---

## What gets deployed

| Layer | Where | Service |
|------|-------|---------|
| Django + DRF | `/opt/baileybeau/backend` | `baileybeau-backend.service` (gunicorn over a unix socket) |
| Next.js | `/opt/baileybeau/frontend` | `baileybeau-frontend.service` (`npm run start` on `127.0.0.1:3000`) |
| Reverse proxy | nginx :80 | Routes `/api`, `/admin`, `/super-admin`, `/static`, `/media` → Django; everything else → Next.js |
| Postgres | local on EC2 (default) or RDS | `baileybeau` DB / `baileybeau` user |
| Static / media | nginx aliases | `staticfiles/` and `media/` under the backend dir |

---

## One-time server bootstrap

Done once per fresh EC2 box (Ubuntu 22.04 / 24.04):

### From Windows
```powershell
./deploy/run-deploy.ps1 -Bootstrap
```

### From mac / linux
```bash
./deploy/deploy-from-laptop.sh --bootstrap
```

Both helpers:
1. Tighten permissions on `backend/keys/deployment.pem` so OpenSSH accepts it.
2. SSH into the box and install **Python 3, Node 20, nginx, postgres, poppler**.
3. Create the `baileybeau` Postgres role and database.
4. Open `OpenSSH` and `Nginx Full` in UFW.

---

## Configure secrets on the server (one-time)

SSH in once and create the env files (these are **not** in the repo).

```bash
ssh -i backend/keys/deployment.pem ubuntu@16.16.146.231

sudo install -d -m 750 /etc/baileybeau
sudo nano /etc/baileybeau/backend.env     # use deploy/backend.env.template as a starting point
sudo nano /etc/baileybeau/frontend.env    # use deploy/frontend.env.template
sudo chmod 600 /etc/baileybeau/*.env
```

Generate a strong Django key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

If your AWS security group still blocks port 80, allow it (one-time):

> EC2 console → instance → Security → Security groups → Inbound → add **HTTP / TCP / 80 / 0.0.0.0/0**.

---

## Deploy / redeploy

After every code change, from your laptop:

### Windows (PowerShell)
```powershell
./deploy/run-deploy.ps1
```

### mac / linux
```bash
./deploy/deploy-from-laptop.sh
```

This rsyncs the repo (excluding `.git`, `node_modules`, `.venv`, `.next`, secrets, sqlite, media), then runs `deploy/deploy.sh` remotely:

1. Backend: create venv if missing, `pip install -r requirements.txt`, install gunicorn, run `migrate --noinput`, `collectstatic --noinput`.
2. Frontend: `npm ci`, `npm run build`.
3. Install/refresh systemd units + nginx config.
4. Reload nginx, restart both services.

URLs:

- App: `http://16.16.146.231/`
- Super-admin: `http://16.16.146.231/super-admin/`
- API health: `http://16.16.146.231/api/v1/health/`

---

## Common ops

```bash
# Tail logs
sudo journalctl -u baileybeau-backend -f
sudo journalctl -u baileybeau-frontend -f
sudo tail -f /var/log/nginx/error.log

# Restart manually
sudo systemctl restart baileybeau-backend baileybeau-frontend nginx

# Open a Django shell on the server
cd /opt/baileybeau/backend && ./.venv/bin/python manage.py shell

# Create the first super-admin
cd /opt/baileybeau/backend && ./.venv/bin/python manage.py createsuperuser
```

---

## Adding HTTPS later

If you point a domain at this IP, install certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example.com
```

Then update `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS`, `DJANGO_CSRF_TRUSTED_ORIGINS`, and `NEXT_PUBLIC_API_BASE_URL` to use the domain.

---

## What is **not** in the repo (never commit)

- `backend/keys/deployment.pem` — your EC2 key (gitignored)
- `backend/.env`, `backend/.env.staging`, `frontend/.env.local`, `frontend/.env.production.local`
- `/etc/baileybeau/backend.env`, `/etc/baileybeau/frontend.env` — only on the server
