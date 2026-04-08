# Bailey & Beau Django Project

A Django + DRF MVP backend scaffold for the Bailey & Beau platform.

## Setup

The project uses a local virtual environment in `.venv`.

## Run the server

```powershell
& ".\.venv\Scripts\python.exe" manage.py migrate
& ".\.venv\Scripts\python.exe" manage.py runserver
```

Then open `http://127.0.0.1:8000/`.

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

## Environment template

Copy `.env.example` values into your deployment environment for:
- Django secret/debug/hosts
- PostgreSQL connection settings
- email backend settings
- Stripe and LiveKit credentials

## Prepared project paths

- `/` — home page
- `/admin/` — Django admin
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

## Notes

This run completes the local MVP backend scaffold. Real production-only integrations such as LiveKit token signing, Stripe signature verification, email delivery workers, PostgreSQL deployment, and a frontend UI would require additional setup beyond this single local run.
