import json
import secrets
from urllib.parse import parse_qs, unquote, urlparse

from django.conf import settings as django_settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.contrib.auth import get_user_model, login as auth_login
from django.db.models import Count, Max, Q
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
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
    ReadingReminder,
    ReadingSession,
    SessionEvent,
    SessionInvite,
    SessionParticipant,
    UserBadge,
)
from .serializers import ActivityConfigSerializer, BookSerializer, LoginSerializer, RegisterSerializer

User = get_user_model()


def _normalize_cover_image_url(raw_url):
    """Convert common pasted search URLs into a direct image URL."""
    url = (raw_url or "").strip()
    if not url:
        return ""

    if url.startswith("//"):
        return f"https:{url}"

    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc and "google." in parsed.netloc and parsed.path.startswith("/imgres"):
        params = parse_qs(parsed.query)
        image_candidate = (params.get("imgurl") or [""])[0].strip()
        if image_candidate:
            return unquote(image_candidate)

    return url


def home(request):
    return render(request, "core/home.html")


def _auth_redirect_target(request, user=None):
    default_target = reverse("super_admin_dashboard") if user and user.is_staff else reverse("home")
    candidate = request.POST.get("next") or request.GET.get("next") or default_target

    if candidate in {"/login", "/login/", reverse("login")}:
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
                "book_title": session.book.title,
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
                "book_title": session.book.title,
                "room_type": session.get_room_type_display(),
                "host_name": host_name,
                "guest_name": guest_name,
                "progress_percent": min(_percentage(session.current_page, max(session.book.page_count, 1)), 100),
                "progress_label": f"Page {session.current_page}/{max(session.book.page_count, 1)}",
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
                    "message": f"{session.get_status_display()} session for {session.book.title}",
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
    status_filter = request.GET.get("status", "").strip()

    if q:
        sessions = sessions.filter(
            Q(book__title__icontains=q)
            | Q(child_profile__display_name__icontains=q)
            | Q(created_by__username__icontains=q)
            | Q(participants__display_name__icontains=q)
        ).distinct()
    if status_filter:
        sessions = sessions.filter(status=status_filter)

    context = {
        "active_nav": "sessions",
        "session_rows": _build_session_rows(sessions[:50]),
        "query": q,
        "status_filter": status_filter,
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
    selected_book = None
    book_errors = None

    if request.method == "POST":
        action = request.POST.get("action")

        if action == "save":
            book_id = request.POST.get("book_id")
            selected_book = Book.objects.filter(pk=book_id).first() if book_id else None
            publish_state = request.POST.get("publish_state", "").strip()
            payload = {
                "title": request.POST.get("title", "").strip(),
                "slug": (request.POST.get("slug", "").strip() or slugify(request.POST.get("title", ""))),
                "description": request.POST.get("description", "").strip(),
                "room_type": request.POST.get("room_type", Book.RoomType.READING),
                "age_band": request.POST.get("age_band", Book.AgeBand.AGE_3_5),
                "cover_image": _normalize_cover_image_url(request.POST.get("cover_image", "")),
                "published": publish_state == "published" if publish_state in {"draft", "published"} else request.POST.get("published") == "on",
                "page_count": request.POST.get("page_count") or 1,
            }
            serializer = BookSerializer(selected_book, data=payload, partial=bool(selected_book))
            if serializer.is_valid():
                saved_book = serializer.save()
                messages.success(request, f"Book '{saved_book.title}' saved successfully.")
                return redirect(f"{reverse('admin_book_library')}?selected={saved_book.id}")
            book_errors = serializer.errors
        elif action == "toggle_publish":
            book = get_object_or_404(Book, pk=request.POST.get("book_id"))
            book.published = not book.published
            book.save(update_fields=["published", "updated_at"])
            messages.success(request, f"Updated publish status for '{book.title}'.")
            return redirect(reverse("admin_book_library"))
        elif action == "delete":
            book = get_object_or_404(Book, pk=request.POST.get("book_id"))
            title = book.title
            book.delete()
            messages.success(request, f"Deleted '{title}' from the library.")
            return redirect(reverse("admin_book_library"))
        elif action == "add_page":
            book = get_object_or_404(Book, pk=request.POST.get("book_id"))
            page_number = request.POST.get("page_number", "").strip()
            image_url = request.POST.get("image_url", "").strip()
            if page_number and image_url:
                BookPage.objects.update_or_create(
                    book=book, page_number=int(page_number),
                    defaults={"image_url": image_url},
                )
                book.page_count = book.pages.count()
                book.save(update_fields=["page_count", "updated_at"])
                messages.success(request, f"Page {page_number} saved for '{book.title}'.")
            return redirect(f"{reverse('admin_book_library')}?selected={book.pk}")
        elif action == "delete_page":
            page = get_object_or_404(BookPage, pk=request.POST.get("page_id"))
            book = page.book
            page.delete()
            book.page_count = book.pages.count()
            book.save(update_fields=["page_count", "updated_at"])
            messages.success(request, "Page deleted.")
            return redirect(f"{reverse('admin_book_library')}?selected={book.pk}")

    if not selected_book:
        selected_id = request.GET.get("selected")
        if selected_id:
            selected_book = Book.objects.filter(pk=selected_id).first()

    books = Book.objects.annotate(activity_total=Count("activity_configs")).order_by("title")
    query = request.GET.get("q", "").strip()
    room_type = request.GET.get("room_type", "").strip()
    age_band = request.GET.get("age_band", "").strip()
    status_filter = request.GET.get("status", "").strip()

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

    selected_pages = selected_book.pages.all() if selected_book else []

    context = {
        "active_nav": "books",
        "books": books[:100],
        "selected_book": selected_book,
        "selected_pages": selected_pages,
        "book_errors": book_errors,
        "query": query,
        "room_type_filter": room_type,
        "age_band_filter": age_band,
        "status_filter": status_filter,
        "book_stats": {
            "total": Book.objects.count(),
            "published": Book.objects.filter(published=True).count(),
            "drafts": Book.objects.filter(published=False).count(),
            "activities": ActivityConfig.objects.count(),
        },
        "room_type_choices": Book.RoomType.choices,
        "age_band_choices": Book.AgeBand.choices,
    }
    return render(request, "core/admin_book_library.html", context)


@staff_member_required
def admin_activity_config(request):
    def _to_int(value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _to_float(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _build_config_from_post(post_data, activity_type, book_id, title_value):
        ui_title = (post_data.get("ui_title") or title_value or "Activity").strip()
        ui_instructions = (post_data.get("ui_instructions") or "Complete the activity.").strip()
        ui_theme = (post_data.get("ui_theme") or "default").strip() or "default"
        payload = {}

        if activity_type == ActivityConfig.ActivityType.DRAWING:
            palette = [item.strip() for item in (post_data.get("drawing_palette") or "").split(",") if item.strip()]
            brush_sizes = [
                _to_float(item.strip())
                for item in (post_data.get("drawing_brush_sizes") or "").split(",")
                if item.strip()
            ]
            payload = {
                "palette": palette or ["#1f2937", "#e11d48"],
                "brush_sizes": [size for size in brush_sizes if isinstance(size, (int, float)) and size > 0] or [4, 8],
                "allow_eraser": post_data.get("drawing_allow_eraser") == "on",
            }
        elif activity_type == ActivityConfig.ActivityType.QUIZ:
            options = [item.strip() for item in post_data.getlist("quiz_options[]") if item.strip()]
            payload = {
                "question": (post_data.get("quiz_question") or "").strip(),
                "options": options,
                "correct_index": _to_int(post_data.get("quiz_correct_index"), 0),
                "reveal_mode": (post_data.get("quiz_reveal_mode") or "host_controlled").strip(),
            }
        elif activity_type == ActivityConfig.ActivityType.DRAG_DROP:
            payload = {
                "items": [item.strip() for item in post_data.getlist("drag_items[]") if item.strip()],
                "drop_zones": [item.strip() for item in post_data.getlist("drag_zones[]") if item.strip()],
            }
        elif activity_type == ActivityConfig.ActivityType.HOTSPOT:
            hotspot_ids = post_data.getlist("hotspot_id[]")
            hotspot_x = post_data.getlist("hotspot_x[]")
            hotspot_y = post_data.getlist("hotspot_y[]")
            hotspot_w = post_data.getlist("hotspot_w[]")
            hotspot_h = post_data.getlist("hotspot_h[]")
            hotspot_content = post_data.getlist("hotspot_content[]")
            max_len = max(
                len(hotspot_ids),
                len(hotspot_x),
                len(hotspot_y),
                len(hotspot_w),
                len(hotspot_h),
                len(hotspot_content),
                default=0,
            )
            hotspots = []
            for idx in range(max_len):
                row = {
                    "id": (hotspot_ids[idx] if idx < len(hotspot_ids) else "").strip(),
                    "x": _to_float(hotspot_x[idx] if idx < len(hotspot_x) else 0),
                    "y": _to_float(hotspot_y[idx] if idx < len(hotspot_y) else 0),
                    "w": _to_float(hotspot_w[idx] if idx < len(hotspot_w) else 0),
                    "h": _to_float(hotspot_h[idx] if idx < len(hotspot_h) else 0),
                    "content": (hotspot_content[idx] if idx < len(hotspot_content) else "").strip(),
                }
                if row["id"] or row["content"]:
                    row["x"] = row["x"] if row["x"] is not None else 0
                    row["y"] = row["y"] if row["y"] is not None else 0
                    row["w"] = row["w"] if row["w"] is not None else 0
                    row["h"] = row["h"] if row["h"] is not None else 0
                    hotspots.append(row)
            payload = {
                "image_url": (post_data.get("hotspot_image_url") or "").strip(),
                "hotspots": hotspots,
            }

        return {
            "schema_version": ActivityConfig.SCHEMA_VERSION,
            "activity_type": activity_type,
            "book_id": str(book_id),
            "ui": {
                "title": ui_title,
                "instructions": ui_instructions,
                "theme": ui_theme,
            },
            "payload": payload,
            "validation": {},
        }

    selected_activity = None
    activity_errors = None
    selected_activity_json = "{}"
    selected_activity_config = {}

    if request.method == "POST":
        action = request.POST.get("action")

        if action == "save":
            activity_id = request.POST.get("activity_id")
            selected_activity = ActivityConfig.objects.filter(pk=activity_id).first() if activity_id else None
            raw_json = request.POST.get("config_json", "{}").strip() or "{}"
            activity_type = request.POST.get("activity_type", ActivityConfig.ActivityType.DRAWING)
            book_id = request.POST.get("book")
            title_value = request.POST.get("title", "").strip()
            try:
                parsed_config = json.loads(raw_json)
            except json.JSONDecodeError:
                parsed_config = None

            if not isinstance(parsed_config, dict) or not parsed_config or parsed_config.get("schema_version") != ActivityConfig.SCHEMA_VERSION:
                parsed_config = _build_config_from_post(request.POST, activity_type, book_id, title_value)

            payload = {
                "book": book_id,
                "title": title_value,
                "activity_type": activity_type,
                "config": parsed_config,
                "sort_order": request.POST.get("sort_order") or 0,
                "is_active": request.POST.get("is_active") == "on",
            }
            serializer = ActivityConfigSerializer(selected_activity, data=payload, partial=bool(selected_activity))
            if serializer.is_valid():
                saved_activity = serializer.save()
                messages.success(request, f"Activity config '{saved_activity.title}' saved successfully.")
                return redirect(f"{reverse('admin_activity_config')}?selected={saved_activity.id}")
            activity_errors = serializer.errors
            selected_activity_json = json.dumps(parsed_config or {}, indent=2)
        elif action == "delete":
            activity = get_object_or_404(ActivityConfig, pk=request.POST.get("activity_id"))
            title = activity.title
            activity.delete()
            messages.success(request, f"Deleted activity config '{title}'.")
            return redirect(reverse("admin_activity_config"))

    if not selected_activity:
        selected_id = request.GET.get("selected")
        if selected_id:
            selected_activity = ActivityConfig.objects.filter(pk=selected_id).select_related("book").first()
            if selected_activity:
                selected_activity_json = json.dumps(selected_activity.config, indent=2)
                selected_activity_config = selected_activity.config or {}
    elif selected_activity and not selected_activity_config:
        selected_activity_config = selected_activity.config or {}

    activities = ActivityConfig.objects.select_related("book").order_by("book__title", "sort_order", "title")
    query = request.GET.get("q", "").strip()
    type_filter = request.GET.get("activity_type", "").strip()
    if query:
        activities = activities.filter(Q(title__icontains=query) | Q(book__title__icontains=query))
    if type_filter:
        activities = activities.filter(activity_type=type_filter)

    context = {
        "active_nav": "activities",
        "activities": activities[:100],
        "selected_activity": selected_activity,
        "selected_activity_json": selected_activity_json,
        "selected_activity_config": selected_activity_config,
        "activity_errors": activity_errors,
        "query": query,
        "type_filter": type_filter,
        "books": Book.objects.order_by("title"),
        "activity_type_choices": ActivityConfig.ActivityType.choices,
        "activity_stats": {
            "total": ActivityConfig.objects.count(),
            "drawing": ActivityConfig.objects.filter(activity_type=ActivityConfig.ActivityType.DRAWING).count(),
            "drag_drop": ActivityConfig.objects.filter(activity_type=ActivityConfig.ActivityType.DRAG_DROP).count(),
            "quiz": ActivityConfig.objects.filter(activity_type=ActivityConfig.ActivityType.QUIZ).count(),
        },
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
    }
    return render(request, "core/admin_users.html", context)


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


@staff_member_required
def admin_badges(request):
    """Badge catalogue and award activity based on Badge and UserBadge data."""
    if request.method == "POST" and request.POST.get("action") == "revoke_award":
        award = get_object_or_404(UserBadge, pk=request.POST.get("award_id"))
        badge_id = award.badge_id
        award.delete()
        messages.success(request, "Badge award revoked.")
        return redirect(f"{reverse('admin_badges')}?selected={badge_id}")

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
    context = {
        "active_nav": "badges",
        "badge_rows": badge_rows,
        "selected_badge": selected_badge,
        "recent_awards": recent_awards,
        "selected_badge_award_rows": selected_badge_award_rows,
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
    live_queryset = (
        ReadingSession.objects.filter(status__in=[ReadingSession.Status.ACTIVE, ReadingSession.Status.RECONNECTING, ReadingSession.Status.LOBBY])
        .select_related("book", "child_profile", "created_by")
        .prefetch_related("participants", "events")
        .order_by("-updated_at")
    )
    recent_queryset = (
        ReadingSession.objects.select_related("book", "child_profile", "created_by")
        .prefetch_related("participants", "events")
        .order_by("-created_at")
    )

    selected_id = request.GET.get("session")
    selected_session = None
    if selected_id:
        selected_session = recent_queryset.filter(pk=selected_id).first()
    if not selected_session:
        selected_session = live_queryset.first() or recent_queryset.first()

    event_timeline = []
    if selected_session:
        timeline_source = selected_session.events.select_related("participant").order_by("created_at")[:10]
        for event in timeline_source:
            event_timeline.append(
                {
                    "label": event.get_event_type_display(),
                    "meta": (event.participant.display_name if event.participant else "System"),
                    "timestamp": timezone.localtime(event.created_at).strftime("%I:%M:%S %p"),
                    "detail": event.payload or {},
                }
            )
        if not event_timeline:
            event_timeline.append(
                {
                    "label": "Session created",
                    "meta": selected_session.created_by.get_full_name() or selected_session.created_by.username,
                    "timestamp": timezone.localtime(selected_session.created_at).strftime("%I:%M:%S %p"),
                    "detail": {"status": selected_session.get_status_display()},
                }
            )

    context = {
        "active_nav": "live_sessions",
        "active_count": live_queryset.count(),
        "live_rows": _build_live_session_cards(live_queryset[:3]),
        "selected_session": selected_session,
        "selected_timeline": event_timeline,
        "selected_hosts": [p for p in selected_session.participants.all() if p.session_role == SessionParticipant.SessionRole.HOST] if selected_session else [],
        "selected_guests": [p for p in selected_session.participants.all() if p.session_role != SessionParticipant.SessionRole.HOST] if selected_session else [],
        "recent_session_rows": _build_session_rows(recent_queryset[:10]),
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
        timeline.append({
            "label": event.get_event_type_display(),
            "meta": event.participant.display_name if event.participant else "System",
            "timestamp": timezone.localtime(event.created_at).strftime("%d %b %H:%M:%S"),
            "payload": event.payload,
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
        "can_cancel": can_cancel,
        "duration": _session_duration_label(session),
    }
    return render(request, "core/admin_session_detail.html", context)


@staff_member_required
def admin_settings(request):
    """Operational settings snapshot + admin invite flow."""
    if request.method == "POST" and request.POST.get("action") == "invite_admin":
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

    admin_accounts = User.objects.filter(is_staff=True).order_by("first_name", "username")
    storage_used = round((Book.objects.count() * 0.12) + (ActivityConfig.objects.count() * 0.04), 1)
    storage_total = 50

    context = {
        "active_nav": "settings",
        "platform_settings": {
            "platform_name": "Bailey & Beau",
            "support_email": getattr(django_settings, "SUPPORT_EMAIL", "support@baileyandbeau.local"),
            "default_from_email": getattr(django_settings, "DEFAULT_FROM_EMAIL", "no-reply@baileyandbeau.local"),
            "base_url": request.build_absolute_uri("/").rstrip("/"),
            "email_backend": getattr(django_settings, "EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend"),
        },
        "session_defaults": {
            "duration": 20,
            "warning_one": 5,
            "warning_two": 2,
            "link_type": "Single use",
            "clear_canvas": True,
        },
        "stripe_settings": {
            "secret_key": _mask_secret(getattr(django_settings, "STRIPE_SECRET_KEY", ""), 7),
            "webhook_secret": _mask_secret(getattr(django_settings, "STRIPE_WEBHOOK_SECRET", ""), 7),
        },
        "livekit_settings": {
            "api_key": _mask_secret(getattr(django_settings, "LIVEKIT_API_KEY", ""), 4),
            "api_secret": _mask_secret(getattr(django_settings, "LIVEKIT_API_SECRET", ""), 4),
            "url": getattr(django_settings, "LIVEKIT_URL", "Not configured") or "Not configured",
            "is_connected": bool(getattr(django_settings, "LIVEKIT_API_KEY", "") and getattr(django_settings, "LIVEKIT_API_SECRET", "")),
        },
        "storage_usage": {
            "used": storage_used,
            "total": storage_total,
            "percent": min(_percentage(storage_used, storage_total), 100),
        },
        "admin_accounts": admin_accounts,
    }
    return render(request, "core/admin_settings.html", context)
