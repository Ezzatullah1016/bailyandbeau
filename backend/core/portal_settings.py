"""Effective operational settings: portal DB row overrides Django env/settings."""

from django.conf import settings as dj_settings

from core.models import PortalSettings


def _portal():
    return PortalSettings.get_solo()


def effective_platform_name():
    return ((_portal().platform_name or "").strip()) or "Bailey & Beau"


def effective_support_email():
    v = (_portal().support_email or "").strip()
    return v or getattr(dj_settings, "SUPPORT_EMAIL", "support@baileyandbeau.local")


def effective_default_from_email():
    v = (_portal().default_from_email or "").strip()
    return v or getattr(dj_settings, "DEFAULT_FROM_EMAIL", "no-reply@baileyandbeau.local")


def effective_public_base_url(request=None):
    p = _portal()
    u = (p.public_base_url or "").strip().rstrip("/")
    if u:
        return u
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    fe = getattr(dj_settings, "FRONTEND_URL", "") or ""
    return fe.rstrip("/") or "http://localhost:3000"


def effective_stripe_secret_key():
    v = (_portal().stripe_secret_key or "").strip()
    return v or getattr(dj_settings, "STRIPE_SECRET_KEY", "")


def effective_stripe_webhook_secret():
    v = (_portal().stripe_webhook_secret or "").strip()
    return v or getattr(dj_settings, "STRIPE_WEBHOOK_SECRET", "")


def effective_livekit_api_key():
    v = (_portal().livekit_api_key or "").strip()
    return v or getattr(dj_settings, "LIVEKIT_API_KEY", "")


def effective_livekit_api_secret():
    v = (_portal().livekit_api_secret or "").strip()
    return v or getattr(dj_settings, "LIVEKIT_API_SECRET", "")


def effective_livekit_url():
    v = (_portal().livekit_url or "").strip()
    return v or getattr(dj_settings, "LIVEKIT_URL", "") or ""


def effective_session_timer_seconds():
    mins = _portal().default_session_duration_minutes or 20
    mins = max(1, min(480, int(mins)))
    return mins * 60


def effective_storage_plan_total_gb():
    total = _portal().storage_plan_total_gb or 50
    return max(1, min(10_000_000, int(total)))
