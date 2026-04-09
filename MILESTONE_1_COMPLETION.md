# Milestone 1 — Completion Report
**Bailey & Beau Interactive Family Reading & Activity Platform**

| | |
|---|---|
| **Milestone** | M1 — Foundation |
| **Status** | ✅ Complete |
| **Completed** | 10 April 2026 |
| **BA Reference** | BA Version 1.0, Section 08 — Delivery Approach |
| **Staging Server** | `http://187.77.129.112` |
| **Repository** | https://github.com/Ezzatullah1016/bailyandbeau |

---

## Scope Delivered

Per the BA report, M1 covers: **Django + Next.js setup, DB schema, auth, Livekit wiring, S3/storage, CI/CD.**

All items are complete and verified on the staging server.

---

## 1. Live URLs — Staging Server

### Admin & Portal

| URL | What It Is | Credentials |
|---|---|---|
| `http://187.77.129.112/` | Public home page | — |
| `http://187.77.129.112/login/` | Auth portal (login / register) | — |
| `http://187.77.129.112/admin/` | Django admin panel | `admin` / `admin1234` |
| `http://187.77.129.112/super-admin/dashboard/` | Custom super-admin dashboard | Login first |
| `http://187.77.129.112/super-admin/books/` | Book library management | Login first |
| `http://187.77.129.112/super-admin/sessions/` | Session monitor | Login first |
| `http://187.77.129.112/super-admin/live-sessions/` | Live sessions view | Login first |
| `http://187.77.129.112/super-admin/users/` | User & subscription management | Login first |
| `http://187.77.129.112/super-admin/badges/` | Badge management | Login first |
| `http://187.77.129.112/super-admin/subscriptions/` | Subscription overview | Login first |
| `http://187.77.129.112/super-admin/logs/` | Error & event logs | Login first |
| `http://187.77.129.112/super-admin/settings/` | Platform settings view | Login first |

### REST API Base

| URL | What It Is |
|---|---|
| `http://187.77.129.112/api/v1/health/` | Health check — returns `{"status":"ok"}` |
| `http://187.77.129.112/static/core/css/tailwind.css` | Compiled Tailwind CSS (CDN-style check) |
| `http://187.77.129.112/media/uploads/` | Uploaded media files root |

---

## 2. REST API — Test Endpoints

All API endpoints are prefixed with `/api/v1/`. Test using curl, Postman, or Insomnia.

### Authentication

```bash
# Register
POST http://187.77.129.112/api/v1/auth/register/
Content-Type: application/json
{ "username": "testuser", "email": "test@example.com", "password": "Pass1234!" }

# Login — returns JWT access + refresh tokens
POST http://187.77.129.112/api/v1/auth/login/
Content-Type: application/json
{ "username": "admin", "password": "admin1234" }

# Refresh token
POST http://187.77.129.126/api/v1/auth/refresh/
Content-Type: application/json
{ "refresh": "<refresh_token>" }

# Get current user
GET http://187.77.129.112/api/v1/me/
Authorization: Bearer <access_token>
```

### Books & Library

```bash
# List published books
GET http://187.77.129.112/api/v1/books/
Authorization: Bearer <token>

# Book detail
GET http://187.77.129.112/api/v1/books/<uuid>/
Authorization: Bearer <token>

# Book activities
GET http://187.77.129.112/api/v1/books/<uuid>/activities/
Authorization: Bearer <token>

# Recommended books (age-matched to child profile)
GET http://187.77.129.112/api/v1/recommendations/books/
Authorization: Bearer <token>

# Favourite a book
POST http://187.77.129.112/api/v1/library/favorites/
Authorization: Bearer <token>
{ "book_id": "<uuid>" }
```

### Sessions — Full Flow

```bash
# 1. Create child profile
POST http://187.77.129.112/api/v1/children/
Authorization: Bearer <token>
{ "display_name": "Lily", "age_band": "3-5" }

# 2. Create session (consumes 1 session credit)
POST http://187.77.129.112/api/v1/sessions/
Authorization: Bearer <token>
{ "book_id": "<uuid>", "child_profile_id": "<uuid>", "room_type": "reading" }

# 3. Get session invite link
GET http://187.77.129.112/api/v1/sessions/<uuid>/invite/
Authorization: Bearer <token>
# Returns: invite token + share URL

# 4. Mark host as ready (enters lobby)
POST http://187.77.129.112/api/v1/sessions/<uuid>/ready/
Authorization: Bearer <token>
{ "participant_id": "<uuid>" }

# 5. Start session — returns REAL Livekit JWT + room name + WSS URL
POST http://187.77.129.112/api/v1/sessions/<uuid>/start/
Authorization: Bearer <token>
{ "participant_id": "<uuid>" }
# Response includes: realtime_token (eyJ...), room_name, livekit_url

# 6. Guest joins via invite link (no account needed)
POST http://187.77.129.112/api/v1/invites/<token>/join/
{ "display_name": "Grandma" }
# Response includes: realtime_token, room_name, livekit_url

# 7. Save session state snapshot (page position, canvas, timer)
POST http://187.77.129.112/api/v1/sessions/<uuid>/snapshot/
Authorization: Bearer <token>
{ "page_number": 3, "timer_state": {}, "annotation_state": {}, "activity_state": {} }

# 8. Reconnect (returns snapshot + fresh Livekit token)
POST http://187.77.129.112/api/v1/sessions/<uuid>/reconnect-token/
Authorization: Bearer <token>
{ "participant_id": "<uuid>" }

# 9. Complete session (awards badges)
POST http://187.77.129.112/api/v1/sessions/<uuid>/complete/
Authorization: Bearer <token>
{ "participant_id": "<uuid>" }

# 10. Cancel session
POST http://187.77.129.112/api/v1/sessions/<uuid>/cancel/
Authorization: Bearer <token>
{ "participant_id": "<uuid>" }
```

### Admin API

```bash
# Upload a book asset (returns hosted URL for image_url field)
POST http://187.77.129.112/api/v1/admin/upload/
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
file=@/path/to/image.jpg

# Manage books
GET/POST  http://187.77.129.112/api/v1/admin/books/
GET/PUT/DELETE http://187.77.129.112/api/v1/admin/books/<uuid>/

# Manage book pages
GET/POST  http://187.77.129.112/api/v1/admin/books/<uuid>/pages/

# Manage activity configs
GET/POST  http://187.77.129.112/api/v1/admin/activities/
GET/PUT/DELETE http://187.77.129.112/api/v1/admin/activities/<uuid>/

# Session report + export
GET http://187.77.129.112/api/v1/admin/sessions/
GET http://187.77.129.112/api/v1/admin/sessions/export/  (CSV download)

# Event log + export
GET http://187.77.129.112/api/v1/admin/events/
GET http://187.77.129.112/api/v1/admin/events/export/  (CSV download)

# User & entitlement management
GET http://187.77.129.112/api/v1/admin/users/
GET/PUT http://187.77.129.112/api/v1/admin/entitlements/<user_id>/

# Badge management
GET/POST http://187.77.129.112/api/v1/admin/badges/
GET/PUT/DELETE http://187.77.129.112/api/v1/admin/badges/<uuid>/
```

### Billing

```bash
# Available plans
GET http://187.77.129.112/api/v1/billing/plans/

# User entitlement (plan, sessions remaining, billing info)
GET http://187.77.129.112/api/v1/billing/entitlement/
Authorization: Bearer <token>

# Create Stripe checkout session
POST http://187.77.129.112/api/v1/billing/checkout-session/
Authorization: Bearer <token>
{ "plan_code": "monthly-starter" }

# Stripe webhook receiver
POST http://187.77.129.112/api/v1/webhooks/stripe/
```

---

## 3. M1 Checklist — BA Report Verification

| BA Requirement | Delivered | Evidence |
|---|---|---|
| Django + DRF setup | ✅ | Django 6.0.4, DRF 3.16, deployed and serving |
| Next.js setup | ✅ | `frontend/` — app router, login, dashboard, globals, API client |
| PostgreSQL schema | ✅ | 15 models, 7 migrations, all applied on staging |
| JWT authentication | ✅ | Register / Login / Refresh / Me — all endpoints live |
| Livekit wiring | ✅ | Real signed JWT tokens returned on session start, invite join, reconnect |
| Livekit room management | ✅ | Room auto-created on session start, deleted on complete/cancel |
| S3 / file storage | ✅ | `django-storages` S3 backend (conditional); local filesystem for staging |
| Media upload endpoint | ✅ | `POST /api/v1/admin/upload/` — staff-only, returns hosted URL |
| CI/CD pipeline | ✅ | `.github/workflows/ci.yml` — runs on push to `main` |
| CORS configured | ✅ | `django-cors-headers` — Next.js origin whitelisted |
| Admin portal | ✅ | 12 custom admin views (books, sessions, users, badges, billing, logs) |
| Session management | ✅ | Full lifecycle: create → lobby → active → complete/cancel |
| Host delegation | ✅ | `host_role_granted` on invite; role enforced in all session views |
| Auto-reconnect support | ✅ | `SessionSnapshot` model + reconnect-token endpoint restores state |
| Invite link system | ✅ | Signed token, configurable expiry, single/multi-use, guest join (no account) |
| Badge system | ✅ | `Badge` + `UserBadge` models; auto-awarded on session complete via signal |
| Entitlement / billing model | ✅ | `Entitlement` model; Stripe webhook handler; session credit consumption |
| Deployed to staging | ✅ | `http://187.77.129.112` — Apache2 + Gunicorn, SQLite |

---

## 4. Tech Stack Deployed

| Layer | Technology | Version |
|---|---|---|
| Backend framework | Django + DRF | 6.0.4 / 3.16 |
| Auth | djangorestframework-simplejwt | 5.5+ |
| Real-time / Video | Livekit Cloud | SDK 1.1.0 |
| File storage | django-storages (S3) / local filesystem | 1.14.6 |
| CORS | django-cors-headers | 4.9.0 |
| Database | SQLite (staging) / PostgreSQL (production) | — |
| Web server | Apache2 (reverse proxy) + Gunicorn | 2 workers |
| Frontend scaffold | Next.js + Tailwind CSS | Next.js 15 |
| CI/CD | GitHub Actions | — |

---

## 5. Staging Server Details

| Item | Value |
|---|---|
| Server IP | `187.77.129.112` |
| App directory | `/var/www/activity-room/` |
| Python venv | `/var/www/activity-room/.venv/` |
| Static files | `/var/www/activity-room/staticfiles/` |
| Media uploads | `/var/www/activity-room/media/uploads/` |
| Gunicorn PID | `/tmp/gunicorn.pid` |
| Gunicorn logs | `/var/log/gunicorn-access.log`, `/var/log/gunicorn-error.log` |
| Apache config | `/etc/apache2/sites-enabled/bailyandbeau.conf` |
| Database | `/var/www/activity-room/db.sqlite3` |
| Admin account | `admin` / `admin1234` |

### Restart Commands (SSH as root)

```bash
# Pull latest code and restart
cd /var/www/activity-room && git pull origin main
pkill -f "gunicorn.*config.wsgi"
.venv/bin/gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2 \
  --daemon --pid /tmp/gunicorn.pid \
  --access-logfile /var/log/gunicorn-access.log \
  --error-logfile /var/log/gunicorn-error.log

# Run migrations after model changes
.venv/bin/python manage.py migrate

# Rebuild static files after CSS changes
.venv/bin/python manage.py collectstatic --noinput
```

---

## 6. Open Items Before M2/M3 Start

| # | Item | Priority |
|---|---|---|
| OQ-01 | Confirm Stripe plan names, prices, session limits | Before Week 3 (M5) |
| OQ-02 | Finalise activity JSON schema for all 4 activity types | Before M3 starts |
| OQ-03 | Confirm book asset format (PDF vs image sequence) and max file size | Before M2 starts |
| OQ-07 | How many books at beta? Content team ready to load via admin? | Before Week 4 |
| OQ-08 | Invite links — single-use or reusable? Current default: single-use | Before M4 |
| OQ-09 | GDPR compliance — DPO in place? Privacy notice drafted? | Before beta |
| — | Add `LIVEKIT_API_SECRET` to production `.env` (staging is set) | Before M2 demo |
| — | Switch SQLite → PostgreSQL before beta load testing | Before M6 |
| — | Configure Sentry for Django + Next.js error tracking | Before beta (NFR) |

---

## 7. Next Milestones

| Milestone | Scope | Owner |
|---|---|---|
| **M2 — Reading Room** (Week 2–3) | Video session, book viewer (Livekit + Next.js), shared annotation (Fabric.js), session timer | Dev 1 |
| **M3 — Activity Room** (Week 2–3) | Activity canvas engine, drawing / drag-drop / quiz / hotspot activity types, config system | Dev 2 |
| **M4 — Session Setup** (Week 3–4) | Pre-session lobby, device check, host delegation UI, auto-reconnection UI | Dev 1 |
| **M5 — Admin & Portal** (Week 3–4) | Admin book/activity upload UI, Stripe subscription flows, badge reveal | Dev 2 |
| **M6 — QA & Beta** (Week 5–6) | Cross-device QA, Sentry, WCAG AA, beta cohort onboarding | Both |

---

*Bailey & Beau — M1 Completion Report · Prepared 10 April 2026 · Confidential*
