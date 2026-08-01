# Deploying Bailey & Beau

**Live target:** `https://51.21.140.88/` (EC2 eu-north-1, Elastic IP)  
**SSH:** `ubuntu@51.21.140.88`  
**Key:** `backend/keys/deployment.pem` (gitignored — never commit it). On Windows, `deploy/run-deploy.ps1` also accepts `baileyandbeauco-key.pem` in the repo root if the path above is missing.

The EC2 box is already provisioned. Deploys are **just**: push code → SSH in → run `deploy/update.sh`.

---

## Existing server layout

| Layer | What |
|------|------|
| Repo | `/home/ubuntu/app`, tracks `origin/main` |
| Backend | Django + DRF, gunicorn on `127.0.0.1:8000`, systemd unit `gunicorn.service`, venv at `backend/venv` |
| Frontend | Next.js production build, pm2 process `bailyandbeau-frontend` on `127.0.0.1:3001` |
| Reverse proxy | nginx terminates TLS on `:443`, routes `/api`, `/admin`, `/staff`, `/webhooks` → gunicorn, everything else → Next.js |
| Secrets | `/home/ubuntu/app/backend/.env` (only on the server, gitignored) |

`deploy/update.sh` runs the canonical update sequence on the server:

1. `git fetch && git reset --hard origin/main`
2. Recreate / update Python venv, `pip install -r requirements.txt`
3. `python manage.py migrate --noinput`
4. `python manage.py collectstatic --noinput`
5. `npm ci && npm run build`
6. `sudo systemctl restart gunicorn`
7. `pm2 restart bailyandbeau-frontend`
8. `sudo systemctl reload nginx`

### Subdomain + HTTPS (`reading-room.baileyandbeauco.com`)

If the subdomain **times out** but SSH works:

1. **Route 53 / DNS:** `reading-room` **A** record → **`51.21.140.88`** (same Elastic IP as the app server).
2. **Security group** (`baileyandbeauco-sg` or equivalent): inbound **TCP 80** and **TCP 443** from **`0.0.0.0/0`** (and **`::/0`** if you use IPv6).
3. **nginx:** add a `server { server_name reading-room.baileyandbeauco.com; ... }` that mirrors your main TLS site (proxy `/api`, `/admin`, `/staff`, `/webhooks` → gunicorn; `/` → `127.0.0.1:3001`). Copy from **`deploy/nginx-reading-room.baileyandbeauco.conf.example`**, set real **`ssl_certificate`** paths, then `sudo nginx -t && sudo systemctl reload nginx`.  
   **Automated (from laptop, with PEM):** `.\deploy\reading-room-from-laptop.ps1` copies and runs **`deploy/reading-room-vhost-install.sh`** on the server (uses an existing Let’s Encrypt dir if present, otherwise set **`$env:CERTBOT_EMAIL`** first for `certbot certonly --webroot`). Requires **SSH (22)** reachable from your PC.
4. **TLS:** e.g. `sudo certbot --nginx -d reading-room.baileyandbeauco.com` if using Let’s Encrypt.

### Frontend production build (offline‑friendly)

Fonts are **self‑hosted** (`@fontsource/*` in `app/layout.tsx`), so `npm run build` on the server does **not** need to reach `fonts.googleapis.com` / `fonts.gstatic.com`.

---

## One‑command deploy from your laptop

After committing your changes locally, run from the repo root.

### Windows (PowerShell)
```powershell
# Push current branch and run update.sh on the server
./deploy/run-deploy.ps1 -Push
```

### macOS / Linux
```bash
./deploy/deploy-from-laptop.sh --push
```

Both helpers:
- Read **`backend/keys/deployment.pem`** (locally only, never uploaded)
- On Windows, tighten the key's ACL so OpenSSH accepts it (`icacls`)
- Optionally `git push origin HEAD` first
- SSH to `ubuntu@51.21.140.88`
- Run `bash /home/ubuntu/app/deploy/update.sh`

If you only want to redeploy without pushing (e.g. you already pushed via GitHub):

```powershell
./deploy/run-deploy.ps1
```

### One-shot from your Windows PC (deploy app + reading-room nginx)

On the machine where **SSH to the instance works** (often **not** from Cursor’s cloud shell), from repo root:

```powershell
.\deploy\do-everything-from-pc.ps1              # deploy only
.\deploy\do-everything-from-pc.ps1 -Push        # git push then deploy
$env:CERTBOT_EMAIL='you@domain.com'; .\deploy\do-everything-from-pc.ps1   # also obtain TLS cert if missing
```

This runs **`run-deploy.ps1`** then **`reading-room-from-laptop.ps1`**. Use the **`.pem`** for EC2 key pair **`baileyandbeauco-key`** (typically **`baileyandbeauco-key.pem`** in the repo root).

---

## GitHub Actions deploy

After **`main` is on GitHub**, you can deploy from the **Actions** tab without your laptop PEM:

1. In the repo on GitHub: **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Required | Description |
|--------|----------|-------------|
| `DEPLOY_HOST` | Yes | EC2 public host, e.g. `51.21.140.88` |
| `DEPLOY_SSH_PRIVATE_KEY` | Yes | Full **private** PEM (same key that can SSH as `ubuntu`; never commit this file) |
| `SSH_KNOWN_HOSTS` | Yes | Run **`ssh-keyscan -H YOUR_HOST`** locally and paste the whole output (one or more lines) |
| `DEPLOY_USER` | No | SSH login; defaults to **`ubuntu`** if unset |

2. **Run the workflow:** **Actions → "Deploy to EC2" → Run workflow**. The job SSHs in and runs `bash /home/ubuntu/app/deploy/update.sh` (which resets to `origin/main` and rebuilds).

3. **EC2 prerequisites (or the job will fail):**
   - **`ubuntu` must be able to run `sudo` non-interactively** for `systemctl restart gunicorn` and `systemctl reload nginx`. Check on the server: `sudo -n true` (should exit `0`).
   - Outbound **HTTPS to `github.com`** so `git fetch` works inside `update.sh`.
   - **Security group inbound TCP 22:** GitHub-hosted runners use **dynamic** egress IPs, so SSH cannot be limited to a single GitHub IP unless you use a **self-hosted runner**, **AWS SSM**, or a VPN/bastion. Many teams allow **`0.0.0.0/0` on port 22** and rely on key-only auth (tighten with `fail2ban` or a bastion if you need stricter access).

4. **Order of operations:** Push your commits to **`main`** first — the workflow only triggers the server script; **`update.sh` pulls whatever is latest on `origin/main`**.

---

## SFTP / FileZilla (GUI upload)

Step-by-step (key conversion to `.ppk`, remote path `/home/ubuntu/app`, exclusions, post-upload `update.sh`): **[`docs/DEPLOY_AWS_FILEZILLA.md`](docs/DEPLOY_AWS_FILEZILLA.md)**. Prefer **git push + SSH `update.sh`** when possible.

---

## Elastic Beanstalk (optional — separate backend host)

The primary production setup is EC2 + nginx + `update.sh`. If you experiment with EB for Django only:

1. **CLI tools:** Install into `backend\.venv`: `pip install awscli awsebcli gunicorn`  
   Session helper: `.\\deploy\\eb-use-venv.ps1` (adds venv Scripts to `PATH`)

2. **AWS CLI on Windows:** If `winget` is unavailable, use the pip install above instead of MSI. If `aws.cmd` fails with “module not found”, run:
   ```powershell
   backend\.venv\Scripts\python.exe -m awscli --version
   backend\.venv\Scripts\python.exe -m awscli configure   # IAM keys interactive
   ```
   Region: **`eu-north-1`** · output **`json`** (as you chose).

3. **App root:** Run **`eb init`** / **`eb create`** from **`backend\\`** — WSGI is **`config.wsgi:application`** (not `core.wsgi`). Repo includes **`backend/Procfile`** and **`requirements.txt`** with **gunicorn**.

4. **Settings:** Prefer env vars (`DJANGO_DEBUG=false`, `DJANGO_ALLOWED_HOSTS=your-env.eu-north-1.elasticbeanstalk.com,...`). Do **not** hard‑code **`ALLOWED_HOSTS = ['*']`** unless you intentionally accept every host header.

5. **Database:** Provision **RDS Postgres** or set env **`POSTGRES_*`** on the EB environment to match **`config/settings.py`**.

6. **Interactive steps** (credentials + VPC choices) cannot be scripted here — run **`eb init`** then **`eb create bailey-beau-backend-env`** locally after `aws configure`.

---

## Manual deploy (no helpers)

```bash
# 1. From your laptop
git push origin main

# 2. SSH in and run the update
ssh -i backend/keys/deployment.pem ubuntu@51.21.140.88 \
  'bash /home/ubuntu/app/deploy/update.sh'
```

---

## Common ops

```bash
ssh -i backend/keys/deployment.pem ubuntu@51.21.140.88

sudo systemctl status gunicorn --no-pager
sudo journalctl -u gunicorn -n 100 -f

pm2 list
pm2 logs bailyandbeau-frontend --lines 100

sudo nginx -t && sudo systemctl reload nginx
sudo tail -f /var/log/nginx/error.log

cd /home/ubuntu/app/backend
./venv/bin/python manage.py shell
./venv/bin/python manage.py createsuperuser
```

---

## Things that must never be committed

`.gitignore` already blocks them, but for the record:

- `backend/keys/deployment.pem` (and any `*.pem`)
- `backend/.env`, `backend/.env.staging`
- `frontend/.env.local`, `frontend/.env.production.local`

---

## Local development

For LAN access from another device on the same Wi‑Fi, see [`run.bat`](run.bat) and [`NGROK.md`](NGROK.md).
