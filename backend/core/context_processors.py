from .models import ReadingSession, SessionEvent, Entitlement


def admin_sidebar_counters(request):
    """Inject live_session_count and error_count into every template context."""
    if not request.user.is_authenticated or not request.user.is_staff:
        return {}
    try:
        live_session_count = ReadingSession.objects.filter(
            status__in=[ReadingSession.Status.ACTIVE, ReadingSession.Status.RECONNECTING, ReadingSession.Status.LOBBY]
        ).count()
        error_count = (
            SessionEvent.objects.filter(event_type=SessionEvent.EventType.CANCELLED).count() +
            SessionEvent.objects.filter(event_type=SessionEvent.EventType.RECONNECTED).count() +
            Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.PAST_DUE).count()
        )
        return {
            "live_session_count": live_session_count or 0,
            "error_count": error_count or 0,
        }
    except Exception:
        return {"live_session_count": 0, "error_count": 0}
