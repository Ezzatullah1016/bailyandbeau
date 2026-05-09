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
| Reverse proxy | nginx terminates TLS on `:443`, routes `/api`, `/admin`, `/super-admin`, `/webhooks` → gunicorn, everything else → Next.js |
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
