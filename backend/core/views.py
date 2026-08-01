import json
import secrets
from urllib.parse import parse_qs, unquote, urlencode, urlparse

from django.conf import settings as django_settings
from django.contrib import messages
from django.core.exceptions import ValidationError
from django.contrib.admin.views.decorators import staff_member_required as _django_staff_member_required
from django.contrib.auth import get_user_model, login as auth_login, logout as auth_logout
from django.core.files.storage import default_storage
from django.db.models import Count, Max, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils.dateparse import parse_date
from django.utils import timezone
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.text import slugify

from .models import (
    ActivityConfig,
    Badge,
    Book,
    BookPage,
    ChildProfile,
    Entitlement,
    UserProfile,
    PortalSettings,
    ReadingReminder,
    ReadingSession,
    SessionEvent,
    SessionInvite,
    SessionParticipant,
    UserBadge,
)
from . import portal_settings as portal_conf
from .serializers import ActivityConfigSerializer, BookSerializer, LoginSerializer, RegisterSerializer

User = get_user_model()


def staff_member_required(view_func):
    """Like Django's, but unauthenticated/non-staff users go to our portal login.

    Redirect to ``super_admin_login`` (/super-admin/login/), which nginx routes to
    Django. The bare ``/login`` path is served by the Next.js customer app, so
    sending staff there would land them on the customer sign-in page.
    """
    return _django_staff_member_required(login_url="super_admin_login")(view_func)


def redirect_admin_root(request):
    """Public ``/admin/`` opens the custom super admin dashboard instead of Django admin."""
    return redirect("super_admin_dashboard")


def redirect_admin_to_django_admin(request, path):
    """Legacy ``/admin/...`` URLs (e.g. bookmarks) forward to ``/django-admin/...``."""
    target = f"/django-admin/{path}"
    qs = request.META.get("QUERY_STRING", "")
    if qs:
        target = f"{target}?{qs}"
    return redirect(target)


def _normalize_cover_image_url(raw_url):
    """Convert common pasted search URLs into a direct image URL."""
    url = (raw_url or "").strip()
    if not url:
        return ""

    if url.startswith("//"):
        return f"https:{url}"

    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc and "google." in parsed.netloc:
        params = parse_qs(parsed.query)
        for key in ("imgurl", "mediaurl", "url", "q"):
            candidate = (params.get(key) or [""])[0].strip()
            if not candidate:
                continue
            decoded = unquote(candidate)
            decoded_parsed = urlparse(decoded)
            if decoded_parsed.scheme in {"http", "https"} and decoded_parsed.netloc:
                return decoded

    # Generic fallback: some search engines wrap target links in `url=...`.
    params = parse_qs(parsed.query)
    wrapped_url = (params.get("url") or [""])[0].strip()
    if wrapped_url:
        decoded = unquote(wrapped_url)
        decoded_parsed = urlparse(decoded)
        if decoded_parsed.scheme in {"http", "https"} and decoded_parsed.netloc:
            return decoded

    return url


def home(request):
    # Staff entry point: the backend root lands on the super-admin dashboard.
    # Unauthenticated users hit staff_member_required there and are sent to /login.
    if request.user.is_authenticated and not request.user.is_staff:
        # Customer accounts have no Django UI — send them to the app frontend.
        return redirect(getattr(django_settings, "FRONTEND_URL", "") or reverse("login"))
    return redirect("super_admin_dashboard")


def logout_view(request):
    """Log out of the staff portal and return to the login screen (not Django's logged-out page)."""
    auth_logout(request)
    return redirect("super_admin_login")


def _auth_redirect_target(request, user=None):
    default_target = reverse("super_admin_dashboard") if user and user.is_staff else reverse("home")
    candidate = request.POST.get("next") or request.GET.get("next") or default_target

    if candidate in {"/login", "/login/", "/super-admin/login/",
                     reverse("login"), reverse("super_admin_login")}:
        candidate = default_target

    if candidate and url_has_allowed_host_and_scheme(
        candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        if user and not user.is_staff and candidate.startswith("/super-admin"):
            return reverse("home")
        return candidate

    return default_target


def auth_portal(request):
    if request.user.is_authenticated:
        return redirect(_auth_redirect_target(request, request.user))

    active_tab = "signup" if request.GET.get("tab") == "signup" else "login"
    next_url = _auth_redirect_target(request)
    login_error = None
    signup_errors = {}
    login_values = {"username": ""}
    signup_values = {
        "first_name": "",
        "last_name": "",
        "username": "",
        "email": "",
    }

    if request.method == "POST":
        action = request.POST.get("action", "login")
        next_url = _auth_redirect_target(request)

        if action == "login":
            active_tab = "login"
            identifier = request.POST.get("username", "").strip()
            password = request.POST.get("password", "")
            login_values["username"] = identifier

            lookup_username = identifier
            if "@" in identifier:
                matched_user = User.objects.filter(email__iexact=identifier).first()
                if matched_user:
                    lookup_username = matched_user.username

            serializer = LoginSerializer(data={"username": lookup_username, "password": password})
            if serializer.is_valid():
                user = serializer.validated_data["user"]
                auth_login(request, user)
                return redirect(_auth_redirect_target(request, user))

            login_error = serializer.errors.get("non_field_errors", ["Invalid username, email, or password."])[0]

        elif action == "signup":
            active_tab = "signup"
            signup_values = {
                "first_name": request.POST.get("first_name", "").strip(),
                "last_name": request.POST.get("last_name", "").strip(),
                "username": request.POST.get("username", "").strip(),
                "email": request.POST.get("email", "").strip(),
            }
            password = request.POST.get("password", "")
            confirm_password = request.POST.get("confirm_password", "")

            payload = {**signup_values, "password": password}
            serializer = RegisterSerializer(data=payload)
            serializer.is_valid()
            signup_errors = {
                key: value[0] if isinstance(value, list) else value
                for key, value in serializer.errors.items()
            }

            if not signup_values["first_name"]:
                signup_errors["first_name"] = "First name is required."
            if not signup_values["last_name"]:
                signup_errors["last_name"] = "Last name is required."
            if password != confirm_password:
                signup_errors["confirm_password"] = "Passwords do not match."

            if not signup_errors:
                user = serializer.save()
                Entitlement.objects.get_or_create(user=user)
                auth_login(request, user)
                messages.success(request, "Your Bailey & Beau account is ready.")
                return redirect(_auth_redirect_target(request, user))

    context = {
        "active_tab": active_tab,
        "next_url": next_url,
        "login_error": login_error,
        "signup_errors": signup_errors,
        "login_values": login_values,
        "signup_values": signup_values,
    }
    return render(request, "core/auth_portal.html", context)


def _status_tone(status_value):
    return {
        ReadingSession.Status.ACTIVE: "bg-emerald-100 text-emerald-700",
        ReadingSession.Status.COMPLETED: "bg-sky-100 text-sky-700",
        ReadingSession.Status.CANCELLED: "bg-rose-100 text-rose-700",
        ReadingSession.Status.RECONNECTING: "bg-violet-100 text-violet-700",
        ReadingSession.Status.LOBBY: "bg-indigo-100 text-indigo-700",
        ReadingSession.Status.PENDING: "bg-amber-100 text-amber-700",
        ReadingSession.Status.EXPIRED: "bg-slate-200 text-slate-700",
    }.get(status_value, "bg-slate-100 text-slate-700")


def _session_duration_label(session):
    if session.started_at and session.ended_at:
        total_seconds = max(int((session.ended_at - session.started_at).total_seconds()), 0)
        minutes = total_seconds // 60
        return f"{minutes}m" if minutes else "<1m"
    if session.status == ReadingSession.Status.ACTIVE:
        return "Live"
    return "—"


def _session_guest_name(session):
    for participant in session.participants.all():
        if participant.session_role != SessionParticipant.SessionRole.HOST:
            return participant.display_name
    return "Awaiting guest"


def _average_completed_session_minutes():
    sessions = ReadingSession.objects.filter(started_at__isnull=False, ended_at__isnull=False)
    count = sessions.count()
    if not count:
        return 0
    total_seconds = sum(max(int((session.ended_at - session.started_at).total_seconds()), 0) for session in sessions)
    return round((total_seconds / count) / 60)


def _build_session_rows(sessions):
    rows = []
    for session in sessions:
        started = session.started_at or session.created_at
        rows.append(
            {
                "id": str(session.id),
                "short_id": str(session.id)[:8].upper(),
                "book_title": session.target_title,
                "child_name": session.child_profile.display_name,
                "host_name": session.created_by.get_full_name() or session.created_by.username,
                "guest_name": _session_guest_name(session),
                "status": session.get_status_display(),
                "status_tone": _status_tone(session.status),
                "duration": _session_duration_label(session),
                "started_display": timezone.localtime(started).strftime("%d %b %Y %I:%M %p") if started else "—",
                "room_type": session.get_room_type_display(),
            }
        )
    return rows


def _build_user_rows(users):
    rows = []
    for user in users:
        entitlement = getattr(user, "entitlement", None)
        sessions_left = 0
        sessions_used = 0
        plan_code = "Free"
        status_label = "Free"
        status_tone = "bg-slate-100 text-slate-700"

        if entitlement:
            sessions_left = entitlement.sessions_remaining + entitlement.pack_sessions_remaining
            sessions_used = max(entitlement.sessions_included - entitlement.sessions_remaining, 0)
            plan_code = entitlement.plan_code or "Unassigned"
            status_label = entitlement.get_subscription_status_display()
            status_tone = {
                Entitlement.SubscriptionStatus.ACTIVE: "bg-emerald-100 text-emerald-700",
                Entitlement.SubscriptionStatus.PAST_DUE: "bg-amber-100 text-amber-700",
                Entitlement.SubscriptionStatus.CANCELLED: "bg-rose-100 text-rose-700",
                Entitlement.SubscriptionStatus.NONE: "bg-slate-100 text-slate-700",
            }.get(entitlement.subscription_status, "bg-slate-100 text-slate-700")

        rows.append(
            {
                "id": user.id,
                "name": user.get_full_name() or user.username,
                "email": user.email,
                "plan_code": plan_code,
                "sessions_used": sessions_used,
                "sessions_left": sessions_left,
                "status_label": status_label,
                "status_tone": status_tone,
                "joined_at": user.date_joined,
                "children_count": user.child_profiles.filter(is_active=True).count(),
                "session_count": user.created_sessions.count(),
            }
        )
    return rows


def _percentage(part, whole):
    """Return a safe integer percentage for template progress bars."""
    return int(round((part / whole) * 100)) if whole else 0


def _plan_price(plan_code):
    """Infer a simple monthly price from a plan code for admin reporting cards."""
    code = (plan_code or "").lower()
    if "annual" in code:
        return 20
    if "pack" in code or "unlimited" in code:
        return 24
    if "plus" in code or "pro" in code:
        return 14
    if "starter" in code or "basic" in code or "essential" in code:
        return 8
    return 0


def _format_relative_time(moment):
    """Present short relative timestamps such as '2h ago' for dashboard cards."""
    if not moment:
        return "—"
    delta = timezone.now() - moment
    seconds = max(int(delta.total_seconds()), 0)
    if seconds < 60:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    if days == 1:
        return "yesterday"
    return f"{days}d ago"


def _mask_secret(value, visible=4):
    """Hide sensitive configuration values before rendering them in admin settings."""
    if not value:
        return "Not configured"
    if len(value) <= visible:
        return value
    return f"{value[:visible]}{'•' * 8}"


def _build_subscription_rows(entitlements):
    rows = []
    for entitlement in entitlements:
        price = _plan_price(entitlement.plan_code)
        user = entitlement.user
        rows.append(
            {
                "user_id": str(user.id),
                "user_name": user.get_full_name() or user.username,
                "user_email": user.email,
                "plan_code": entitlement.plan_code or "Free",
                "amount": price,
                "amount_display": f"${price:.2f}" if price else "—",
                "status_label": entitlement.get_subscription_status_display(),
                "status_tone": {
                    Entitlement.SubscriptionStatus.ACTIVE: "bg-emerald-100 text-emerald-800",
                    Entitlement.SubscriptionStatus.PAST_DUE: "bg-rose-100 text-rose-800",
                    Entitlement.SubscriptionStatus.CANCELLED: "bg-slate-200 text-slate-700",
                    Entitlement.SubscriptionStatus.NONE: "bg-amber-100 text-amber-800",
                }.get(entitlement.subscription_status, "bg-slate-100 text-slate-700"),
                "next_renewal": entitlement.renewal_date,
                "stripe_id": entitlement.stripe_subscription_id or f"sub_{str(entitlement.id)[:8]}",
                "event_label": entitlement.last_webhook_event or entitlement.get_subscription_status_display(),
                "updated_at": entitlement.updated_at,
            }
        )
    return rows


def _build_live_session_cards(sessions):
    rows = []
    for session in sessions:
        host_name = session.created_by.get_full_name() or session.created_by.username
        guest_name = _session_guest_name(session)
        latest_event = session.events.order_by("-created_at").first()
        latest_note = latest_event.get_event_type_display() if latest_event else "Live session in progress"
        if latest_event and latest_event.payload:
            latest_note = latest_event.payload.get("message") or latest_event.payload.get("note") or latest_note

        started = session.started_at or session.created_at
        elapsed_seconds = max(int((timezone.now() - started).total_seconds()), 0) if started else 0
        rows.append(
            {
                "id": str(session.id),
                "short_id": str(session.id)[:8].upper(),
                "book_title": session.target_title,
                "room_type": session.get_room_type_display(),
                "host_name": host_name,
                "guest_name": guest_name,
                "progress_percent": min(_percentage(session.current_page, max(session.book.page_count, 1)), 100) if session.book_id else 0,
                "progress_label": f"Page {session.current_page}/{max(session.book.page_count, 1)}" if session.book_id else "Adventure",
                "duration_clock": f"{elapsed_seconds // 60:02d}:{elapsed_seconds % 60:02d}",
                "note": latest_note,
                "status": session.get_status_display(),
                "status_tone": _status_tone(session.status),
                "started_display": timezone.localtime(started).strftime("%I:%M %p") if started else "—",
                "reconnect_count": session.events.filter(event_type=SessionEvent.EventType.RECONNECTED).count(),
                "event_total": session.events.count(),
            }
        )
    return rows


def _build_log_rows():
    """Synthesize a lightweight operational log view from existing session and billing data."""
    entries = []

    for session in ReadingSession.objects.select_related("book").order_by("-updated_at")[:10]:
        if session.status in {ReadingSession.Status.RECONNECTING, ReadingSession.Status.CANCELLED, ReadingSession.Status.EXPIRED}:
            severity = "Critical" if session.status == ReadingSession.Status.CANCELLED else "Warning"
            entries.append(
                {
                    "id": f"SES-{str(session.id)[:6].upper()}",
                    "severity": severity,
                    "severity_tone": "bg-rose-100 text-rose-700" if severity == "Critical" else "bg-amber-100 text-amber-700",
                    "message": f"{session.get_status_display()} session for {session.target_title}",
                    "source": "Session monitor",
                    "linked_session": str(session.id)[:8].upper(),
                    "timestamp": session.updated_at,
                    "status": "Unresolved" if session.status == ReadingSession.Status.CANCELLED else "Noted",
                    "detail": f"Room type: {session.get_room_type_display()} · Current page: {session.current_page}",
                }
            )

    for entitlement in Entitlement.objects.select_related("user").order_by("-updated_at")[:10]:
        if entitlement.subscription_status in {Entitlement.SubscriptionStatus.PAST_DUE, Entitlement.SubscriptionStatus.CANCELLED}:
            entries.append(
                {
                    "id": f"BIL-{str(entitlement.id)[:6].upper()}",
                    "severity": "Error",
                    "severity_tone": "bg-rose-100 text-rose-700",
                    "message": f"Billing issue for {entitlement.user.get_full_name() or entitlement.user.username}",
                    "source": "Billing API",
                    "linked_session": "—",
                    "timestamp": entitlement.updated_at,
                    "status": "Unresolved",
                    "detail": entitlement.last_webhook_event or entitlement.get_subscription_status_display(),
                }
            )

    for event in SessionEvent.objects.select_related("session").order_by("-created_at")[:10]:
        if event.event_type == SessionEvent.EventType.RECONNECTED:
            entries.append(
                {
                    "id": f"EVT-{str(event.id)[:6].upper()}",
                    "severity": "Info",
                    "severity_tone": "bg-sky-100 text-sky-700",
                    "message": f"Reconnected session {str(event.session_id)[:8].upper()}",
                    "source": "Realtime events",
                    "linked_session": str(event.session_id)[:8].upper(),
                    "timestamp": event.created_at,
                    "status": "Resolved",
                    "detail": event.payload or {"event_type": event.event_type},
                }
            )

    return sorted(entries, key=lambda item: item["timestamp"], reverse=True)


@staff_member_required
def super_admin_dashboard(request):
    all_sessions = ReadingSession.objects.select_related("book", "child_profile", "created_by").prefetch_related("participants").order_by("-created_at")
    customer_users = User.objects.filter(is_staff=False).order_by("-date_joined")
    plan_breakdown = [
        {"label": item["plan_code"] or "Unassigned", "count": item["count"]}
        for item in Entitlement.objects.values("plan_code").annotate(count=Count("id")).order_by("-count")
    ]

    stats = [
        {"label": "Active Now", "value": all_sessions.filter(status=ReadingSession.Status.ACTIVE).count(), "icon": "fa-signal", "accent": "from-emerald-500 to-teal-500"},
        {"label": "Sessions Today", "value": all_sessions.filter(created_at__date=timezone.localdate()).count(), "icon": "fa-clock", "accent": "from-violet-500 to-indigo-600"},
        {"label": "Total Users", "value": customer_users.count(), "icon": "fa-users", "accent": "from-amber-500 to-orange-500"},
        {"label": "Total Books", "value": Book.objects.count(), "icon": "fa-book-open", "accent": "from-sky-500 to-cyan-500"},
        {"label": "Active Plans", "value": Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.ACTIVE).count(), "icon": "fa-credit-card", "accent": "from-pink-500 to-rose-500"},
    ]

    context = {
        "active_nav": "dashboard",
        "stats": stats,
        "avg_duration": _average_completed_session_minutes(),
        "session_rows": _build_session_rows(all_sessions[:6]),
        "top_books": Book.objects.annotate(session_total=Count("sessions")).order_by("-session_total", "title")[:5],
        "recent_users": _build_user_rows(customer_users.select_related("entitlement")[:5]),
        "plan_breakdown": plan_breakdown,
    }
    return render(request, "core/admin_dashboard.html", context)


@staff_member_required
def admin_session_monitor(request):
    sessions = ReadingSession.objects.select_related("book", "child_profile", "created_by").prefetch_related("participants").order_by("-created_at")
    q = request.GET.get("q", "").strip()
    book_query = request.GET.get("book_q", "").strip()
    status_filter = request.GET.get("status", "").strip()
    date_filter = request.GET.get("date", "").strip()
    parsed_date = parse_date(date_filter) if date_filter else None

    if q:
        sessions = sessions.filter(
            Q(book__title__icontains=q)
            | Q(child_profile__display_name__icontains=q)
            | Q(created_by__username__icontains=q)
            | Q(participants__display_name__icontains=q)
        ).distinct()
    if book_query:
        sessions = sessions.filter(Q(book__title__icontains=book_query) | Q(book__slug__icontains=book_query))
    if status_filter:
        sessions = sessions.filter(status=status_filter)
    if parsed_date:
        sessions = sessions.filter(created_at__date=parsed_date)

    context = {
        "active_nav": "sessions",
        "session_rows": _build_session_rows(sessions[:50]),
        "query": q,
        "book_query": book_query,
        "status_filter": status_filter,
        "date_filter": date_filter,
        "session_stats": {
            "active_now": ReadingSession.objects.filter(status=ReadingSession.Status.ACTIVE).count(),
            "completed_today": ReadingSession.objects.filter(status=ReadingSession.Status.COMPLETED, created_at__date=timezone.localdate()).count(),
            "avg_duration": _average_completed_session_minutes(),
            "total_users": User.objects.filter(is_staff=False).count(),
        },
    }
    return render(request, "core/admin_session_monitor.html", context)


@staff_member_required
def admin_book_library(request):
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "toggle_publish":
            book = get_object_or_404(Book, pk=request.POST.get("book_id"))
            book.published = not book.published
            book.save(update_fields=["published", "updated_at"])
            messages.success(request, f"Updated publish status for '{book.title}'.")
            return redirect(reverse("admin_book_library"))
        if action == "delete":
            book = get_object_or_404(Book, pk=request.POST.get("book_id"))
            title = book.title
            book.delete()
            messages.success(request, f"Deleted '{title}' from the library.")
            return redirect(reverse("admin_book_library"))

    books = Book.objects.annotate(activity_total=Count("activity_configs")).order_by("title")
    query = request.GET.get("q", "").strip()
    room_type = request.GET.get("room_type", "").strip()
    age_band = request.GET.get("age_band", "").strip()
    status_filter = request.GET.get("status", "").strip()
    asset_type_filter = request.GET.get("asset_type", "").strip()

    if query:
        books = books.filter(Q(title__icontains=query) | Q(slug__icontains=query) | Q(description__icontains=query))
    if room_type:
        books = books.filter(room_type=room_type)
    if age_band:
        books = books.filter(age_band=age_band)
    if status_filter == "published":
        books = books.filter(published=True)
    elif status_filter == "draft":
        books = books.filter(published=False)
    if asset_type_filter:
        books = books.filter(asset_type=asset_type_filter)

    context = {
        "active_nav": "books",
        "books": books[:100],
        "query": query,
        "room_type_filter": room_type,
        "age_band_filter": age_band,
        "status_filter": status_filter,
        "asset_type_filter": asset_type_filter,
        "book_stats": {
            "total": Book.objects.count(),
            "published": Book.objects.filter(published=True).count(),
            "drafts": Book.objects.filter(published=False).count(),
            "activities": ActivityConfig.objects.count(),
        },
        "room_type_choices": Book.RoomType.choices,
        "age_band_choices": Book.AgeBand.choices,
        "asset_type_choices": Book.AssetType.choices,
    }
    return render(request, "core/admin_book_library.html", context)


def _book_payload_from_request(request):
    publish_state = request.POST.get("publish_state", "").strip()
    payload = {
        "title": request.POST.get("title", "").strip(),
        "slug": (request.POST.get("slug", "").strip() or slugify(request.POST.get("title", ""))),
        "description": request.POST.get("description", "").strip(),
        "room_type": request.POST.get("room_type", Book.RoomType.READING),
        "age_band": request.POST.get("age_band", Book.AgeBand.AGE_3_5),
        "published": (
            publish_state == "published"
            if publish_state in {"draft", "published"}
            else request.POST.get("published") == "on"
        ),
        "page_count": request.POST.get("page_count") or 1,
    }
    posted_cover = _normalize_cover_image_url(request.POST.get("cover_image", ""))
    if posted_cover:
        payload["cover_image"] = posted_cover
    return payload


def _validate_user_avatar_file(uploaded_file):
    """Return error message string or None if file is acceptable."""
    if not uploaded_file:
        return None
    max_size_bytes = 2 * 1024 * 1024
    content_type = (getattr(uploaded_file, "content_type", "") or "").lower()
    if not content_type.startswith("image/"):
        return "Profile picture must be an image file (JPG, PNG, WEBP, or GIF)."
    if uploaded_file.size > max_size_bytes:
        return "Profile picture exceeds 2MB limit."

    ext = (uploaded_file.name.rsplit(".", 1)[-1] if "." in uploaded_file.name else "jpg").lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "gif"}:
        return "Profile picture must use a .jpg, .png, .webp, or .gif extension."

    return None


def _validate_and_store_user_avatar_upload(request, uploaded_file):
    """Store parent account avatar; returns (absolute_url, error_message)."""
    if not uploaded_file:
        return "", None
    preflight = _validate_user_avatar_file(uploaded_file)
    if preflight:
        return "", preflight

    ext = (uploaded_file.name.rsplit(".", 1)[-1] if "." in uploaded_file.name else "jpg").lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "gif"}:
        ext = "jpg"
    try:
        uploaded_file.seek(0)
    except (AttributeError, OSError):
        pass
    unique_name = f"user-avatars/{timezone.now().strftime('%Y/%m')}/{secrets.token_hex(12)}.{ext}"
    stored_path = default_storage.save(unique_name, uploaded_file)
    try:
        public_url = default_storage.url(stored_path)
    except Exception:
        public_url = f"/media/{stored_path.lstrip('/')}"
    if public_url.startswith("/"):
        public_url = request.build_absolute_uri(public_url)
    return public_url, None


def _validate_and_store_cover_upload(request, uploaded_file):
    if not uploaded_file:
        return "", None
    max_size_bytes = 5 * 1024 * 1024
    content_type = (getattr(uploaded_file, "content_type", "") or "").lower()
    if not content_type.startswith("image/"):
        return "", "Cover upload must be an image file (jpg, png, webp, gif)."
    if uploaded_file.size > max_size_bytes:
        return "", "Cover upload exceeds 5MB limit."

    ext = (uploaded_file.name.rsplit(".", 1)[-1] if "." in uploaded_file.name else "jpg").lower()
    if ext not in {"jpg", "jpeg", "png", "webp", "gif"}:
        ext = "jpg"
    unique_name = f"book-covers/{timezone.now().strftime('%Y/%m')}/{secrets.token_hex(12)}.{ext}"
    stored_path = default_storage.save(unique_name, uploaded_file)
    try:
        public_url = default_storage.url(stored_path)
    except Exception:
        public_url = f"/media/{stored_path.lstrip('/')}"
    if public_url.startswith("/"):
        public_url = request.build_absolute_uri(public_url)
    return public_url, None


def _validate_and_store_pdf_upload(uploaded_file):
    if not uploaded_file:
        return "", None
    max_size_bytes = 30 * 1024 * 1024
    content_type = (getattr(uploaded_file, "content_type", "") or "").lower()
    filename = (getattr(uploaded_file, "name", "") or "").lower()
    if content_type != "application/pdf" and not filename.endswith(".pdf"):
        return "", "Book PDF must be a valid .pdf file."
    if uploaded_file.size > max_size_bytes:
        return "", "Book PDF exceeds 30MB limit."

    unique_name = f"book-pdfs/{timezone.now().strftime('%Y/%m')}/{secrets.token_hex(12)}.pdf"
    stored_path = default_storage.save(unique_name, uploaded_file)
    return stored_path, None


def _book_relation_context(book):
    activities = book.activity_configs.all().order_by("sort_order", "title")
    recent_sessions = (
        book.sessions.select_related("child_profile", "created_by").order_by("-created_at")[:8]
    )
    return {
        "book_activity_rows": [
            {
                "id": str(activity.id),
                "title": activity.title,
                "activity_type": activity.get_activity_type_display(),
                "activity_type_key": activity.activity_type,
                "sort_order": activity.sort_order,
                "is_active": activity.is_active,
                "summary": (
                    f"{len((activity.config or {}).keys())} config keys"
                    if isinstance(activity.config, dict)
                    else "Config unavailable"
                ),
            }
            for activity in activities
        ],
        "book_recent_sessions": recent_sessions,
        "book_relations": {
            "activity_total": activities.count(),
            "page_total": book.pages.count(),
            "session_total": book.sessions.count(),
            "favorite_total": book.saved_by_users.count(),
        },
        "selected_pages": book.pages.all(),
    }


def _safe_local_path_or_default(request, value, fallback):
    candidate = (value or "").strip()
    if candidate and url_has_allowed_host_and_scheme(
        candidate,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        return candidate
    return fallback


def _format_key_value_rows(value):
    if not isinstance(value, dict):
        return []
    rows = []
    for key, raw in value.items():
        if isinstance(raw, dict):
            rendered = ", ".join(f"{child_key}: {child_value}" for child_key, child_value in raw.items()) or "—"
        elif isinstance(raw, list):
            rendered = ", ".join(str(item) for item in raw) or "—"
        elif raw in ("", None):
            rendered = "—"
        else:
            rendered = str(raw)
        rows.append({"key": str(key), "value": rendered})
    return rows


def _slug_to_title(slug):
    """`charlie-and-the-chocolate-factory` -> `Charlie and the Chocolate Factory`."""
    if not slug:
        return ""
    small_words = {"and", "or", "the", "a", "an", "of", "in", "on", "to", "for", "with"}
    parts = str(slug).replace("_", "-").split("-")
    out = []
    for index, word in enumerate(parts):
        if not word:
            continue
        if index > 0 and word.lower() in small_words:
            out.append(word.lower())
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return " ".join(out)


def _humanize_seconds(value):
    """`1200` -> `20 minutes`. Falls back to a raw seconds string."""
    try:
        total = int(value)
    except (TypeError, ValueError):
        return None
    if total < 0:
        return None
    if total < 60:
        return f"{total} second" + ("" if total == 1 else "s")
    minutes, seconds = divmod(total, 60)
    if minutes < 60:
        if seconds == 0:
            return f"{minutes} minute" + ("" if minutes == 1 else "s")
        return f"{minutes} min {seconds} sec"
    hours, minutes = divmod(minutes, 60)
    if minutes == 0:
        return f"{hours} hour" + ("" if hours == 1 else "s")
    return f"{hours} hr {minutes} min"


def _humanize_session_event(event_type, payload, participant_name=None):
    """Return a human-readable sentence for a SessionEvent entry."""
    payload = payload if isinstance(payload, dict) else {}
    actor = participant_name or "System"

    if event_type == SessionEvent.EventType.CREATED:
        room_type = (payload.get("room_type") or "").replace("_", " ").strip()
        book_label = _slug_to_title(payload.get("book_slug"))
        if room_type and book_label:
            return f"{room_type.title()} room scheduled for {book_label}."
        if book_label:
            return f"Session scheduled for {book_label}."
        if room_type:
            return f"{room_type.title()} room scheduled."
        return "Session created."

    if event_type == SessionEvent.EventType.STARTED:
        return f"Reading session started by {actor}." if participant_name else "Reading session started."

    if event_type == SessionEvent.EventType.RECONNECTED:
        return f"{actor} reconnected to the room." if participant_name else "A participant reconnected to the room."

    if event_type == SessionEvent.EventType.COMPLETED:
        return f"Session marked complete by {actor}." if participant_name else "Session marked complete."

    if event_type == SessionEvent.EventType.CANCELLED:
        if payload.get("forced_by_admin"):
            return "Cancelled by an admin from the operations dashboard."
        source = (payload.get("source") or "").strip()
        if source == "api":
            return "Cancelled via the API."
        if source:
            return f"Cancelled via {source}."
        return "Session cancelled."

    if event_type == "host_transferred":
        return f"Host role transferred from {actor}." if participant_name else "Host role transferred."

    label = str(event_type).replace("_", " ").strip().capitalize() or "Event"
    return f"{label}."


def _humanize_timer_state(timer_state):
    """Render `{'remaining_seconds': 1200}` as `'20 minutes left on the reading timer.'`."""
    if not isinstance(timer_state, dict) or not timer_state:
        return ""
    parts = []
    remaining = _humanize_seconds(timer_state.get("remaining_seconds"))
    if remaining:
        parts.append(f"{remaining} left on the reading timer")
    elapsed = _humanize_seconds(timer_state.get("elapsed_seconds"))
    if elapsed:
        parts.append(f"{elapsed} elapsed so far")
    if timer_state.get("paused") is True:
        parts.append("timer is paused")
    elif timer_state.get("paused") is False and "remaining_seconds" not in timer_state:
        parts.append("timer is running")
    if not parts:
        return ""
    return ", ".join(parts).capitalize() + "."


def _flatten_serializer_errors(error_dict):
    if not error_dict:
        return []
    flattened = []
    for field, raw_messages in error_dict.items():
        label = "General" if field == "non_field_errors" else str(field).replace("_", " ").title()
        messages = raw_messages if isinstance(raw_messages, list) else [raw_messages]
        for message in messages:
            flattened.append({"field": label, "message": str(message)})
    return flattened


@staff_member_required
def admin_book_create(request):
    book_errors = []
    selected_book = None
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "save":
            payload = _book_payload_from_request(request)
            uploaded_cover = request.FILES.get("cover_image_file")
            uploaded_cover_url, upload_error = _validate_and_store_cover_upload(request, uploaded_cover)
            uploaded_pdf = request.FILES.get("book_pdf_file")
            uploaded_pdf_key, pdf_error = _validate_and_store_pdf_upload(uploaded_pdf)
            if upload_error:
                book_errors = [{"field": "Cover Image", "message": upload_error}]
            elif pdf_error:
                book_errors = [{"field": "Book PDF", "message": pdf_error}]
            elif uploaded_cover_url:
                payload["cover_image"] = uploaded_cover_url
            serializer = BookSerializer(data=payload)
            if not book_errors and serializer.is_valid():
                created = serializer.save()
                if uploaded_pdf_key:
                    created.asset_type = Book.AssetType.PDF
                    created.s3_key = uploaded_pdf_key
                    created.save(update_fields=["asset_type", "s3_key", "updated_at"])
                messages.success(request, f"Book '{created.title}' created successfully.")
                return redirect(reverse("admin_book_detail", args=[created.id]))
            if not book_errors:
                book_errors = _flatten_serializer_errors(serializer.errors)

    context = {
        "active_nav": "books",
        "selected_book": selected_book,
        "book_errors": book_errors,
        "room_type_choices": Book.RoomType.choices,
        "age_band_choices": Book.AgeBand.choices,
        "book_activity_rows": [],
        "book_relations": {"activity_total": 0, "page_total": 0, "session_total": 0, "favorite_total": 0},
        "selected_pages": [],
        "book_recent_sessions": [],
        "create_activity_url": None,
    }
    return render(request, "core/admin_book_detail.html", context)


@staff_member_required
def admin_book_detail(request, book_id):
    selected_book = get_object_or_404(Book, pk=book_id)
    book_errors = []

    if request.method == "POST":
        action = request.POST.get("action")

        if action == "save":
            payload = _book_payload_from_request(request)
            uploaded_cover = request.FILES.get("cover_image_file")
            uploaded_cover_url, upload_error = _validate_and_store_cover_upload(request, uploaded_cover)
            uploaded_pdf = request.FILES.get("book_pdf_file")
            uploaded_pdf_key, pdf_error = _validate_and_store_pdf_upload(uploaded_pdf)
            if upload_error:
                book_errors = [{"field": "Cover Image", "message": upload_error}]
            elif pdf_error:
                book_errors = [{"field": "Book PDF", "message": pdf_error}]
            elif uploaded_cover_url:
                payload["cover_image"] = uploaded_cover_url
            serializer = BookSerializer(selected_book, data=payload, partial=True)
            if not book_errors and serializer.is_valid():
                selected_book = serializer.save()
                if uploaded_pdf_key:
                    selected_book.asset_type = Book.AssetType.PDF
                    selected_book.s3_key = uploaded_pdf_key
                    selected_book.save(update_fields=["asset_type", "s3_key", "updated_at"])
                messages.success(request, f"Book '{selected_book.title}' saved successfully.")
                return redirect(reverse("admin_book_detail", args=[selected_book.id]))
            if not book_errors:
                book_errors = _flatten_serializer_errors(serializer.errors)
        elif action == "delete":
            title = selected_book.title
            selected_book.delete()
            messages.success(request, f"Deleted '{title}' from the library.")
            return redirect(reverse("admin_book_library"))
        elif action == "toggle_publish":
            selected_book.published = not selected_book.published
            selected_book.save(update_fields=["published", "updated_at"])
            messages.success(request, f"Updated publish status for '{selected_book.title}'.")
            return redirect(reverse("admin_book_detail", args=[selected_book.id]))
        elif action == "add_page":
            page_number = (request.POST.get("page_number") or "").strip()
            image_url = (request.POST.get("image_url") or "").strip()
            if not page_number or not image_url:
                messages.error(request, "Page number and image URL are required.")
            else:
                try:
                    BookPage.objects.update_or_create(
                        book=selected_book,
                        page_number=int(page_number),
                        defaults={"image_url": image_url},
                    )
                except ValueError:
                    messages.error(request, "Page number must be a valid integer.")
                else:
                    selected_book.page_count = selected_book.pages.count()
                    selected_book.save(update_fields=["page_count", "updated_at"])
                    messages.success(request, f"Page {page_number} saved for '{selected_book.title}'.")
            return redirect(reverse("admin_book_detail", args=[selected_book.id]))
        elif action == "delete_page":
            page = get_object_or_404(BookPage, pk=request.POST.get("page_id"), book=selected_book)
            page.delete()
            selected_book.page_count = selected_book.pages.count()
            selected_book.save(update_fields=["page_count", "updated_at"])
            messages.success(request, "Page deleted.")
            return redirect(reverse("admin_book_detail", args=[selected_book.id]))

    relation_context = _book_relation_context(selected_book)
    return_to = reverse("admin_book_detail", args=[selected_book.id])
    create_activity_query = urlencode(
        {"book": str(selected_book.id), "create": "1", "return_to": return_to}
    )
    context = {
        "active_nav": "books",
        "selected_book": selected_book,
        "book_errors": book_errors,
        "room_type_choices": Book.RoomType.choices,
        "age_band_choices": Book.AgeBand.choices,
        "create_activity_url": f"{reverse('admin_activity_config')}?{create_activity_query}",
        **relation_context,
    }
    return render(request, "core/admin_book_detail.html", context)


@staff_member_required
def admin_activity_config(request):
    """
    Read-only roster of every activity config, plus delete.

    Authoring moved to the React builder at ``/admin/activities``: it uploads
    illustrations, places drop zones and hotspots by clicking the image, and
    previews the result. The form that used to live here only emitted schema
    1.0 payloads (single-question quizzes, no images), so keeping it meant two
    builders that disagreed about the shape of a config. The URL is kept so
    existing portal links and bookmarks still resolve.
    """
    selected_activity = None
    selected_activity_config = {}

    if request.method == "POST" and request.POST.get("action") == "delete":
        activity = get_object_or_404(ActivityConfig, pk=request.POST.get("activity_id"))
        title = activity.title
        activity.delete()
        messages.success(request, f"Deleted activity config '{title}'.")
        return redirect(reverse("admin_activity_config"))

    selected_id = request.GET.get("selected")
    if selected_id:
        selected_activity = ActivityConfig.objects.filter(pk=selected_id).select_related("book").first()
        if selected_activity:
            selected_activity_config = selected_activity.config or {}

    activities = ActivityConfig.objects.select_related("book").order_by("book__title", "sort_order", "title")
    query = request.GET.get("q", "").strip()
    type_filter = request.GET.get("activity_type", "").strip()
    if query:
        activities = activities.filter(Q(title__icontains=query) | Q(book__title__icontains=query))
    if type_filter:
        activities = activities.filter(activity_type=type_filter)

    # Deep-link straight to the right builder screen when the operator arrived
    # from a book ("Create activity"), so the book is pre-selected for them.
    selected_book_id = request.GET.get("book", "").strip()
    frontend_root = (getattr(django_settings, "FRONTEND_URL", "") or "").rstrip("/")
    builder_url = f"{frontend_root}/admin/activities"
    if selected_book_id:
        builder_url = f"{builder_url}?book={selected_book_id}"

    context = {
        "active_nav": "activities",
        "activities": activities[:100],
        "selected_activity": selected_activity,
        "selected_activity_config": selected_activity_config,
        "query": query,
        "type_filter": type_filter,
        "activity_type_choices": ActivityConfig.ActivityType.choices,
        "activity_stats": {
            "total": ActivityConfig.objects.count(),
            "drawing": ActivityConfig.objects.filter(activity_type=ActivityConfig.ActivityType.DRAWING).count(),
            "drag_drop": ActivityConfig.objects.filter(activity_type=ActivityConfig.ActivityType.DRAG_DROP).count(),
            "quiz": ActivityConfig.objects.filter(activity_type=ActivityConfig.ActivityType.QUIZ).count(),
        },
        "selected_book_id": selected_book_id,
        "builder_url": builder_url,
    }
    return render(request, "core/admin_activity_config.html", context)


@staff_member_required
def admin_users(request):
    users = User.objects.filter(is_staff=False).select_related("entitlement").prefetch_related("child_profiles", "created_sessions").order_by("-date_joined")
    query = request.GET.get("q", "").strip()
    plan_code = request.GET.get("plan_code", "").strip()
    status_filter = request.GET.get("status", "").strip()

    if query:
        users = users.filter(
            Q(username__icontains=query)
            | Q(email__icontains=query)
            | Q(first_name__icontains=query)
            | Q(last_name__icontains=query)
        )
    if plan_code:
        users = users.filter(entitlement__plan_code=plan_code)
    if status_filter == "active":
        users = users.filter(entitlement__subscription_status=Entitlement.SubscriptionStatus.ACTIVE)
    elif status_filter == "trial":
        users = users.filter(Q(entitlement__isnull=True) | Q(entitlement__subscription_status=Entitlement.SubscriptionStatus.NONE))
    elif status_filter == "past_due":
        users = users.filter(entitlement__subscription_status=Entitlement.SubscriptionStatus.PAST_DUE)
    elif status_filter == "cancelled":
        users = users.filter(entitlement__subscription_status=Entitlement.SubscriptionStatus.CANCELLED)

    user_rows = _build_user_rows(users[:100])
    selected_user = None
    selected_id = request.GET.get("selected")
    if selected_id:
        selected_user = User.objects.filter(pk=selected_id, is_staff=False).select_related("entitlement").first()
    if not selected_user and users.exists():
        selected_user = users.first()

    selected_children = selected_user.child_profiles.filter(is_active=True) if selected_user else []
    selected_recent_sessions = selected_user.created_sessions.select_related("book", "child_profile").order_by("-created_at")[:5] if selected_user else []
    selected_badges = UserBadge.objects.filter(child_profile__user=selected_user).select_related("badge").order_by("-created_at")[:5] if selected_user else []

    context = {
        "active_nav": "users",
        "user_rows": user_rows,
        "selected_user": selected_user,
        "selected_children": selected_children,
        "selected_recent_sessions": selected_recent_sessions,
        "selected_badges": selected_badges,
        "selected_entitlement": getattr(selected_user, "entitlement", None) if selected_user else None,
        "query": query,
        "plan_code": plan_code,
        "status_filter": status_filter,
        "user_stats": {
            "total": User.objects.filter(is_staff=False).count(),
            "paid": Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.ACTIVE).count(),
            "free": User.objects.filter(is_staff=False).exclude(entitlement__subscription_status=Entitlement.SubscriptionStatus.ACTIVE).count(),
            "churned": Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.CANCELLED).count(),
            "avg_sessions": round(sum(row["session_count"] for row in user_rows) / len(user_rows), 1) if user_rows else 0,
        },
        "plan_choices": [plan for plan in Entitlement.objects.exclude(plan_code="").values_list("plan_code", flat=True).distinct()],
        "create_user_url": reverse("admin_user_create"),
    }
    return render(request, "core/admin_users.html", context)


def _user_payload_from_request(request):
    return {
        "first_name": (request.POST.get("first_name") or "").strip(),
        "last_name": (request.POST.get("last_name") or "").strip(),
        "username": (request.POST.get("username") or "").strip(),
        "email": (request.POST.get("email") or "").strip().lower(),
        "is_active": request.POST.get("is_active") == "on",
    }


def _validate_user_payload(payload, existing_user=None):
    errors = {}
    if not payload["username"]:
        errors["username"] = "Username is required."
    if not payload["email"] or "@" not in payload["email"]:
        errors["email"] = "A valid email is required."

    username_qs = User.objects.filter(username__iexact=payload["username"])
    email_qs = User.objects.filter(email__iexact=payload["email"])
    if existing_user:
        username_qs = username_qs.exclude(pk=existing_user.pk)
        email_qs = email_qs.exclude(pk=existing_user.pk)

    if username_qs.exists():
        errors["username"] = "This username is already in use."
    if email_qs.exists():
        errors["email"] = "This email is already in use."
    return errors


def _user_detail_context(user):
    entitlement = getattr(user, "entitlement", None)
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return {
        "selected_user": user,
        "user_profile": profile,
        "selected_entitlement": entitlement,
        "selected_children": user.child_profiles.filter(is_active=True).order_by("display_name"),
        "selected_recent_sessions": user.created_sessions.select_related("book", "child_profile").order_by("-created_at")[:8],
        "selected_badges": UserBadge.objects.filter(child_profile__user=user).select_related("badge").order_by("-created_at")[:8],
    }


@staff_member_required
def admin_user_create(request):
    user_errors = {}
    selected_user = None
    if request.method == "POST" and request.POST.get("action") == "save":
        payload = _user_payload_from_request(request)
        user_errors = _validate_user_payload(payload)
        password = (request.POST.get("password") or "").strip()
        if not password:
            user_errors["password"] = "Password is required when creating a user."
        avatar_file = request.FILES.get("avatar_file")
        if avatar_file:
            avatar_msg = _validate_user_avatar_file(avatar_file)
            if avatar_msg:
                user_errors["avatar"] = avatar_msg
        if not user_errors:
            selected_user = User.objects.create_user(
                username=payload["username"],
                email=payload["email"],
                first_name=payload["first_name"],
                last_name=payload["last_name"],
                password=password,
                is_active=payload["is_active"],
            )
            Entitlement.objects.get_or_create(user=selected_user)
            profile, _ = UserProfile.objects.get_or_create(user=selected_user)
            if avatar_file:
                avatar_url, store_err = _validate_and_store_user_avatar_upload(request, avatar_file)
                if store_err:
                    messages.warning(request, store_err)
                elif avatar_url:
                    profile.avatar_url = avatar_url
                    profile.save(update_fields=["avatar_url", "updated_at"])
            messages.success(request, f"User '{selected_user.username}' created successfully.")
            return redirect(reverse("admin_user_detail", args=[selected_user.id]))

    context = {
        "active_nav": "users",
        "user_errors": user_errors,
        "create_mode": True,
        "selected_user": selected_user,
        "user_profile": None,
        "selected_entitlement": None,
        "selected_children": [],
        "selected_recent_sessions": [],
        "selected_badges": [],
    }
    return render(request, "core/admin_user_detail.html", context)


@staff_member_required
def admin_user_detail(request, user_id):
    selected_user = get_object_or_404(User, pk=user_id, is_staff=False)
    user_errors = {}
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "save":
            profile, _ = UserProfile.objects.get_or_create(user=selected_user)
            payload = _user_payload_from_request(request)
            user_errors = _validate_user_payload(payload, existing_user=selected_user)
            avatar_file = request.FILES.get("avatar_file")
            clear_avatar = request.POST.get("clear_avatar") == "on"
            if avatar_file:
                avatar_msg = _validate_user_avatar_file(avatar_file)
                if avatar_msg:
                    user_errors["avatar"] = avatar_msg
            if not user_errors:
                selected_user.first_name = payload["first_name"]
                selected_user.last_name = payload["last_name"]
                selected_user.username = payload["username"]
                selected_user.email = payload["email"]
                selected_user.is_active = payload["is_active"]
                selected_user.save(update_fields=["first_name", "last_name", "username", "email", "is_active"])
                if avatar_file:
                    avatar_url, store_err = _validate_and_store_user_avatar_upload(request, avatar_file)
                    if store_err:
                        messages.error(request, store_err)
                    elif avatar_url:
                        profile.avatar_url = avatar_url
                        profile.save(update_fields=["avatar_url", "updated_at"])
                elif clear_avatar:
                    profile.avatar_url = ""
                    profile.save(update_fields=["avatar_url", "updated_at"])
                messages.success(request, f"User '{selected_user.username}' saved successfully.")
                return redirect(reverse("admin_user_detail", args=[selected_user.id]))
        elif action == "toggle_active":
            selected_user.is_active = not selected_user.is_active
            selected_user.save(update_fields=["is_active"])
            messages.success(request, f"User '{selected_user.username}' status updated.")
            return redirect(reverse("admin_user_detail", args=[selected_user.id]))
        elif action == "delete":
            username = selected_user.username
            selected_user.delete()
            messages.success(request, f"User '{username}' deleted.")
            return redirect(reverse("admin_users"))

    context = {
        "active_nav": "users",
        "user_errors": user_errors,
        "create_mode": False,
        **_user_detail_context(selected_user),
    }
    return render(request, "core/admin_user_detail.html", context)


@staff_member_required
def admin_subscriptions(request):
    """Revenue and subscription oversight powered by the existing Entitlement records."""
    # Handle entitlement edit
    if request.method == "POST" and request.POST.get("action") == "update_entitlement":
        ent = get_object_or_404(Entitlement, user_id=request.POST.get("user_id"))
        try:
            ent.sessions_remaining = max(0, int(request.POST.get("sessions_remaining", ent.sessions_remaining)))
            ent.pack_sessions_remaining = max(0, int(request.POST.get("pack_sessions_remaining", ent.pack_sessions_remaining)))
            ent.plan_code = request.POST.get("plan_code", ent.plan_code).strip()
            new_status = request.POST.get("subscription_status", "").strip()
            if new_status in {s[0] for s in Entitlement.SubscriptionStatus.choices}:
                ent.subscription_status = new_status
            ent.save(update_fields=["sessions_remaining", "pack_sessions_remaining", "plan_code", "subscription_status", "updated_at"])
            messages.success(request, f"Entitlement for {ent.user.username} updated.")
        except (ValueError, TypeError):
            messages.error(request, "Invalid values — session counts must be whole numbers.")
        return redirect(f"{reverse('admin_subscriptions')}?selected={ent.user_id}")

    entitlements = Entitlement.objects.select_related("user").order_by("-updated_at")
    status_filter = request.GET.get("status", "").strip()
    if status_filter:
        entitlements = entitlements.filter(subscription_status=status_filter)

    all_rows = _build_subscription_rows(entitlements)
    active_rows = [row for row in all_rows if row["status_label"].lower() == "active"]
    failed_rows = [row for row in all_rows if "past" in row["status_label"].lower() or "cancel" in row["status_label"].lower()][:4]
    monthly_rr = sum(row["amount"] for row in active_rows)
    annual_rr = monthly_rr * 12
    total_subscriptions = max(Entitlement.objects.count(), 1)
    churned = Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.CANCELLED).count()
    plan_totals = list(
        Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.ACTIVE)
        .values("plan_code")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    active_total = sum(item["count"] for item in plan_totals) or 1
    plan_breakdown = [
        {
            "label": item["plan_code"] or "Free",
            "count": item["count"],
            "percent": _percentage(item["count"], active_total),
        }
        for item in plan_totals
    ]
    billing_events = sorted(all_rows, key=lambda item: item["updated_at"], reverse=True)[:10]

    selected_ent_user_id = request.GET.get("selected")
    selected_entitlement = None
    selected_ent_user = None
    if selected_ent_user_id:
        selected_entitlement = Entitlement.objects.select_related("user").filter(user_id=selected_ent_user_id).first()
        if selected_entitlement:
            selected_ent_user = selected_entitlement.user

    context = {
        "active_nav": "subscriptions",
        "subscription_rows": all_rows[:25],
        "billing_events": billing_events,
        "failed_rows": failed_rows,
        "plan_breakdown": plan_breakdown,
        "status_filter": status_filter,
        "selected_entitlement": selected_entitlement,
        "selected_ent_user": selected_ent_user,
        "entitlement_status_choices": Entitlement.SubscriptionStatus.choices,
        "subscription_stats": {
            "mrr": monthly_rr,
            "annual_rr": annual_rr,
            "paid_subs": Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.ACTIVE).count(),
            "failed_payments": Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.PAST_DUE).count(),
            "churn_rate": round((churned / total_subscriptions) * 100, 1),
        },
    }
    return render(request, "core/admin_subscriptions.html", context)


def _get_or_create_manual_grant_session(child_profile):
    """Stable synthetic completed session used as anchor for staff-granted badges."""
    room = f"admin-badge-grant-{child_profile.id}"
    existing = ReadingSession.objects.filter(livekit_room_name=room).first()
    if existing:
        return existing
    book = Book.objects.filter(published=True).order_by("title").first() or Book.objects.order_by("title").first()
    if not book:
        raise ValueError("No book exists — add a book before granting badges.")
    return ReadingSession.objects.create(
        book=book,
        child_profile=child_profile,
        created_by=child_profile.user,
        status=ReadingSession.Status.COMPLETED,
        room_type=ReadingSession.RoomType.READING,
        livekit_room_name=room,
        started_at=timezone.now(),
        ended_at=timezone.now(),
    )


@staff_member_required
def admin_badges(request):
    """Badge catalogue and award activity based on Badge and UserBadge data."""
    if request.method == "POST" and request.POST.get("action") == "revoke_award":
        award = get_object_or_404(UserBadge, pk=request.POST.get("award_id"))
        badge_id = award.badge_id
        award.delete()
        messages.success(request, "Badge award revoked.")
        return redirect(f"{reverse('admin_badges')}?selected={badge_id}")

    if request.method == "POST" and request.POST.get("action") == "update_trigger_config":
        badge = get_object_or_404(Badge, pk=request.POST.get("badge_id"))
        trigger_type = badge.trigger_type
        config = dict(badge.trigger_config or {})
        if trigger_type == "session_complete":
            slug = request.POST.get("config_book_slug", "").strip()
            if slug:
                config["book_slug"] = slug
            else:
                config.pop("book_slug", None)
        elif trigger_type == "sessions_count":
            try:
                config["count"] = max(1, int(request.POST.get("config_count", 1)))
            except (ValueError, TypeError):
                pass
        badge.trigger_config = config
        badge.save(update_fields=["trigger_config"])
        messages.success(request, "Trigger configuration saved.")
        return redirect(f"{reverse('admin_badges')}?selected={badge.id}")

    if request.method == "POST" and request.POST.get("action") == "grant_award":
        badge = get_object_or_404(Badge, pk=request.POST.get("badge_id"))
        child_profile = ChildProfile.objects.filter(pk=request.POST.get("child_profile_id")).select_related("user").first()
        if not child_profile:
            messages.error(request, "Choose a valid child profile.")
            return redirect(f"{reverse('admin_badges')}?selected={badge.id}")
        if not badge.is_active:
            messages.error(request, "Cannot grant an inactive badge — activate it first.")
            return redirect(f"{reverse('admin_badges')}?selected={badge.id}")
        try:
            anchor_session = _get_or_create_manual_grant_session(child_profile)
        except ValueError as exc:
            messages.error(request, str(exc))
            return redirect(f"{reverse('admin_badges')}?selected={badge.id}")
        award, created = UserBadge.objects.get_or_create(
            child_profile=child_profile,
            badge=badge,
            session=anchor_session,
        )
        if created:
            messages.success(
                request,
                f"Granted “{badge.name}” to {child_profile.display_name} ({child_profile.user.username}).",
            )
        else:
            messages.warning(
                request,
                f"{child_profile.display_name} already has “{badge.name}” (including manual grants).",
            )
        return redirect(f"{reverse('admin_badges')}?selected={badge.id}")

    badges = Badge.objects.annotate(award_total=Count("awards"), last_awarded=Max("awards__created_at")).order_by("-award_total", "name")
    selected_id = request.GET.get("selected")
    selected_badge = badges.filter(pk=selected_id).first() if selected_id else badges.first()
    recent_awards = (
        UserBadge.objects.select_related("badge", "child_profile", "child_profile__user", "session", "session__book")
        .order_by("-created_at")[:10]
    )

    badge_rows = [
        {
            "id": badge.id,
            "name": badge.name,
            "description": badge.description or badge.trigger_type.replace("_", " ").title(),
            "trigger_type": badge.trigger_type.replace("_", " ").title(),
            "award_total": badge.award_total,
            "status_label": "Active" if badge.is_active else "Draft",
            "status_tone": "bg-emerald-100 text-emerald-700" if badge.is_active else "bg-amber-100 text-amber-700",
            "last_awarded": badge.last_awarded,
        }
        for badge in badges
    ]

    most_earned = badge_rows[0] if badge_rows else None
    selected_badge_award_rows = (
        UserBadge.objects.filter(badge=selected_badge)
        .select_related("child_profile", "child_profile__user", "session", "session__book")
        .order_by("-created_at")[:20]
        if selected_badge else []
    )
    grant_child_options = (
        ChildProfile.objects.filter(is_active=True)
        .select_related("user")
        .order_by("user__username", "display_name")
    )

    context = {
        "active_nav": "badges",
        "badge_rows": badge_rows,
        "selected_badge": selected_badge,
        "recent_awards": recent_awards,
        "selected_badge_award_rows": selected_badge_award_rows,
        "grant_child_options": grant_child_options,
        "badge_stats": {
            "total": Badge.objects.count(),
            "awarded": UserBadge.objects.count(),
            "most_earned": most_earned["name"] if most_earned else "—",
            "never_earned": badges.filter(award_total=0).count(),
        },
        "selected_badge_awards": UserBadge.objects.filter(badge=selected_badge).count() if selected_badge else 0,
        "selected_badge_last_awarded": getattr(selected_badge, "last_awarded", None) if selected_badge else None,
    }
    return render(request, "core/admin_badges.html", context)


@staff_member_required
def admin_live_sessions(request):
    """Focused live operations view for active and recently completed reading sessions."""
    query = request.GET.get("q", "").strip()
    book_query = request.GET.get("book_q", "").strip()
    status_filter = request.GET.get("status", "").strip()
    date_filter = request.GET.get("date", "").strip()

    live_statuses = [
        ReadingSession.Status.ACTIVE,
        ReadingSession.Status.RECONNECTING,
        ReadingSession.Status.LOBBY,
    ]

    def _apply_shared_filters(queryset):
        if query:
            queryset = queryset.filter(
                Q(participants__display_name__icontains=query)
                | Q(created_by__username__icontains=query)
                | Q(created_by__first_name__icontains=query)
                | Q(created_by__last_name__icontains=query)
            ).distinct()
        if book_query:
            queryset = queryset.filter(book__title__icontains=book_query)
        return queryset

    live_queryset = (
        ReadingSession.objects.filter(status__in=live_statuses)
        .select_related("book", "child_profile", "created_by")
        .prefetch_related("participants", "events")
        .order_by("-updated_at")
    )
    recent_queryset = (
        ReadingSession.objects.select_related("book", "child_profile", "created_by")
        .prefetch_related("participants", "events")
        .order_by("-created_at")
    )

    live_queryset = _apply_shared_filters(live_queryset)
    recent_queryset = _apply_shared_filters(recent_queryset)

    if status_filter:
        recent_queryset = recent_queryset.filter(status=status_filter)
        if status_filter not in {s.value for s in live_statuses}:
            live_queryset = live_queryset.none()
        else:
            live_queryset = live_queryset.filter(status=status_filter)

    if date_filter:
        parsed_date = parse_date(date_filter)
        if parsed_date:
            recent_queryset = recent_queryset.filter(created_at__date=parsed_date)

    has_active_filters = bool(query or book_query or status_filter or date_filter)

    context = {
        "active_nav": "live_sessions",
        "active_count": live_queryset.count(),
        "live_rows": _build_live_session_cards(live_queryset[:60]),
        "recent_session_rows": _build_session_rows(recent_queryset[:25 if has_active_filters else 10]),
        "query": query,
        "book_query": book_query,
        "status_filter": status_filter,
        "date_filter": date_filter,
        "has_active_filters": has_active_filters,
        "status_choices": ReadingSession.Status.choices,
    }
    return render(request, "core/admin_live_sessions.html", context)


@staff_member_required
def admin_logs(request):
    """Operational log view from real SessionEvent records + billing state."""
    event_type_filter = request.GET.get("event_type", "").strip()
    events_qs = (
        SessionEvent.objects
        .select_related("session", "session__book", "participant")
        .order_by("-created_at")
    )
    if event_type_filter:
        events_qs = events_qs.filter(event_type=event_type_filter)

    events = list(events_qs[:50])

    reconnect_count = SessionEvent.objects.filter(event_type=SessionEvent.EventType.RECONNECTED).count()
    cancelled_count = SessionEvent.objects.filter(event_type=SessionEvent.EventType.CANCELLED).count()
    webhook_failures = Entitlement.objects.filter(subscription_status=Entitlement.SubscriptionStatus.PAST_DUE).count()
    total_sessions = max(ReadingSession.objects.count(), 1)
    uptime = round(max(99.0, 100 - (reconnect_count * 0.05) - (cancelled_count * 0.02)), 1)

    selected_event_id = request.GET.get("log")
    selected_event = None
    if selected_event_id:
        selected_event = next((e for e in events if str(e.id) == selected_event_id), None)
    if not selected_event and events:
        selected_event = events[0]

    context = {
        "active_nav": "logs",
        "events": events,
        "selected_event": selected_event,
        "event_type_filter": event_type_filter,
        "event_type_choices": SessionEvent.EventType.choices,
        "log_stats": {
            "errors": reconnect_count + cancelled_count,
            "warnings": reconnect_count,
            "webhook_failures": webhook_failures,
            "uptime": uptime,
            "total_events": SessionEvent.objects.count(),
        },
    }
    return render(request, "core/admin_logs.html", context)


@staff_member_required
def admin_session_detail(request, session_id):
    """Full session detail view — participants, timeline, invite, cancel."""
    session = get_object_or_404(
        ReadingSession.objects
        .select_related("book", "child_profile", "created_by")
        .prefetch_related("participants", "events__participant"),
        pk=session_id,
    )

    if request.method == "POST":
        action = request.POST.get("action")
        if action == "cancel" and session.status not in {ReadingSession.Status.COMPLETED, ReadingSession.Status.CANCELLED, ReadingSession.Status.EXPIRED}:
            session.status = ReadingSession.Status.CANCELLED
            session.ended_at = timezone.now()
            session.save(update_fields=["status", "ended_at", "updated_at"])
            SessionEvent.objects.create(session=session, event_type=SessionEvent.EventType.CANCELLED, payload={"forced_by_admin": True})
            messages.success(request, f"Session #{str(session.id)[:8].upper()} cancelled.")
        elif action == "regenerate_invite":
            invite, _ = SessionInvite.objects.get_or_create(session=session)
            from datetime import timedelta
            from django.utils import timezone as tz
            import secrets as _sec
            invite.token = _sec.token_urlsafe(24)
            invite.expires_at = tz.now() + timedelta(hours=24)
            invite.used_count = 0
            invite.save(update_fields=["token", "expires_at", "used_count", "updated_at"])
            messages.success(request, "Invite link regenerated.")
        return redirect(reverse("admin_session_detail", args=[session_id]))

    invite = getattr(session, "invite", None)
    timeline = []
    for event in session.events.select_related("participant").order_by("created_at")[:20]:
        participant_name = event.participant.display_name if event.participant else None
        timeline.append({
            "label": event.get_event_type_display(),
            "meta": participant_name or "System",
            "timestamp": timezone.localtime(event.created_at).strftime("%d %b %H:%M:%S"),
            "description": _humanize_session_event(event.event_type, event.payload, participant_name),
            "tone": {
                SessionEvent.EventType.CANCELLED: "rose",
                SessionEvent.EventType.RECONNECTED: "violet",
                SessionEvent.EventType.COMPLETED: "emerald",
                SessionEvent.EventType.STARTED: "sky",
            }.get(event.event_type, "slate"),
        })

    hosts = [p for p in session.participants.all() if p.session_role == SessionParticipant.SessionRole.HOST]
    guests = [p for p in session.participants.all() if p.session_role != SessionParticipant.SessionRole.HOST]
    snapshot = getattr(session, "snapshot", None)
    can_cancel = session.status not in {ReadingSession.Status.COMPLETED, ReadingSession.Status.CANCELLED, ReadingSession.Status.EXPIRED}

    context = {
        "active_nav": "sessions",
        "session": session,
        "short_id": str(session.id)[:8].upper(),
        "status_tone": _status_tone(session.status),
        "hosts": hosts,
        "guests": guests,
        "timeline": timeline,
        "invite": invite,
        "snapshot": snapshot,
        "snapshot_timer_summary": _humanize_timer_state(getattr(snapshot, "timer_state", {})) if snapshot else "",
        "can_cancel": can_cancel,
        "duration": _session_duration_label(session),
    }
    return render(request, "core/admin_session_detail.html", context)


def _settings_redirect(fragment=""):
    url = reverse("admin_settings")
    if fragment:
        url = f"{url}#{fragment}"
    return redirect(url)


def _parse_bounded_int(raw, default, lo, hi):
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


@staff_member_required
def admin_settings(request):
    """Operational settings persisted in PortalSettings + admin invite flow."""
    if request.method == "POST":
        action = request.POST.get("action")
        if action == "save_platform":
            portal = PortalSettings.get_solo()
            portal.platform_name = (request.POST.get("platform_name") or "").strip() or portal.platform_name
            portal.support_email = (request.POST.get("support_email") or "").strip()
            portal.default_from_email = (request.POST.get("default_from_email") or "").strip()
            portal.public_base_url = (request.POST.get("public_base_url") or "").strip()
            try:
                portal.full_clean()
                portal.save()
            except ValidationError as exc:
                flat = [str(item) for errs in exc.error_dict.values() for item in errs]
                messages.error(request, " ".join(flat) or "Could not save platform details.")
                return _settings_redirect("platform")
            messages.success(request, "Platform details saved.")
            return _settings_redirect("platform")
        if action == "save_session_defaults":
            portal = PortalSettings.get_solo()
            portal.default_session_duration_minutes = _parse_bounded_int(
                request.POST.get("session_duration_minutes"), portal.default_session_duration_minutes, 1, 480
            )
            portal.session_warning_one_minutes = _parse_bounded_int(
                request.POST.get("session_warning_one"), portal.session_warning_one_minutes, 1, 120
            )
            portal.session_warning_two_minutes = _parse_bounded_int(
                request.POST.get("session_warning_two"), portal.session_warning_two_minutes, 1, 120
            )
            portal.invite_link_type_label = (request.POST.get("invite_link_type_label") or "").strip() or portal.invite_link_type_label
            portal.save(
                update_fields=[
                    "default_session_duration_minutes",
                    "session_warning_one_minutes",
                    "session_warning_two_minutes",
                    "invite_link_type_label",
                    "updated_at",
                ]
            )
            messages.success(request, "Session defaults saved. New sessions use the updated timer length.")
            return _settings_redirect("session-defaults")
        if action == "save_stripe":
            portal = PortalSettings.get_solo()
            if request.POST.get("stripe_secret_clear"):
                portal.stripe_secret_key = ""
            else:
                sk = (request.POST.get("stripe_secret_key") or "").strip()
                if sk:
                    portal.stripe_secret_key = sk
            if request.POST.get("stripe_webhook_clear"):
                portal.stripe_webhook_secret = ""
            else:
                wh = (request.POST.get("stripe_webhook_secret") or "").strip()
                if wh:
                    portal.stripe_webhook_secret = wh
            portal.save(update_fields=["stripe_secret_key", "stripe_webhook_secret", "updated_at"])
            messages.success(request, "Stripe settings saved.")
            return _settings_redirect("stripe")
        if action == "save_livekit":
            portal = PortalSettings.get_solo()
            if request.POST.get("livekit_key_clear"):
                portal.livekit_api_key = ""
            else:
                key = (request.POST.get("livekit_api_key") or "").strip()
                if key:
                    portal.livekit_api_key = key
            if request.POST.get("livekit_secret_clear"):
                portal.livekit_api_secret = ""
            else:
                secret = (request.POST.get("livekit_api_secret") or "").strip()
                if secret:
                    portal.livekit_api_secret = secret
            if request.POST.get("livekit_url_clear"):
                portal.livekit_url = ""
            else:
                url_val = (request.POST.get("livekit_url") or "").strip()
                if url_val:
                    portal.livekit_url = url_val
            try:
                portal.full_clean()
                portal.save()
            except ValidationError as exc:
                flat = [str(item) for errs in exc.error_dict.values() for item in errs]
                messages.error(request, " ".join(flat) or "Could not save LiveKit settings.")
                return _settings_redirect("livekit")
            messages.success(request, "LiveKit settings saved.")
            return _settings_redirect("livekit")
        if action == "save_storage_display":
            portal = PortalSettings.get_solo()
            portal.storage_plan_total_gb = _parse_bounded_int(
                request.POST.get("storage_plan_total_gb"), portal.storage_plan_total_gb, 1, 10_000_000
            )
            portal.save(update_fields=["storage_plan_total_gb", "updated_at"])
            messages.success(request, "Storage display ceiling updated.")
            return _settings_redirect("storage")
        if action == "invite_admin":
            invite_name = (request.POST.get("invite_name") or "").strip()
            invite_email = (request.POST.get("invite_email") or "").strip().lower()

            if not invite_name or not invite_email:
                messages.error(request, "Name and email are required to invite an admin.")
                return redirect(reverse("admin_settings"))

            if "@" not in invite_email:
                messages.error(request, "Enter a valid email address for the admin invite.")
                return redirect(reverse("admin_settings"))

            first_name, _, last_name = invite_name.partition(" ")
            username_base = invite_email.split("@")[0].strip() or "admin"
            username_candidate = username_base
            suffix = 1
            while User.objects.filter(username__iexact=username_candidate).exclude(email__iexact=invite_email).exists():
                suffix += 1
                username_candidate = f"{username_base}{suffix}"

            user = User.objects.filter(email__iexact=invite_email).first()
            generated_password = secrets.token_urlsafe(10)
            if user:
                user.is_staff = True
                if first_name:
                    user.first_name = first_name
                if last_name:
                    user.last_name = last_name
                if not user.username:
                    user.username = username_candidate
                user.set_password(generated_password)
                user.save(update_fields=["is_staff", "first_name", "last_name", "username", "password"])
                messages.success(
                    request,
                    f"Admin access granted to {invite_email}. Temporary password: {generated_password}",
                )
            else:
                user = User.objects.create_user(
                    username=username_candidate,
                    email=invite_email,
                    first_name=first_name,
                    last_name=last_name,
                    password=generated_password,
                    is_staff=True,
                )
                messages.success(
                    request,
                    f"Admin account created for {invite_email}. Temporary password: {generated_password}",
                )
            return redirect(reverse("admin_settings"))
        if action == "toggle_admin_active":
            admin_id = request.POST.get("admin_id")
            account = get_object_or_404(User, pk=admin_id, is_staff=True)
            if account.pk == request.user.pk:
                messages.error(request, "You cannot deactivate your own admin account.")
                return redirect(reverse("admin_settings"))
            account.is_active = not account.is_active
            account.save(update_fields=["is_active"])
            messages.success(request, f"Updated active status for {account.email or account.username}.")
            return redirect(reverse("admin_settings"))
        if action == "revoke_admin":
            admin_id = request.POST.get("admin_id")
            account = get_object_or_404(User, pk=admin_id, is_staff=True)
            if account.pk == request.user.pk:
                messages.error(request, "You cannot revoke your own admin access.")
                return redirect(reverse("admin_settings"))
            account.is_staff = False
            account.save(update_fields=["is_staff"])
            messages.success(request, f"Revoked admin access for {account.email or account.username}.")
            return redirect(reverse("admin_settings"))

    admin_accounts = User.objects.filter(is_staff=True).order_by("first_name", "username")
    portal = PortalSettings.get_solo()
    storage_used = round((Book.objects.count() * 0.12) + (ActivityConfig.objects.count() * 0.04), 1)
    storage_total = portal_conf.effective_storage_plan_total_gb()

    effective_stripe_secret = portal_conf.effective_stripe_secret_key()
    effective_stripe_wh = portal_conf.effective_stripe_webhook_secret()
    effective_lk_key = portal_conf.effective_livekit_api_key()
    effective_lk_secret = portal_conf.effective_livekit_api_secret()
    effective_lk_url = portal_conf.effective_livekit_url()

    context = {
        "active_nav": "settings",
        "platform_settings": {
            "platform_name": portal_conf.effective_platform_name(),
            "support_email": portal_conf.effective_support_email(),
            "default_from_email": portal_conf.effective_default_from_email(),
            "public_base_url": portal_conf.effective_public_base_url(request),
            "email_backend": getattr(django_settings, "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"),
        },
        "session_defaults": {
            "duration": portal.default_session_duration_minutes,
            "warning_one": portal.session_warning_one_minutes,
            "warning_two": portal.session_warning_two_minutes,
            "link_type": portal.invite_link_type_label or "Single use",
        },
        "stripe_settings": {
            "secret_masked": _mask_secret(effective_stripe_secret, 7),
            "webhook_masked": _mask_secret(effective_stripe_wh, 7),
            "secret_saved_db": bool(portal.stripe_secret_key.strip()),
            "webhook_saved_db": bool(portal.stripe_webhook_secret.strip()),
            "uses_env_secret": bool(not portal.stripe_secret_key.strip() and getattr(django_settings, "STRIPE_SECRET_KEY", "")),
            "uses_env_webhook": bool(not portal.stripe_webhook_secret.strip() and getattr(django_settings, "STRIPE_WEBHOOK_SECRET", "")),
        },
        "livekit_settings": {
            "api_masked": _mask_secret(effective_lk_key, 4),
            "secret_masked": _mask_secret(effective_lk_secret, 4),
            "url_display": effective_lk_url or "Not configured",
            "is_connected": bool(effective_lk_key and effective_lk_secret and effective_lk_url.strip()),
            "key_saved_db": bool(portal.livekit_api_key.strip()),
            "secret_saved_db": bool(portal.livekit_api_secret.strip()),
            "url_saved_db": bool(portal.livekit_url.strip()),
        },
        "storage_usage": {
            "used": storage_used,
            "total": storage_total,
            "percent": min(_percentage(storage_used, storage_total), 100),
        },
        "admin_accounts": admin_accounts,
        "portal": portal,
    }
    return render(request, "core/admin_settings.html", context)
