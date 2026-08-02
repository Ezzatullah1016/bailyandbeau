# Bailey & Beau — production access (URLs & sign-in)

**Audience:** client / stakeholder handoff  
**Last updated:** 2026-05-07

**Production hostnames:** Parent app and staff tools use **`reading-room.baileyandbeauco.com`**. JSON API uses **`api.reading-room.baileyandbeauco.com`**. Point both DNS records at the application server and terminate TLS there (e.g. Let’s Encrypt).

---

## Credentials & URLs for testing

Use **username** (not email) in the **frontend** login form; Django **Admin / Super Admin** also use **username** by default.

| Environment | Surface | Purpose | Sign-in URL | Username | Password |
|-------------|---------|---------|-------------|----------|----------|
| **Production** | **Frontend** (parents) | App UI: dashboard, sessions, library | https://reading-room.baileyandbeauco.com/login | `demo-parent` | `Demo123!` |
| **Production** | **Frontend** (parents, QA account) | Heavier quotas for review / UAT *(only if `seed_client_review_user` ran on server)* | https://reading-room.baileyandbeauco.com/login | `client-review` | `BaileyBeauReview2026!` |
| **Production** | **Backend staff** — Django Admin | Model-level admin (`/admin/`) | https://reading-room.baileyandbeauco.com/admin/login/ | `admin` | `Admin123!` |
| **Production** | **Backend staff** — Super Admin UI | Operational dashboards (`/staff/…`) | https://reading-room.baileyandbeauco.com/admin/login/ *(then open Super Admin links)* | `admin` | `Admin123!` |
| **Production** | **Backend API** | JSON API — Postman, scripts, or the frontend bundle | *No interactive login page* — `POST https://api.reading-room.baileyandbeauco.com/api/v1/auth/login/` with JSON body | Same as parent row above | Same as parent row above |

**API base URL (production):** `https://api.reading-room.baileyandbeauco.com/api/v1`  

**Health check (no auth):** `https://api.reading-room.baileyandbeauco.com/api/v1/health/`  

**Alternate staff entry (same backend):** If nginx is configured on the API host, staff pages may also be reachable at `https://api.reading-room.baileyandbeauco.com/admin/login/` — prefer the **reading-room** hostname for a single origin with the Next.js app unless your team standardizes on the API host.

---

## Local development

| Surface | URL | Username | Password |
|---------|-----|----------|----------|
| Frontend | http://127.0.0.1:3000/login | `demo-parent` | `Demo123!` |
| Django Admin / Super Admin | http://127.0.0.1:8000/admin/login/ | `admin` | `Admin123!` |
| API base | http://127.0.0.1:8000/api/v1 | *(JWT via `/auth/login/`)* | *(same as parent row)* |

- Create demo books and accounts: `python manage.py seed_demo_data`
- Create or reset `client-review`: `python manage.py seed_client_review_user`

---

## Security notice

These passwords match the **seed management commands** in the repo and are appropriate for **sandbox / UAT** only.

- Rotate or restrict `admin`, `demo-parent`, and `client-review` before wider production use.
- For client handoffs, prefer password-manager shares instead of plaintext email.

---

## 1. Parent-facing frontend (Next.js)

| Item | Detail |
|------|--------|
| **Application URL** | https://reading-room.baileyandbeauco.com/ |
| **Sign-in** | https://reading-room.baileyandbeauco.com/login |
| **Purpose** | Parent experience: onboarding, dashboard, sessions, billing, library, settings |
| **Authentication** | Username and password → JWT auth against the production API |

**TLS:** Use a valid certificate on **`reading-room.baileyandbeauco.com`** once DNS points at the app server.

---

## 2. Backend API (REST)

| Item | Detail |
|------|--------|
| **API base URL** | https://api.reading-room.baileyandbeauco.com/api/v1 |
| **Health check (no login)** | https://api.reading-room.baileyandbeauco.com/api/v1/health/ |

**Purpose:** The Next.js app and future clients call this host for JSON APIs (for example `/auth/login/`, session and book endpoints).

Interactive parent login screens are hosted on the **frontend** (`/login` above); the API is used programmatically once tokens are obtained.

---

## 3. Staff / operations (Django Admin & Super Admin)

Staff users must have the **staff** flag in Django. **`reading-room.baileyandbeauco.com`** serves the Next.js app and proxies `/admin/` and `/staff/` to Django (same pattern as a bare EC2 IP host previously used for UAT).

| Item | URL |
|------|-----|
| **Django Admin (classic)** | https://reading-room.baileyandbeauco.com/admin/ |
| **Staff sign-in** | https://reading-room.baileyandbeauco.com/admin/login/ |
| **Super Admin home** | https://reading-room.baileyandbeauco.com/staff/dashboard/ |

**Common Super Admin shortcuts** (staff only; unauthenticated visits redirect to sign-in):

| Area | URL |
|------|-----|
| Dashboard | https://reading-room.baileyandbeauco.com/staff/dashboard/ |
| Sessions | https://reading-room.baileyandbeauco.com/staff/sessions/ |
| Live sessions | https://reading-room.baileyandbeauco.com/staff/live-sessions/ |
| Book library | https://reading-room.baileyandbeauco.com/staff/books/ |

---

## 4. Custom credentials checklist

For **non-demo** accounts, record here or in your vault (not in open email):

| Role | Username / email | Password / OTP |
|------|-------------------|----------------|
| Parent (test account) | *{via 1Password}* | *{separate channel}* |
| Staff / Super Admin | *{via 1Password}* | *{separate channel}* |

---

## 5. If something fails

Gather and send:

- Exact URL copied from the browser address bar  
- Time (with timezone)  
- Whether the issue occurs on frontend, API, or admin  
- Browser name and approximate version  

**Contact:** *{delivery lead email / Slack}*

---

## 6. When DNS or infrastructure changes

- **`reading-room.baileyandbeauco.com`:** Update A/CNAME to the current app load balancer or EC2 public IP; re-issue or redeploy TLS as needed.  
- **`api.reading-room.baileyandbeauco.com`:** Keep this pointed at the same stack (or edge) that serves `/api/v1`; update Django `ALLOWED_HOSTS`, CORS, and CSRF if the hostname set changes.

---

_Document maintained by Bailey & Beau project team._
