# Public HTTPS URL for local dev (ngrok)

Use [ngrok](https://ngrok.com/) to get a shareable URL like **`https://abc123.ngrok-free.app`** that forwards to your machine. Anyone with the link can reach **Django** (and optionally **Next.js**) while your PC runs the dev servers.

## 1. Install and sign in

1. Download ngrok: https://ngrok.com/download  
2. Connect your account (one-time):

   ```bash
   ngrok config add-authtoken YOUR_AUTHTOKEN
   ```

   (Token is in the ngrok dashboard.)

## 2. Start your app locally

- **Django** on port **8000** (required for admin + API):

  ```bash
  cd backend
  .\venv\Scripts\python.exe manage.py runserver 0.0.0.0:8000
  ```

- **Next.js** on **3000** (optional; see below):

  ```bash
  cd frontend
  npm run dev
  ```

Or use repo **`run.bat`** (already binds `0.0.0.0`).

## 3. Open the tunnel to Django

In another terminal:

```bash
ngrok http 8000
```

In the ngrok UI you’ll see **Forwarding**, for example:

```text
https://a1b2c3d4.ngrok-free.app -> http://localhost:8000
```

That **`https://a1b2c3d4.ngrok-free.app`** is your public URL.

### Use it

| What | URL |
|------|-----|
| Super admin / Django UI | `https://YOUR-SUBDOMAIN.ngrok-free.app/super-admin/` |
| API base | `https://YOUR-SUBDOMAIN.ngrok-free.app/api/v1/` |

With **`DJANGO_DEBUG=true`**, this project already sets `ALLOWED_HOSTS = ['*']`, `CORS_ALLOW_ALL_ORIGINS`, and `CSRF_TRUSTED_ORIGINS` patterns for **`https://*.ngrok-free.app`** (and other ngrok domains). If CSRF still complains after an ngrok upgrade, add your exact URL to **`backend/.env`**:

```env
DJANGO_DEV_CSRF_ORIGINS=https://YOUR-SUBDOMAIN.ngrok-free.app
```

## 4. Next.js using the same ngrok API

If you open **Next** at `http://localhost:3000` but the **API** is only exposed via ngrok, set in **`frontend/.env.local`**:

```env
NEXT_PUBLIC_API_BASE_URL=https://YOUR-SUBDOMAIN.ngrok-free.app/api/v1
```

Restart `npm run dev` after changing env.

### Optional: second tunnel for the frontend

```bash
ngrok http 3000
```

Then set:

```env
NEXT_PUBLIC_API_BASE_URL=https://BACKEND-SUBDOMAIN.ngrok-free.app/api/v1
FRONTEND_URL=https://FRONTEND-SUBDOMAIN.ngrok-free.app
```

(`FRONTEND_URL` in **`backend/.env`** is used for some redirects/links.)

## 5. ngrok free warning page

Browsers may show an interstitial (“Visit Site”). For **API** calls from code, you can send:

`ngrok-skip-browser-warning: true`

(Usually not needed for normal browser use after one click-through.)

## 6. Alternatives (same idea)

- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) (`cloudflared`)  
- [localhost.run](https://localhost.run/) (SSH-based)

You’ll still need to add their HTTPS origins to **`DJANGO_DEV_CSRF_ORIGINS`** (and `ALLOWED_HOSTS` / CORS when `DEBUG=false`) if they’re not covered by defaults.

## Security

These URLs expose your **dev** server to the internet. Use **`DJANGO_DEBUG=true`** only for trusted testing; prefer **short-lived tunnels** and **rotate** ngrok URLs. Do not use this for real customer data without hardening.
