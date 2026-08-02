# Bailey & Beau Foundation Project

A Django + DRF backend plus a minimal Next.js frontend scaffold for the Bailey & Beau platform M1 milestone.

## Setup

The project uses a local virtual environment in `.venv`.

The frontend lives in `frontend/` and expects Node.js 20+.

## Run the server

```powershell
& ".\.venv\Scripts\python.exe" manage.py migrate
& ".\.venv\Scripts\python.exe" manage.py runserver
```

Then open `http://127.0.0.1:8000/`.

The URL **`/admin/`** redirects to the **super admin dashboard** (`/super-admin/dashboard/`). The stock **Django model admin** is mounted at **`/django-admin/`** if you need raw model CRUD.

## M1 foundation coverage

This repo now covers the M1 scope only:

- Django backend and database schema
- Auth endpoints and web auth screens
- LiveKit backend room and token wiring
- S3-ready storage configuration
- Next.js app-router frontend scaffold
- GitHub Actions CI baseline

## Run the Next.js frontend

Node.js is required locally for the frontend. It is not bundled with this repo.

```powershell
cd .\frontend
copy .env.local.example .env.local
npm install
npm run dev
```

Then open `http://127.0.0.1:3000/`.

The frontend expects the Django backend to already be running at `http://127.0.0.1:8000/`.

## Build Tailwind locally

Tailwind is installed locally through the standalone CLI binary in `tools/tailwindcss.exe`.

```powershell
.\tools\tailwindcss.exe -i .\core\static_src\tailwind.input.css -o .\core\static\core\css\tailwind.css --config .\tailwind.config.js --minify
```

Or use:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-tailwind.ps1
```

## Admin reference assets placement

If you want to add custom reference assets for the super admin UI, place them here:

- CSS: `core/static/core/css/`
- JavaScript: `core/static/core/js/`
- Images / icons: `core/static/core/images/`
- Source Tailwind layers: `core/static_src/`
- Shared Django templates: `core/templates/core/`

Then reference them in templates with Django static tags:

```django
{% load static %}
<link rel="stylesheet" href="{% static 'core/css/your-file.css' %}">
<script src="{% static 'core/js/your-file.js' %}"></script>
<img src="{% static 'core/images/your-image.png' %}" alt="...">
```

## Run tests

```powershell
& ".\.venv\Scripts\python.exe" manage.py test
```

## Send reminder emails

```powershell
& ".\.venv\Scripts\python.exe" manage.py send_reading_reminders
```

By default reminders use Django's console email backend locally.

## Seed demo data

```powershell
& ".\.venv\Scripts\python.exe" manage.py seed_demo_data
```

Local demo credentials created by the command:
- Admin: `admin` / `Admin123!`
- Parent demo user: `demo-parent` / `Demo123!`

### Client QA login (staging / production)

Create a dedicated account for external testers (same credentials every time; safe to reset the password in Django admin after review):

```powershell
& ".\.venv\Scripts\python.exe" manage.py seed_client_review_user
```

- **`client-review` / `BaileyBeauReview2026!`** — parent-style user with active entitlement for dashboard testing.

Run this once per deployed environment from the backend directory (after migrations). Share only with trusted reviewers and rotate the password when testing ends.

## Environment template

Copy `.env.example` values into your deployment environment for:
- Django secret/debug/hosts
- PostgreSQL connection settings
- email backend settings
- Stripe, LiveKit, S3, and frontend CORS settings

Relevant M1 frontend values:

- `NEXTJS_DEV_ORIGIN`
- `DJANGO_CORS_ALLOWED_ORIGINS`
- `DJANGO_CSRF_TRUSTED_ORIGINS`

## Prepared project paths

- `/` — home page
- `/login/` — public login and signup portal
- `/admin/` — redirects to super admin dashboard
- `/django-admin/` — Django model admin (users, groups, raw models)
- `/django-admin/login/` — themed Django admin sign-in
- `/super-admin/dashboard/` — super admin overview UI
- `/super-admin/sessions/` — session monitor UI
- `/super-admin/live-sessions/` — live session operations UI
- `/super-admin/books/` — book library admin UI
- `/super-admin/activities/` — activity config admin UI
- `/super-admin/users/` — user management admin UI
- `/super-admin/subscriptions/` — subscriptions & billing UI
- `/super-admin/badges/` — badge manager UI
- `/super-admin/logs/` — logs & errors UI
- `/super-admin/settings/` — settings UI
- `/api/v1/health/` — API health check
- `/api/v1/auth/register/`, `/api/v1/auth/login/`, `/api/v1/auth/refresh/`, `/api/v1/me/`
- `/api/v1/dashboard/`
- `/api/v1/books/`, `/api/v1/books/<uuid>/`, `/api/v1/books/<uuid>/activities/`
- `/api/v1/recommendations/books/`
- `/api/v1/badges/`
- `/api/v1/children/`, `/api/v1/children/<uuid>/`, `/api/v1/children/<uuid>/progress/`
- `/api/v1/library/favorites/`, `/api/v1/library/favorites/<uuid:book_id>/`
- `/api/v1/notifications/preferences/`
- `/api/v1/reminders/`, `/api/v1/reminders/<uuid>/`
- `/api/v1/billing/plans/`, `/api/v1/billing/entitlement/`, `/api/v1/billing/checkout-session/`
- `/api/v1/webhooks/stripe/`
- `/api/v1/sessions/`, `/api/v1/sessions/<uuid>/`
- `/api/v1/sessions/<uuid>/participants/`, `/api/v1/sessions/<uuid>/events/`
- `/api/v1/sessions/<uuid>/invite/`, `/api/v1/sessions/<uuid>/invite/regenerate/`
- `/api/v1/sessions/<uuid>/ready/`, `/api/v1/sessions/<uuid>/start/`, `/api/v1/sessions/<uuid>/cancel/`, `/api/v1/sessions/<uuid>/complete/`
- `/api/v1/sessions/<uuid>/snapshot/`, `/api/v1/sessions/<uuid>/reconnect-token/`
- `/api/v1/invites/<token>/join/`
- `/api/v1/admin/books/`, `/api/v1/admin/badges/`, `/api/v1/admin/activities/`
- `/api/v1/admin/sessions/`, `/api/v1/admin/sessions/export/`

Frontend scaffold paths:

- `/` in `frontend/` — landing page for the new web app
- `/login` in `frontend/` — API login handshake page
- `/dashboard` in `frontend/` — dashboard placeholder

## CI

GitHub Actions CI is defined in `.github/workflows/ci.yml` and runs:

- Django tests
- Next.js lint
- Next.js production build

## Notes

The backend remains the system of record for M1. The Next.js app is intentionally thin and exists to establish the frontend runtime, route structure, and backend integration path without expanding into later milestone product work.
