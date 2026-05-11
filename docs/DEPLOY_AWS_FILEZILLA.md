# Deploy Bailey & Beau to AWS EC2 with FileZilla (SFTP)

Your production server already expects the app at **`/home/ubuntu/app`** (Ubuntu user `ubuntu`). **SSH/SFTP uses port 22** — the same key you use for `ssh -i …deployment.pem`.

> **Preferred method:** push code to `main` on GitHub, then on the server run `bash /home/ubuntu/app/deploy/update.sh` over SSH, or use `deploy/run-deploy.ps1` / GitHub Actions. That avoids overwriting server-only files and is faster than uploading `node_modules`.
>
> Use **FileZilla** when you need a GUI transfer (e.g. no `git` on the server, or you are uploading a one-off patch). After the upload you still **must** install dependencies and restart services on the server (see §4).

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|--------|
| **EC2 public IP or DNS** | e.g. `51.21.140.88` (update if your instance changed). |
| **Security group** | Inbound **TCP 22** from your IP or `0.0.0.0/0` (key-based SSH only). |
| **Private key** | `backend/keys/deployment.pem` (local only — do not commit). |
| **Remote user** | **`ubuntu`** (standard Ubuntu AMIs). |

---

## 2. Connect FileZilla over SFTP

### 2.1 Convert `.pem` to `.ppk` (Windows — recommended)

FileZilla’s built-in key dialog is quirky with some `.pem` files. **PuTTYgen** is reliable.

1. Download **PuTTY** (includes PuTTYgen): https://www.putty.org/
2. Open **PuTTYgen** → **Conversions → Import key** → select `deployment.pem`
3. **Save private key** → name it e.g. `deployment-filezilla.ppk` (you may confirm without passphrase for automation, or set a passphrase for safety).

### 2.2 Site Manager settings

1. **File → Site Manager → New Site**
2. **General** tab:
   - **Protocol:** `SFTP – SSH File Transfer Protocol`
   - **Host:** your EC2 public IP or hostname
   - **Port:** `22`
   - **Logon Type:** `Key file` *(or “Interactive” if your FileZilla version differs)*
   - **User:** `ubuntu`
   - **Key file:** browse to `deployment-filezilla.ppk` *(or `.pem` if your FileZilla accepts OpenSSH keys)*

3. **Connect**.

If connection fails: verify security group **SSH (22)**, key pair matches the instance, and username is `ubuntu`.

---

## 3. What to upload (remote path)

| Local (your PC) | Remote |
|-----------------|--------|
| Project root (repo) | `/home/ubuntu/app/` |

Mirror this structure on the server:

- `backend/` (code, `requirements.txt`, **do not replace** `/home/ubuntu/app/backend/.env` without intent)
- `frontend/` (code — **exclude** `node_modules` and `.next` to save time; the server will rebuild)
- `deploy/` (scripts such as `update.sh`)

### 3.1 Files to **exclude** from upload (or you slow the sync / risk breakage)

Create **Directory comparison filters** in FileZilla or simply **do not upload** these:

| Exclude | Why |
|---------|-----|
| `.git/` | Optional; server can `git pull` instead. Large. |
| `frontend/node_modules/` | Rebuilt on server with `npm ci`. |
| `frontend/.next/` | Built on server with `npm run build`. |
| `backend/.venv/`, `backend/venv/` | Server uses `backend/venv` — recreated/updated by `update.sh`. |
| `**/__pycache__/` | Not needed. |
| `backend/.env` (on your laptop) | **Never overwrite** server `/home/ubuntu/app/backend/.env` unless you intend to; production secrets live there. |
| `backend/keys/*.pem` | Do not upload keys to the repo directory on the server. |
| `*.sqlite3` | Local DB; production uses Postgres/S3 as configured server-side. |

**Tip:** In FileZilla, use **Filename filters** (Transfer → Filename filters) to hide `node_modules`, `.next`, `.git` from the queue before you **Queue and transfer**.

---

## 4. After upload: install + restart (required)

FileZilla only copies files. On the server you must run the same steps as `deploy/update.sh`.

**SSH** (PowerShell, from your repo root):

```powershell
ssh -i "backend\keys\deployment.pem" ubuntu@YOUR_EC2_IP
```

Then on the server:

```bash
cd /home/ubuntu/app
bash deploy/update.sh
```

That script will: `git fetch` + reset to `origin/main` **if** the folder is a git clone — **if you uploaded files without `.git`,** `git reset` may fail. In that case run the **manual** equivalent:

```bash
cd /home/ubuntu/app/backend
source ../backend/venv/bin/activate   # or: source venv/bin/activate if venv path differs
pip install -r requirements.txt
python manage.py migrate --noinput
python manage.py collectstatic --noinput

cd /home/ubuntu/app/frontend
npm ci --no-audit --no-fund
npm run build

sudo systemctl restart gunicorn
pm2 restart bailyandbeau-frontend --update-env
pm2 save
sudo systemctl reload nginx
```

*(Paths assume `venv` at `backend/venv` per `update.sh`; if your server uses another layout, adjust.)*

---

## 5. Safer workflow when you also use GitHub

1. `git push origin main`
2. FileZilla: upload only if needed (or skip upload).
3. SSH → `bash /home/ubuntu/app/deploy/update.sh` so the server matches **`origin/main`** exactly.

If you only SFTP and **never** push to GitHub, the server will diverge from `origin/main`.

---

## 6. Quick checklist

- [ ] SFTP connects as `ubuntu` with key `.ppk` / `.pem`
- [ ] Remote base path `/home/ubuntu/app`
- [ ] Did **not** overwrite production `backend/.env` by mistake
- [ ] Excluded `node_modules`, `.next`, large `.git` unless intentional
- [ ] Ran `deploy/update.sh` or manual pip/npm + service restarts
- [ ] Checked `https://YOUR_HOST/api/v1/health/` and the live site

---

## 7. Troubleshooting

| Symptom | What to check |
|---------|------------------|
| “Permission denied (publickey)” | Wrong `.pem`/`.ppk` for this instance; username must be `ubuntu`. |
| Upload very slow | Exclude `node_modules` and `.next`. |
| Site 502 / blank | `sudo systemctl status gunicorn`, `pm2 list`, `sudo nginx -t`. |
| Old UI after upload | Frontend: `npm run build` and `pm2 restart` on server. |

For domain + nginx on `reading-room.baileyandbeauco.com`, see **`DEPLOY.md`** § subdomain + **`deploy/reading-room-vhost-install.sh`**.
