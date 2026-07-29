import csv
import json
import logging
import secrets
from datetime import timedelta
from io import StringIO

import stripe

from asgiref.sync import async_to_sync
from django.conf import settings as django_settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status
from django.http import HttpResponse
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

try:
    from livekit import api as livekit_api
except ImportError:  # pragma: no cover - dependency is optional during early setup
    livekit_api = None

try:
    import pdf2image
except ImportError:  # poppler/pdf2image not available on all environments
    pdf2image = None

from . import portal_settings as portal_conf
from .models import ActivityConfig, Badge, Book, BookPage, BookTheme, ChildProfile, Entitlement, FavoriteBook, NotificationPreference, ReadingReminder, ReadingSession, SessionEvent, SessionInvite, SessionParticipant, SessionSnapshot, UserBadge
from .serializers import (
    BookThemeSerializer,
    BookThemeWriteSerializer,
    ActivityConfigSerializer,
    AdminBadgeAwardSerializer,
    AdminChildProfileSerializer,
    AdminEntitlementSerializer,
    AdminSessionDetailSerializer,
    AdminSessionEventSerializer,
    BadgeCatalogSerializer,
    BadgeSerializer,
    BookPageSerializer,
    BookSerializer,
    ChildProfileSerializer,
    EntitlementSerializer,
    FavoriteBookSerializer,
    LoginSerializer,
    NotificationPreferenceSerializer,
    ReadingReminderSerializer,
    ReadingSessionSerializer,
    RegisterSerializer,
    SessionCreateSerializer,
    SessionEventSerializer,
    SessionInviteSerializer,
    SessionParticipantSerializer,
    UserSerializer,
)


User = get_user_model()
logger = logging.getLogger(__name__)


def _private_no_store_response(payload, status_code=status.HTTP_200_OK):
    """Mark responses as non-cacheable by shared caches (earned badges, dashboard PII)."""
    response = Response(payload, status=status_code)
    response["Cache-Control"] = "private, no-store"
    return response


BILLING_PLANS = [
    {
        "code": "monthly-starter",
        "name": "Starter",
        "price_gbp": "9.99",
        "interval": "month",
        "sessions_included": 8,
    },
    {
        "code": "monthly-plus",
        "name": "Plus",
        "price_gbp": "17.99",
        "interval": "month",
        "sessions_included": 20,
    },
    {
        "code": "session-pack-5",
        "name": "5 Session Pack",
        "price_gbp": "6.99",
        "interval": "one_off",
        "sessions_included": 5,
    },
]


def build_token_payload(user):
    refresh = RefreshToken.for_user(user)
    return {
        "user": UserSerializer(user).data,
        "tokens": {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        },
    }


def get_user_entitlement(user):
    entitlement, _ = Entitlement.objects.get_or_create(user=user)
    return entitlement


def get_plan_by_code(plan_code):
    return next((item for item in BILLING_PLANS if item["code"] == plan_code), None)


def consume_session_credit(entitlement):
    if entitlement.sessions_remaining > 0:
        entitlement.sessions_remaining -= 1
    elif entitlement.pack_sessions_remaining > 0:
        entitlement.pack_sessions_remaining -= 1
    else:
        return False

    entitlement.save(update_fields=["sessions_remaining", "pack_sessions_remaining", "updated_at"])
    return True


def sync_entitlement_from_stripe_event(event_payload):
    event_type = event_payload.get("type", "unknown")
    data_object = (event_payload.get("data") or {}).get("object") or {}

    customer_email = data_object.get("customer_email")
    stripe_customer_id = data_object.get("customer", "")
    stripe_subscription_id = data_object.get("subscription") or data_object.get("id", "")

    entitlement = None
    if stripe_customer_id:
        entitlement = Entitlement.objects.filter(stripe_customer_id=stripe_customer_id).select_related("user").first()
    if not entitlement and customer_email:
        entitlement = Entitlement.objects.filter(user__email__iexact=customer_email).select_related("user").first()
    if not entitlement and customer_email:
        user = User.objects.filter(email__iexact=customer_email).first()
        if user:
            entitlement, _ = Entitlement.objects.get_or_create(user=user)
    if not entitlement:
        return False, None

    if event_type == "invoice.paid":
        lines = (data_object.get("lines") or {}).get("data") or []
        line = lines[0] if lines else {}
        price = line.get("price") or {}
        metadata = line.get("metadata") or {}
        price_metadata = price.get("metadata") or {}
        plan_code = price_metadata.get("plan_code") or metadata.get("plan_code") or entitlement.plan_code
        sessions_included = int(metadata.get("sessions_included") or 0)

        plan = get_plan_by_code(plan_code) if plan_code else None
        if sessions_included <= 0 and plan:
            sessions_included = plan["sessions_included"]

        entitlement.subscription_status = Entitlement.SubscriptionStatus.ACTIVE
        entitlement.plan_code = plan_code or entitlement.plan_code
        entitlement.stripe_customer_id = stripe_customer_id or entitlement.stripe_customer_id
        entitlement.stripe_subscription_id = stripe_subscription_id or entitlement.stripe_subscription_id
        entitlement.stripe_price_id = price.get("id", entitlement.stripe_price_id)
        entitlement.last_webhook_event = event_type

        if plan and plan.get("interval") == "one_off":
            entitlement.pack_sessions_remaining += sessions_included
        else:
            entitlement.sessions_included = sessions_included
            entitlement.sessions_remaining = sessions_included

        entitlement.save()
        return True, entitlement

    if event_type in {"customer.subscription.deleted", "invoice.payment_failed"}:
        entitlement.subscription_status = (
            Entitlement.SubscriptionStatus.CANCELLED
            if event_type == "customer.subscription.deleted"
            else Entitlement.SubscriptionStatus.PAST_DUE
        )
        entitlement.last_webhook_event = event_type
        if event_type == "customer.subscription.deleted":
            entitlement.sessions_remaining = 0
        entitlement.stripe_customer_id = stripe_customer_id or entitlement.stripe_customer_id
        entitlement.stripe_subscription_id = stripe_subscription_id or entitlement.stripe_subscription_id
        entitlement.save()
        return True, entitlement

    entitlement.last_webhook_event = event_type
    entitlement.stripe_customer_id = stripe_customer_id or entitlement.stripe_customer_id
    entitlement.stripe_subscription_id = stripe_subscription_id or entitlement.stripe_subscription_id
    entitlement.save()
    return True, entitlement


def _livekit_server_url():
    url = (portal_conf.effective_livekit_url() or "").strip()
    if url.startswith("wss://"):
        return "https://" + url[len("wss://"):]
    if url.startswith("ws://"):
        return "http://" + url[len("ws://"):]
    return url


def _livekit_is_configured():
    return bool(
        livekit_api
        and portal_conf.effective_livekit_api_key()
        and portal_conf.effective_livekit_api_secret()
        and portal_conf.effective_livekit_url().strip()
    )


async def _ensure_livekit_room_async(server_url, api_key, api_secret, room_name):
    # Config values are resolved by the sync caller — never touch the DB here
    # (PortalSettings lookups raise SynchronousOnlyOperation inside async context).
    client = livekit_api.LiveKitAPI(server_url, api_key, api_secret)
    try:
        await client.room.create_room(
            livekit_api.CreateRoomRequest(name=room_name, empty_timeout=10 * 60, max_participants=6)
        )
        return True
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        if "already exists" in message or "alreadyexists" in message:
            return True
        logger.warning("LiveKit room creation failed for %s: %s", room_name, exc)
        return False
    finally:
        await client.aclose()


def ensure_livekit_room(session):
    if not getattr(session, "livekit_room_name", ""):
        return False
    if not _livekit_is_configured():
        return False
    # Resolve config (DB-backed) in sync context, then pass into the async helper.
    server_url = _livekit_server_url()
    api_key = portal_conf.effective_livekit_api_key()
    api_secret = portal_conf.effective_livekit_api_secret()
    try:
        return async_to_sync(_ensure_livekit_room_async)(
            server_url, api_key, api_secret, session.livekit_room_name
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("LiveKit room ensure failed for %s: %s", session.livekit_room_name, exc)
        return False


async def _delete_livekit_room_async(server_url, api_key, api_secret, room_name):
    client = livekit_api.LiveKitAPI(server_url, api_key, api_secret)
    try:
        await client.room.delete_room(livekit_api.DeleteRoomRequest(room=room_name))
        return True
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        if "not found" in message or "does not exist" in message:
            return True
        logger.warning("LiveKit room delete failed for %s: %s", room_name, exc)
        return False
    finally:
        await client.aclose()


def delete_livekit_room(session):
    if not getattr(session, "livekit_room_name", "") or not _livekit_is_configured():
        return False
    server_url = _livekit_server_url()
    api_key = portal_conf.effective_livekit_api_key()
    api_secret = portal_conf.effective_livekit_api_secret()
    try:
        return async_to_sync(_delete_livekit_room_async)(
            server_url, api_key, api_secret, session.livekit_room_name
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("LiveKit room cleanup failed for %s: %s", session.livekit_room_name, exc)
        return False


def build_realtime_token(session, participant):
    ensure_livekit_room(session)

    if _livekit_is_configured():
        try:
            ttl = timedelta(minutes=getattr(django_settings, "LIVEKIT_TOKEN_TTL_MINUTES", 120))
            grants = livekit_api.VideoGrants(
                room_join=True,
                room=session.livekit_room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
            metadata = json.dumps(
                {
                    "session_id": str(session.id),
                    "participant_id": str(participant.id),
                    "role": (
                        "guest"
                        if participant.participant_type == SessionParticipant.ParticipantType.GUEST
                        and participant.session_role != SessionParticipant.SessionRole.HOST
                        else participant.session_role
                    ),
                    "participant_type": participant.participant_type,
                }
            )
            token = (
                livekit_api.AccessToken(
                    portal_conf.effective_livekit_api_key(),
                    portal_conf.effective_livekit_api_secret(),
                )
                .with_identity(str(participant.id))
                .with_name(participant.display_name or str(participant.id))
                .with_metadata(metadata)
                .with_ttl(ttl)
                .with_grants(grants)
            )
            return token.to_jwt()
        except Exception as exc:  # noqa: BLE001
            logger.warning("LiveKit token generation failed for session %s / participant %s: %s", session.id, participant.id, exc)

    token_fragment = secrets.token_urlsafe(18)
    return f"livekit-{session.id}-{participant.id}-{token_fragment}"


def award_session_badges(session):
    completed_count = ReadingSession.objects.filter(
        child_profile=session.child_profile,
        status=ReadingSession.Status.COMPLETED,
    ).count()
    eligible_badges = Badge.objects.filter(is_active=True, trigger_type="session_completed")
    awarded = []

    for badge in eligible_badges:
        milestone = int((badge.trigger_config or {}).get("milestone", 1))
        if completed_count >= milestone:
            _, created = UserBadge.objects.get_or_create(
                child_profile=session.child_profile,
                badge=badge,
                session=session,
            )
            if created:
                awarded.append(badge.name)
    return awarded


def build_recent_sessions_payload(sessions):
    return [
        {
            "id": str(session.id),
            "book_title": session.book.title,
            "child_name": session.child_profile.display_name,
            "status": session.status,
            "room_type": session.room_type,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "ended_at": session.ended_at.isoformat() if session.ended_at else None,
        }
        for session in sessions
    ]


class HealthCheckView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(
            {
                "data": {"status": "ok", "service": "bailey-beau-backend"},
                "meta": {},
                "error": None,
            }
        )


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        get_user_entitlement(user)
        return Response(
            {"data": build_token_payload(user), "meta": {}, "error": None},
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        return Response({"data": build_token_payload(user), "meta": {}, "error": None})


class TokenRefreshApiView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        refresh_token = request.data.get("refresh")
        if not refresh_token:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "validation_error", "message": "Refresh token is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            refresh = RefreshToken(refresh_token)
        except Exception:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "invalid_token", "message": "Refresh token is invalid."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        return Response(
            {
                "data": {"access": str(refresh.access_token)},
                "meta": {},
                "error": None,
            }
        )


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({"data": UserSerializer(request.user).data, "meta": {}, "error": None})

    def patch(self, request):
        user = request.user
        update_fields: list[str] = []
        if "first_name" in request.data:
            user.first_name = request.data["first_name"]
            update_fields.append("first_name")
        if "last_name" in request.data:
            user.last_name = request.data["last_name"]
            update_fields.append("last_name")
        if update_fields:
            user.save(update_fields=update_fields)
        return Response({"data": UserSerializer(user).data, "meta": {}, "error": None})


class MeDeleteView(APIView):
    """GDPR right to erasure — deletes the authenticated user and all their data."""
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        user = request.user
        user.delete()
        return Response({"data": None, "meta": {"deleted": True}, "error": None}, status=status.HTTP_200_OK)


class MeExportView(APIView):
    """GDPR data portability — returns a JSON export of the user's personal data."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        children = list(
            ChildProfile.objects.filter(user=user, is_active=True).values(
                "id", "display_name", "age_band", "created_at"
            )
        )
        sessions = list(
            ReadingSession.objects.filter(created_by=user).values(
                "id", "status", "room_type", "current_page", "started_at", "ended_at", "created_at"
            )
        )
        reminders = list(
            ReadingReminder.objects.filter(user=user).values(
                "id", "title", "frequency", "time_of_day", "is_active", "created_at"
            )
        )
        payload = {
            "account": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "date_joined": user.date_joined.isoformat(),
            },
            "children": children,
            "sessions": sessions,
            "reminders": reminders,
        }
        response = HttpResponse(
            json.dumps(payload, indent=2, default=str),
            content_type="application/json",
        )
        response["Content-Disposition"] = 'attachment; filename="bailey-and-beau-data-export.json"'
        return response


class BillingPlansView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({"data": BILLING_PLANS, "meta": {"count": len(BILLING_PLANS)}, "error": None})


class NotificationPreferenceView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        preferences, _ = NotificationPreference.objects.get_or_create(user=request.user)
        return Response({"data": NotificationPreferenceSerializer(preferences).data, "meta": {}, "error": None})

    def patch(self, request):
        preferences, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(preferences, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_preferences = serializer.save()
        return Response({"data": NotificationPreferenceSerializer(updated_preferences).data, "meta": {}, "error": None})


class ReadingReminderListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        reminders = ReadingReminder.objects.filter(user=request.user).select_related("child_profile")
        serializer = ReadingReminderSerializer(reminders, many=True)
        return Response({"data": serializer.data, "meta": {"count": reminders.count()}, "error": None})

    def post(self, request):
        serializer = ReadingReminderSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        reminder = serializer.save()
        return Response({"data": ReadingReminderSerializer(reminder).data, "meta": {}, "error": None}, status=status.HTTP_201_CREATED)


class ReadingReminderDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request, pk):
        return ReadingReminder.objects.filter(id=pk, user=request.user).select_related("child_profile").first()

    def patch(self, request, pk):
        reminder = self.get_object(request, pk)
        if not reminder:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Reminder not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        serializer = ReadingReminderSerializer(reminder, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        return Response({"data": ReadingReminderSerializer(updated).data, "meta": {}, "error": None})

    def delete(self, request, pk):
        reminder = self.get_object(request, pk)
        if not reminder:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Reminder not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        reminder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        children = ChildProfile.objects.filter(user=request.user, is_active=True)
        sessions = ReadingSession.objects.filter(created_by=request.user).select_related("book", "child_profile")
        completed_sessions = sessions.filter(status=ReadingSession.Status.COMPLETED)
        active_sessions = sessions.filter(status=ReadingSession.Status.ACTIVE)
        badges = UserBadge.objects.filter(child_profile__user=request.user)
        recent_sessions = sessions.order_by("-created_at")[:5]

        return _private_no_store_response(
            {
                "data": {
                    "children_count": children.count(),
                    "completed_sessions_count": completed_sessions.count(),
                    "active_sessions_count": active_sessions.count(),
                    "badges_count": badges.count(),
                    "recent_sessions": build_recent_sessions_payload(recent_sessions),
                },
                "meta": {},
                "error": None,
            }
        )


class AdminBookListCreateView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        books = Book.objects.all()
        published = request.query_params.get("published")
        room_type = request.query_params.get("room_type")
        if published in {"true", "false"}:
            books = books.filter(published=(published == "true"))
        if room_type:
            books = books.filter(room_type=room_type)
        books = books.order_by("title")
        serializer = BookSerializer(books, many=True)
        return Response({"data": serializer.data, "meta": {"count": books.count()}, "error": None})

    def post(self, request):
        serializer = BookSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        book = serializer.save()
        return Response({"data": BookSerializer(book).data, "meta": {}, "error": None}, status=status.HTTP_201_CREATED)


class AdminBookDetailView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get_object(self, pk):
        return Book.objects.filter(pk=pk).first()

    def patch(self, request, pk):
        book = self.get_object(pk)
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = BookSerializer(book, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_book = serializer.save()
        return Response({"data": BookSerializer(updated_book).data, "meta": {}, "error": None})

    def delete(self, request, pk):
        book = self.get_object(pk)
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        book.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChildProgressView(APIView):
    """
    Child session history and earned badges for one profile.
    Only the parent who owns the child profile may access this endpoint.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        child = ChildProfile.objects.filter(pk=pk, user=request.user).first()
        if not child:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Child profile not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        sessions = ReadingSession.objects.filter(child_profile=child).select_related("book", "child_profile").order_by("-created_at")
        completed_sessions = sessions.filter(status=ReadingSession.Status.COMPLETED)
        badges = UserBadge.objects.filter(child_profile=child).select_related("badge", "session").order_by("-created_at")

        return _private_no_store_response(
            {
                "data": {
                    "child": ChildProfileSerializer(child).data,
                    "total_sessions_count": sessions.count(),
                    "completed_sessions_count": completed_sessions.count(),
                    "badges": [
                        {
                            "code": award.badge.code,
                            "name": award.badge.name,
                            "description": award.badge.description,
                            "awarded_at": award.created_at.isoformat() if award.created_at else None,
                            "session_id": str(award.session_id),
                        }
                        for award in badges
                    ],
                    "recent_sessions": build_recent_sessions_payload(sessions[:10]),
                },
                "meta": {},
                "error": None,
            }
        )


class AdminSessionReportView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        sessions = ReadingSession.objects.select_related("book", "child_profile", "created_by").all()
        data = [
            {
                "id": str(session.id),
                "book_title": session.book.title,
                "child_name": session.child_profile.display_name,
                "created_by": session.created_by.username,
                "status": session.status,
                "room_type": session.room_type,
                "started_at": session.started_at.isoformat() if session.started_at else None,
                "ended_at": session.ended_at.isoformat() if session.ended_at else None,
            }
            for session in sessions
        ]
        return Response({"data": data, "meta": {"count": len(data)}, "error": None})


class AdminSessionExportView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        sessions = ReadingSession.objects.select_related("book", "child_profile", "created_by").all()
        buffer = StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["session_id", "book_title", "child_name", "created_by", "status", "room_type"])
        for session in sessions:
            writer.writerow([
                str(session.id),
                session.book.title,
                session.child_profile.display_name,
                session.created_by.username,
                session.status,
                session.room_type,
            ])

        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="session-report.csv"'
        return response


class AdminUserListView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        users = User.objects.filter(is_staff=False).select_related("entitlement").order_by("-date_joined")
        q = request.query_params.get("q")
        plan_code = request.query_params.get("plan_code")
        status_filter = request.query_params.get("status")

        if q:
            users = users.filter(
                Q(username__icontains=q)
                | Q(email__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
            )
        if plan_code:
            users = users.filter(entitlement__plan_code=plan_code)
        if status_filter:
            users = users.filter(entitlement__subscription_status=status_filter)

        data = []
        for user in users:
            entitlement = getattr(user, "entitlement", None)
            data.append(
                {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "name": user.get_full_name() or user.username,
                    "plan_code": entitlement.plan_code if entitlement else "",
                    "subscription_status": entitlement.subscription_status if entitlement else "none",
                    "sessions_remaining": entitlement.sessions_remaining if entitlement else 0,
                    "pack_sessions_remaining": entitlement.pack_sessions_remaining if entitlement else 0,
                    "date_joined": user.date_joined.isoformat() if user.date_joined else None,
                }
            )

        return Response({"data": data, "meta": {"count": len(data)}, "error": None})


class StripeWebhookView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        webhook_secret = portal_conf.effective_stripe_webhook_secret()
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')

        if webhook_secret:
            stripe.api_key = portal_conf.effective_stripe_secret_key()
            try:
                event = stripe.Webhook.construct_event(
                    request.body, sig_header, webhook_secret
                )
                payload = event
            except stripe.error.SignatureVerificationError:
                return Response(
                    {"data": None, "meta": {}, "error": {"code": "invalid_signature", "message": "Webhook signature verification failed."}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif not django_settings.DEBUG:
            # In production, reject unsigned webhooks — configure STRIPE_WEBHOOK_SECRET
            return Response(
                {"data": None, "meta": {}, "error": {"code": "misconfigured", "message": "Webhook secret not configured."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        else:
            payload = request.data

        processed, entitlement = sync_entitlement_from_stripe_event(payload)
        if not processed:
            return Response(
                {
                    "data": None,
                    "meta": {},
                    "error": {"code": "customer_not_found", "message": "Stripe customer could not be mapped to a local account."},
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "data": {
                    "received": True,
                    "subscription_status": entitlement.subscription_status,
                    "plan_code": entitlement.plan_code,
                },
                "meta": {},
                "error": None,
            }
        )


class BillingEntitlementView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        entitlement = get_user_entitlement(request.user)
        return Response({"data": EntitlementSerializer(entitlement).data, "meta": {}, "error": None})


class CheckoutSessionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        plan_code = request.data.get("plan_code")
        plan = get_plan_by_code(plan_code)
        if not plan:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "invalid_plan", "message": "Selected billing plan does not exist."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        stripe_key = portal_conf.effective_stripe_secret_key()
        frontend_url = getattr(django_settings, 'FRONTEND_URL', 'http://localhost:3000')

        if not stripe_key:
            # Dev mode stub — no Stripe key configured
            return Response(
                {
                    "data": {
                        "plan": plan,
                        "checkout_url": f"{frontend_url}/dashboard/billing?plan={plan['code']}&stub=1",
                        "mode": "stub",
                    },
                    "meta": {},
                    "error": None,
                }
            )

        stripe.api_key = stripe_key
        is_subscription = plan.get('interval') != 'one_off'

        try:
            price_gbp_pence = int(float(plan['price_gbp']) * 100)
            checkout_session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                mode='subscription' if is_subscription else 'payment',
                line_items=[{
                    'price_data': {
                        'currency': 'gbp',
                        'unit_amount': price_gbp_pence,
                        'product_data': {'name': plan['name']},
                        **(({'recurring': {'interval': plan['interval']}} if is_subscription else {})),
                    },
                    'quantity': 1,
                }],
                customer_email=request.user.email,
                metadata={'plan_code': plan['code'], 'user_id': str(request.user.id)},
                success_url=f"{frontend_url}/dashboard/billing?success=1&plan={plan['code']}",
                cancel_url=f"{frontend_url}/dashboard/billing?cancelled=1",
            )
        except stripe.error.StripeError as e:
            logger.error("Stripe checkout error: %s", e)
            return Response(
                {"data": None, "meta": {}, "error": {"code": "stripe_error", "message": str(e)}},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        return Response(
            {
                "data": {
                    "plan": plan,
                    "checkout_url": checkout_session.url,
                    "mode": "live",
                },
                "meta": {},
                "error": None,
            }
        )


class BookListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # Staff/admin can preview unpublished (draft) books; customers see published only.
        if request.user and request.user.is_staff:
            books = Book.objects.all()
        else:
            books = Book.objects.filter(published=True)

        room_type = request.query_params.get("room_type")
        age_band = request.query_params.get("age_band")
        search = request.query_params.get("search")
        ordering = request.query_params.get("ordering", "title")

        if room_type:
            books = books.filter(room_type=room_type)
        if age_band:
            books = books.filter(age_band=age_band)
        if search:
            books = books.filter(title__icontains=search)
        if ordering.lstrip("-") in {"title", "created_at", "age_band"}:
            books = books.order_by(ordering)

        serializer = BookSerializer(books, many=True)
        return Response({"data": serializer.data, "meta": {"count": books.count()}, "error": None})


class BadgeListView(APIView):
    """
    Authenticated catalog of active badge types (achievement art copy only).
    Does not list who earned what — use GET /me/badges/ for private awards.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        badges = Badge.objects.filter(is_active=True).order_by("name")
        serializer = BadgeCatalogSerializer(badges, many=True)
        response = Response({"data": serializer.data, "meta": {"count": badges.count()}, "error": None})
        response["Cache-Control"] = "private"
        return response


class FavoriteBookListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        favorites = FavoriteBook.objects.filter(user=request.user).select_related("book")
        serializer = FavoriteBookSerializer(favorites, many=True)
        return Response({"data": serializer.data, "meta": {"count": favorites.count()}, "error": None})

    def post(self, request):
        book_id = request.data.get("book_id")
        book = Book.objects.filter(id=book_id, published=True).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Published book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        favorite, created = FavoriteBook.objects.get_or_create(user=request.user, book=book)
        return Response(
            {"data": FavoriteBookSerializer(favorite).data, "meta": {}, "error": None},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FavoriteBookDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, book_id):
        favorite = FavoriteBook.objects.filter(user=request.user, book_id=book_id).first()
        if not favorite:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Favourite book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        favorite.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RecommendedBooksView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        child_profile_id = request.query_params.get("child_profile_id")
        if not child_profile_id:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "validation_error", "message": "child_profile_id is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        child = ChildProfile.objects.filter(id=child_profile_id, user=request.user, is_active=True).first()
        if not child:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Child profile not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        books = Book.objects.filter(published=True, age_band=child.age_band).order_by("title")
        room_type = request.query_params.get("room_type")
        if room_type:
            books = books.filter(room_type=room_type)

        serializer = BookSerializer(books, many=True)
        return Response(
            {
                "data": serializer.data,
                "meta": {"count": books.count(), "recommended_for": child.display_name},
                "error": None,
            }
        )


class AdminBadgeListCreateView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        badges = Badge.objects.all().order_by("name")
        serializer = BadgeSerializer(badges, many=True)
        return Response({"data": serializer.data, "meta": {"count": badges.count()}, "error": None})

    def post(self, request):
        serializer = BadgeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        badge = serializer.save()
        return Response({"data": BadgeSerializer(badge).data, "meta": {}, "error": None}, status=status.HTTP_201_CREATED)


class AdminBadgeDetailView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get_object(self, pk):
        return Badge.objects.filter(pk=pk).first()

    def patch(self, request, pk):
        badge = self.get_object(pk)
        if not badge:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Badge not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = BadgeSerializer(badge, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_badge = serializer.save()
        return Response({"data": BadgeSerializer(updated_badge).data, "meta": {}, "error": None})

    def delete(self, request, pk):
        badge = self.get_object(pk)
        if not badge:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Badge not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        badge.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class BookDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        # Staff/admin can preview unpublished (draft) books; customers see published only.
        if request.user and request.user.is_staff:
            book = Book.objects.filter(pk=pk).first()
        else:
            book = Book.objects.filter(pk=pk, published=True).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"data": BookSerializer(book).data, "meta": {}, "error": None})


class BookActivityListView(APIView):
    """
    GET /api/v1/books/{book_id}/activities/
    Auth: JWT user, or guest ?participant_id= belonging to a session for this book.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request, book_id):
        book = Book.objects.filter(pk=book_id, published=True).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        is_authenticated = bool(request.user and request.user.is_authenticated)
        participant_id = request.query_params.get("participant_id")

        if not is_authenticated and not participant_id:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "unauthenticated", "message": "Authentication required."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if participant_id and not is_authenticated:
            participant = (
                SessionParticipant.objects.filter(
                    id=participant_id,
                    participant_type=SessionParticipant.ParticipantType.GUEST,
                )
                .select_related("session")
                .first()
            )
            if not participant or str(participant.session.book_id) != str(book_id):
                return Response(
                    {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Invalid participant."}},
                    status=status.HTTP_403_FORBIDDEN,
                )

        activities = book.activity_configs.filter(is_active=True).order_by("sort_order", "title")
        serializer = ActivityConfigSerializer(activities, many=True)
        return Response({"data": serializer.data, "meta": {"count": activities.count()}, "error": None})


class BookPagesView(APIView):
    """
    GET /api/v1/books/{id}/pages/
    Returns page image URLs (with signed S3 URLs if S3 is configured).
    Auth: JWT user OR guest participant_id query param.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        # Auth gate: JWT user or valid guest participant_id
        is_authenticated = bool(request.user and request.user.is_authenticated)
        participant_id = request.query_params.get("participant_id")

        if not is_authenticated and not participant_id:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "unauthenticated", "message": "Authentication required."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if participant_id and not is_authenticated:
            valid_participant = SessionParticipant.objects.filter(
                id=participant_id,
                participant_type=SessionParticipant.ParticipantType.GUEST,
            ).exists()
            if not valid_participant:
                return Response(
                    {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Invalid participant."}},
                    status=status.HTTP_403_FORBIDDEN,
                )

        book = Book.objects.filter(pk=pk, published=True).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        pages = book.pages.order_by("page_number")
        serializer = BookPageSerializer(pages, many=True)
        from .serializers import resolve_media_url
        pdf_view_url = resolve_media_url(book.s3_key) if book.asset_type == Book.AssetType.PDF else ""
        # The room needs the book's theme at the same moment it needs the pages,
        # so it rides along in meta rather than costing a second round trip.
        theme = BookTheme.objects.filter(book=book).first()
        return Response({
            "data": serializer.data,
            "meta": {
                "count": pages.count(),
                "page_count": book.page_count,
                "asset_type": book.asset_type,
                "pdf_view_url": pdf_view_url,
                "theme": BookThemeSerializer(theme).data if theme else None,
            },
            "error": None,
        })


class AdminBookRenderPdfView(APIView):
    """
    POST /api/v1/admin/books/{id}/render-pdf/
    Downloads the book's PDF from S3 (or a provided URL), converts pages to
    JPEG images using pdf2image, uploads them back to S3, and creates BookPage
    records. Requires pdf2image + poppler on the server.
    """

    permission_classes = [permissions.IsAdminUser]

    def post(self, request, pk):
        if not pdf2image:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "unavailable", "message": "pdf2image / poppler is not installed on this server."}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        book = Book.objects.filter(pk=pk).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        s3_key = request.data.get("s3_key") or book.s3_key
        if not s3_key:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "validation_error", "message": "s3_key is required (either in request body or on the book record)."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        bucket = getattr(django_settings, "AWS_STORAGE_BUCKET_NAME", "")
        if not bucket:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "misconfigured", "message": "AWS_STORAGE_BUCKET_NAME is not set."}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        import tempfile
        import os

        try:
            import boto3 as _boto3
            s3 = _boto3.client(
                "s3",
                aws_access_key_id=getattr(django_settings, "AWS_ACCESS_KEY_ID", ""),
                aws_secret_access_key=getattr(django_settings, "AWS_SECRET_ACCESS_KEY", ""),
                region_name=getattr(django_settings, "AWS_S3_REGION_NAME", "") or None,
            )

            # Download the PDF
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
                s3.download_fileobj(bucket, s3_key, tmp_pdf)
                tmp_pdf_path = tmp_pdf.name

            # Convert PDF pages to PIL images
            images = pdf2image.convert_from_path(tmp_pdf_path, dpi=150, fmt="jpeg")
            os.unlink(tmp_pdf_path)

            # Derive the output key prefix from the PDF key
            pdf_dir = s3_key.rsplit("/", 1)[0] if "/" in s3_key else f"books/{book.id}"
            pages_prefix = f"{pdf_dir}/pages"

            created_pages = []
            for i, img in enumerate(images, start=1):
                page_key = f"{pages_prefix}/page_{i:03d}.jpg"
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_img:
                    img.save(tmp_img, format="JPEG", quality=90)
                    tmp_img_path = tmp_img.name

                with open(tmp_img_path, "rb") as f:
                    s3.upload_fileobj(f, bucket, page_key, ExtraArgs={"ContentType": "image/jpeg"})
                os.unlink(tmp_img_path)

                # Build the public URL or S3 URL
                custom_domain = getattr(django_settings, "AWS_S3_CUSTOM_DOMAIN", "")
                if custom_domain:
                    image_url = f"https://{custom_domain}/{page_key}"
                else:
                    region = getattr(django_settings, "AWS_S3_REGION_NAME", "us-east-1") or "us-east-1"
                    image_url = f"https://{bucket}.s3.{region}.amazonaws.com/{page_key}"

                page, _ = BookPage.objects.update_or_create(
                    book=book,
                    page_number=i,
                    defaults={"image_url": image_url},
                )
                created_pages.append(page)

            # Update book record
            book.s3_key = s3_key
            book.asset_type = Book.AssetType.PDF
            book.page_count = len(images)
            book.save(update_fields=["s3_key", "asset_type", "page_count", "updated_at"])

            return Response({
                "data": {"pages_rendered": len(images), "pages_prefix": pages_prefix},
                "meta": {},
                "error": None,
            }, status=status.HTTP_201_CREATED)

        except Exception as exc:  # noqa: BLE001
            logger.error("PDF render failed for book %s: %s", book.id, exc)
            return Response(
                {"data": None, "meta": {}, "error": {"code": "render_error", "message": str(exc)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class AdminActivityListCreateView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        activities = ActivityConfig.objects.select_related("book").all()
        book_id = request.query_params.get("book_id")
        if book_id:
            activities = activities.filter(book_id=book_id)
        serializer = ActivityConfigSerializer(activities, many=True)
        return Response({"data": serializer.data, "meta": {"count": activities.count()}, "error": None})

    def post(self, request):
        serializer = ActivityConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        activity = serializer.save()
        return Response({"data": ActivityConfigSerializer(activity).data, "meta": {}, "error": None}, status=status.HTTP_201_CREATED)


class AdminActivityDetailView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get_object(self, pk):
        return ActivityConfig.objects.filter(pk=pk).select_related("book").first()

    def patch(self, request, pk):
        activity = self.get_object(pk)
        if not activity:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Activity config not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = ActivityConfigSerializer(activity, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_activity = serializer.save()
        return Response({"data": ActivityConfigSerializer(updated_activity).data, "meta": {}, "error": None})

    def delete(self, request, pk):
        activity = self.get_object(pk)
        if not activity:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Activity config not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        activity.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChildProfileListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        profiles = ChildProfile.objects.filter(user=request.user, is_active=True)
        serializer = ChildProfileSerializer(profiles, many=True)
        return Response({"data": serializer.data, "meta": {"count": profiles.count()}, "error": None})

    def post(self, request):
        serializer = ChildProfileSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        profile = serializer.save()
        return Response(
            {"data": ChildProfileSerializer(profile).data, "meta": {}, "error": None},
            status=status.HTTP_201_CREATED,
        )


class ChildProfileDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self, request, pk):
        return ChildProfile.objects.filter(pk=pk, user=request.user, is_active=True).first()

    def get(self, request, pk):
        profile = self.get_object(request, pk)
        if not profile:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Child profile not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"data": ChildProfileSerializer(profile).data, "meta": {}, "error": None})

    def patch(self, request, pk):
        profile = self.get_object(request, pk)
        if not profile:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Child profile not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = ChildProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        updated_profile = serializer.save()
        return Response({"data": ChildProfileSerializer(updated_profile).data, "meta": {}, "error": None})

    def delete(self, request, pk):
        profile = self.get_object(request, pk)
        if not profile:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Child profile not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        profile.is_active = False
        profile.save(update_fields=["is_active", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        sessions = ReadingSession.objects.filter(created_by=request.user).select_related("book", "child_profile")
        serializer = ReadingSessionSerializer(sessions, many=True)
        return Response({"data": serializer.data, "meta": {"count": sessions.count()}, "error": None})

    def post(self, request):
        serializer = SessionCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            entitlement, _ = Entitlement.objects.select_for_update().get_or_create(user=request.user)
            if entitlement.sessions_remaining <= 0 and entitlement.pack_sessions_remaining <= 0:
                return Response(
                    {
                        "data": None,
                        "meta": {},
                        "error": {
                            "code": "no_entitlement",
                            "message": "No sessions remaining. Please upgrade or buy a session pack.",
                        },
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            session = serializer.save()
            consume_session_credit(entitlement)

        ensure_livekit_room(session)

        # Include the host participant so the client can store participant_id
        host_participant = session.participants.filter(
            session_role=SessionParticipant.SessionRole.HOST
        ).first()
        data = ReadingSessionSerializer(session).data
        data["participants"] = SessionParticipantSerializer(
            session.participants.all(), many=True
        ).data
        data["host_participant_id"] = str(host_participant.id) if host_participant else None

        return Response(
            {"data": data, "meta": {}, "error": None},
            status=status.HTTP_201_CREATED,
        )


class SessionDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk, created_by=request.user).select_related("book", "child_profile").first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"data": ReadingSessionSerializer(session).data, "meta": {}, "error": None})


class SessionParticipantsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk, created_by=request.user).prefetch_related("participants").first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        participants = session.participants.all().order_by("created_at")
        serializer = SessionParticipantSerializer(participants, many=True)
        return Response({"data": serializer.data, "meta": {"count": participants.count()}, "error": None})


class SessionEventsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk, created_by=request.user).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        events = session.events.select_related("participant").all().order_by("-created_at")
        serializer = SessionEventSerializer(events, many=True)
        return Response({"data": serializer.data, "meta": {"count": events.count()}, "error": None})


class SessionCancelView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk, created_by=request.user).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        if session.status in {ReadingSession.Status.COMPLETED, ReadingSession.Status.CANCELLED}:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "invalid_state", "message": "Session can no longer be cancelled."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.status = ReadingSession.Status.CANCELLED
        session.ended_at = session.ended_at or timezone.now()
        session.save(update_fields=["status", "ended_at", "updated_at"])
        SessionEvent.objects.create(
            session=session,
            event_type=SessionEvent.EventType.CANCELLED,
            payload={"source": "api"},
        )
        delete_livekit_room(session)
        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                    "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                },
                "meta": {},
                "error": None,
            }
        )


class SessionInviteDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get_session(self, request, pk):
        return ReadingSession.objects.filter(pk=pk, created_by=request.user).select_related("invite").first()

    def get(self, request, pk):
        session = self.get_session(request, pk)
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        invite, _ = SessionInvite.objects.get_or_create(session=session)
        return Response({"data": SessionInviteSerializer(invite).data, "meta": {}, "error": None})

    def patch(self, request, pk):
        session = self.get_session(request, pk)
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        invite, _ = SessionInvite.objects.get_or_create(session=session)
        serializer = SessionInviteSerializer(invite, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated_invite = serializer.save()
        return Response({"data": SessionInviteSerializer(updated_invite).data, "meta": {}, "error": None})


class SessionInviteRegenerateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk, created_by=request.user).select_related("invite").first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        invite, _ = SessionInvite.objects.get_or_create(session=session)
        invite.token = secrets.token_urlsafe(24)
        invite.used_count = 0
        invite.save(update_fields=["token", "used_count", "updated_at"])
        return Response({"data": SessionInviteSerializer(invite).data, "meta": {}, "error": None})


class InviteJoinView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request, token):
        invite = SessionInvite.objects.filter(token=token).select_related("session").first()
        if not invite or not invite.is_usable():
            return Response(
                {"data": None, "meta": {}, "error": {"code": "invite_expired", "message": "Invite link is invalid or expired."}},
                status=status.HTTP_410_GONE,
            )

        display_name = (request.data.get("display_name") or "Guest Participant").strip()
        if not display_name:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "validation_error", "message": "Display name is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session = invite.session
        participant = SessionParticipant.objects.create(
            session=session,
            display_name=display_name,
            participant_type=SessionParticipant.ParticipantType.GUEST,
            session_role=(
                SessionParticipant.SessionRole.HOST
                if invite.host_role_granted
                else SessionParticipant.SessionRole.PARTICIPANT
            ),
            joined_at=timezone.now(),
            last_seen_at=timezone.now(),
        )
        invite.used_count += 1
        invite.save(update_fields=["used_count", "updated_at"])

        ensure_livekit_room(session)

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "room_name": session.livekit_room_name,
                    "room_type": session.room_type,
                    "livekit_url": getattr(django_settings, "LIVEKIT_URL", ""),
                    "participant": SessionParticipantSerializer(participant).data,
                    "realtime_token": build_realtime_token(session, participant),
                },
                "meta": {},
                "error": None,
            }
        )


class SessionReadyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.data.get("participant_id")
        participant = SessionParticipant.objects.filter(id=participant_id, session=session).first()
        if not participant or participant.user != request.user:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Participant does not belong to this user."}},
                status=status.HTTP_403_FORBIDDEN,
            )

        participant.ready_at = timezone.now()
        participant.last_seen_at = timezone.now()
        participant.save(update_fields=["ready_at", "last_seen_at", "updated_at"])
        if session.status == ReadingSession.Status.PENDING:
            session.status = ReadingSession.Status.LOBBY
            session.save(update_fields=["status", "updated_at"])

        ensure_livekit_room(session)

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                    "participant": SessionParticipantSerializer(participant).data,
                    "room_name": session.livekit_room_name,
                    "livekit_url": getattr(django_settings, "LIVEKIT_URL", ""),
                    "realtime_token": build_realtime_token(session, participant),
                },
                "meta": {},
                "error": None,
            }
        )


class SessionStartView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.data.get("participant_id")
        participant = SessionParticipant.objects.filter(id=participant_id, session=session).first()
        if not participant or participant.user != request.user:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Participant does not belong to this user."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if participant.session_role != SessionParticipant.SessionRole.HOST:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "host_required", "message": "Only the host can start the session."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if participant.ready_at is None:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_ready", "message": "Participant must be ready before starting."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        session.status = ReadingSession.Status.ACTIVE
        session.started_at = session.started_at or timezone.now()
        session.save(update_fields=["status", "started_at", "updated_at"])
        SessionEvent.objects.create(
            session=session,
            participant=participant,
            event_type=SessionEvent.EventType.STARTED,
            payload={"source": "api"},
        )

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                    "started_at": session.started_at.isoformat() if session.started_at else None,
                    "room_name": session.livekit_room_name,
                    "livekit_url": getattr(django_settings, "LIVEKIT_URL", ""),
                    "realtime_token": build_realtime_token(session, participant),
                },
                "meta": {},
                "error": None,
            }
        )


class SessionCompleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.data.get("participant_id")
        participant = SessionParticipant.objects.filter(id=participant_id, session=session).first()
        if not participant or participant.user != request.user:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Participant does not belong to this user."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if participant.session_role != SessionParticipant.SessionRole.HOST:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "host_required", "message": "Only the host can complete the session."}},
                status=status.HTTP_403_FORBIDDEN,
            )

        session.status = ReadingSession.Status.COMPLETED
        session.ended_at = timezone.now()
        session.timer_remaining_seconds = 0
        update_fields = ["status", "ended_at", "timer_remaining_seconds", "updated_at"]

        # Record which activity the session finished on (Activity Room), so the
        # completion screen can name it. Accept an id (preferred) or raw title.
        activity_id = request.data.get("activity_id")
        activity_title = request.data.get("activity_title")
        if activity_id:
            activity = ActivityConfig.objects.filter(pk=activity_id, book=session.book).first()
            if activity:
                session.completed_activity = activity
                session.completed_activity_title = activity.title
                update_fields += ["completed_activity", "completed_activity_title"]
        elif activity_title:
            session.completed_activity_title = str(activity_title)[:255]
            update_fields += ["completed_activity_title"]

        session.save(update_fields=update_fields)
        SessionEvent.objects.create(
            session=session,
            participant=participant,
            event_type=SessionEvent.EventType.COMPLETED,
            payload={"source": "api"},
        )
        delete_livekit_room(session)
        badges = award_session_badges(session)

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                    "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                    "awarded_badges": badges,
                },
                "meta": {},
                "error": None,
            }
        )


class SessionSnapshotView(APIView):
    permission_classes = [permissions.AllowAny]

    def get_session_and_participant(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return None, None, Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.data.get("participant_id") or request.query_params.get("participant_id")
        participant = SessionParticipant.objects.filter(id=participant_id, session=session).first()
        if not participant:
            return None, None, Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Participant not found."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        # Registered participants must own their slot; guests have no user
        if participant.participant_type == SessionParticipant.ParticipantType.REGISTERED:
            if not request.user or not request.user.is_authenticated or participant.user != request.user:
                return None, None, Response(
                    {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Participant does not belong to this user."}},
                    status=status.HTTP_403_FORBIDDEN,
                )
        return session, participant, None

    def get(self, request, pk):
        session, participant, error_response = self.get_session_and_participant(request, pk)
        if error_response:
            return error_response

        snapshot, _ = SessionSnapshot.objects.get_or_create(
            session=session,
            defaults={
                "page_number": session.current_page,
                "timer_state": {"remaining_seconds": session.timer_remaining_seconds},
            },
        )
        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "page_number": snapshot.page_number,
                    "timer_state": snapshot.timer_state,
                    "annotation_state": snapshot.annotation_state,
                    "activity_state": snapshot.activity_state,
                },
                "meta": {},
                "error": None,
            }
        )

    def put(self, request, pk):
        session, participant, error_response = self.get_session_and_participant(request, pk)
        if error_response:
            return error_response

        page_number = int(request.data.get("current_page", session.current_page))
        timer_remaining_seconds = int(request.data.get("timer_remaining_seconds", session.timer_remaining_seconds))
        annotation_state = request.data.get("annotation_state") or {}
        activity_state = request.data.get("activity_state") or {}

        snapshot, _ = SessionSnapshot.objects.update_or_create(
            session=session,
            defaults={
                "page_number": page_number,
                "timer_state": {"remaining_seconds": timer_remaining_seconds},
                "annotation_state": annotation_state,
                "activity_state": activity_state,
            },
        )
        session.current_page = page_number
        session.timer_remaining_seconds = timer_remaining_seconds
        session.save(update_fields=["current_page", "timer_remaining_seconds", "updated_at"])
        participant.last_seen_at = timezone.now()
        participant.save(update_fields=["last_seen_at", "updated_at"])

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "page_number": snapshot.page_number,
                    "timer_state": snapshot.timer_state,
                    "annotation_state": snapshot.annotation_state,
                    "activity_state": snapshot.activity_state,
                },
                "meta": {},
                "error": None,
            }
        )


class SessionReconnectTokenView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.data.get("participant_id")
        participant = SessionParticipant.objects.filter(id=participant_id, session=session).first()
        if not participant or participant.user != request.user:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Participant does not belong to this user."}},
                status=status.HTTP_403_FORBIDDEN,
            )

        participant.last_seen_at = timezone.now()
        participant.save(update_fields=["last_seen_at", "updated_at"])
        SessionEvent.objects.create(
            session=session,
            participant=participant,
            event_type=SessionEvent.EventType.RECONNECTED,
            payload={"source": "api"},
        )

        snapshot = getattr(session, "snapshot", None)
        snapshot_payload = None
        if snapshot:
            snapshot_payload = {
                "page_number": snapshot.page_number,
                "timer_state": snapshot.timer_state,
                "annotation_state": snapshot.annotation_state,
                "activity_state": snapshot.activity_state,
            }

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "room_name": session.livekit_room_name,
                    "livekit_url": getattr(django_settings, "LIVEKIT_URL", ""),
                    "participant": SessionParticipantSerializer(participant).data,
                    "realtime_token": build_realtime_token(session, participant),
                    "snapshot": snapshot_payload,
                },
                "meta": {},
                "error": None,
            }
        )



class SessionGuestTokenView(APIView):
    """Unauthenticated endpoint — lets a guest refresh their Livekit token using their participant_id."""

    permission_classes = [permissions.AllowAny]

    def get(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.query_params.get("participant_id")
        if not participant_id:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "validation_error", "message": "participant_id is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        participant = SessionParticipant.objects.filter(
            id=participant_id,
            session=session,
            participant_type=SessionParticipant.ParticipantType.GUEST,
        ).first()
        if not participant:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Guest participant not found."}},
                status=status.HTTP_403_FORBIDDEN,
            )

        participant.last_seen_at = timezone.now()
        participant.save(update_fields=["last_seen_at", "updated_at"])

        role = (
            "guest"
            if participant.session_role != SessionParticipant.SessionRole.HOST
            else "host"
        )

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "room_name": session.livekit_room_name,
                    "livekit_url": getattr(django_settings, "LIVEKIT_URL", ""),
                    "realtime_token": build_realtime_token(session, participant),
                    "role": role,
                },
                "meta": {},
                "error": None,
            }
        )


# ─── Book Pages ───────────────────────────────────────────────────────────────

class AdminBookPageListCreateView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request, book_id):
        book = Book.objects.filter(pk=book_id).first()
        if not book:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}}, status=status.HTTP_404_NOT_FOUND)
        pages = book.pages.all()
        return Response({"data": BookPageSerializer(pages, many=True).data, "meta": {"count": pages.count()}, "error": None})

    def post(self, request, book_id):
        book = Book.objects.filter(pk=book_id).first()
        if not book:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}}, status=status.HTTP_404_NOT_FOUND)
        data = {**request.data, "book": str(book_id)}
        serializer = BookPageSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        page = serializer.save()
        book.page_count = book.pages.count()
        book.save(update_fields=["page_count", "updated_at"])
        return Response({"data": BookPageSerializer(page).data, "meta": {}, "error": None}, status=status.HTTP_201_CREATED)


class AdminBookPageDetailView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def _get(self, book_id, pk):
        return BookPage.objects.filter(pk=pk, book_id=book_id).first()

    def patch(self, request, book_id, pk):
        page = self._get(book_id, pk)
        if not page:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Page not found."}}, status=status.HTTP_404_NOT_FOUND)
        serializer = BookPageSerializer(page, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        page = serializer.save()
        return Response({"data": BookPageSerializer(page).data, "meta": {}, "error": None})

    def delete(self, request, book_id, pk):
        page = self._get(book_id, pk)
        if not page:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Page not found."}}, status=status.HTTP_404_NOT_FOUND)
        book = page.book
        page.delete()
        book.page_count = book.pages.count()
        book.save(update_fields=["page_count", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Session Detail + Status ──────────────────────────────────────────────────

class AdminSessionDetailApiView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request, pk):
        session = (
            ReadingSession.objects
            .select_related("book", "child_profile", "created_by")
            .prefetch_related("participants", "events__participant", "invite")
            .filter(pk=pk)
            .first()
        )
        if not session:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}}, status=status.HTTP_404_NOT_FOUND)
        return Response({"data": AdminSessionDetailSerializer(session).data, "meta": {}, "error": None})


class AdminSessionStatusView(APIView):
    permission_classes = [permissions.IsAdminUser]

    ALLOWED = {ReadingSession.Status.CANCELLED, ReadingSession.Status.COMPLETED}

    def patch(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}}, status=status.HTTP_404_NOT_FOUND)
        new_status = request.data.get("status")
        if new_status not in self.ALLOWED:
            return Response({"data": None, "meta": {}, "error": {"code": "invalid_transition", "message": "Status must be cancelled or completed."}}, status=status.HTTP_400_BAD_REQUEST)
        session.status = new_status
        if new_status == ReadingSession.Status.CANCELLED and not session.ended_at:
            session.ended_at = timezone.now()
        session.save(update_fields=["status", "ended_at", "updated_at"])
        SessionEvent.objects.create(session=session, event_type=new_status, payload={"forced_by_admin": True})
        return Response({"data": {"id": str(session.id), "status": session.status}, "meta": {}, "error": None})


# ─── Entitlement Management ───────────────────────────────────────────────────

class AdminEntitlementListView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        entitlements = Entitlement.objects.select_related("user").order_by("-updated_at")
        data = AdminEntitlementSerializer(entitlements, many=True).data
        return Response({"data": data, "meta": {"count": len(data)}, "error": None})


class AdminEntitlementDetailView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def _get(self, user_id):
        return Entitlement.objects.select_related("user").filter(user_id=user_id).first()

    def get(self, request, user_id):
        obj = self._get(user_id)
        if not obj:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Entitlement not found."}}, status=status.HTTP_404_NOT_FOUND)
        return Response({"data": AdminEntitlementSerializer(obj).data, "meta": {}, "error": None})

    def patch(self, request, user_id):
        obj = self._get(user_id)
        if not obj:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Entitlement not found."}}, status=status.HTTP_404_NOT_FOUND)
        serializer = AdminEntitlementSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"data": AdminEntitlementSerializer(obj).data, "meta": {}, "error": None})


# ─── Badge Awards ─────────────────────────────────────────────────────────────

class AdminBadgeAwardListView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        awards = UserBadge.objects.select_related("badge", "child_profile", "session").order_by("-created_at")
        badge_id = request.query_params.get("badge_id")
        if badge_id:
            awards = awards.filter(badge_id=badge_id)
        data = AdminBadgeAwardSerializer(awards, many=True).data
        return Response({"data": data, "meta": {"count": len(data)}, "error": None})


class AdminBadgeAwardDeleteView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def delete(self, request, pk):
        award = UserBadge.objects.filter(pk=pk).first()
        if not award:
            return Response({"data": None, "meta": {}, "error": {"code": "not_found", "message": "Award not found."}}, status=status.HTTP_404_NOT_FOUND)
        award.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ─── Child Profiles (admin read) ──────────────────────────────────────────────

class AdminChildProfileListView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        from django.db.models import Count as DCount
        profiles = (
            ChildProfile.objects
            .select_related("user")
            .annotate(session_count=DCount("sessions", distinct=True), badge_count=DCount("user_badges", distinct=True))
            .order_by("display_name")
        )
        age_band = request.query_params.get("age_band")
        if age_band:
            profiles = profiles.filter(age_band=age_band)
        data = AdminChildProfileSerializer(profiles, many=True).data
        return Response({"data": data, "meta": {"count": len(data)}, "error": None})


# ─── Session Events Log ───────────────────────────────────────────────────────

class AdminSessionEventListView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        events = SessionEvent.objects.select_related("session", "participant").order_by("-created_at")
        event_type = request.query_params.get("event_type")
        session_id = request.query_params.get("session_id")
        if event_type:
            events = events.filter(event_type=event_type)
        if session_id:
            events = events.filter(session_id=session_id)
        data = AdminSessionEventSerializer(events[:200], many=True).data
        return Response({"data": data, "meta": {"count": len(data)}, "error": None})


class AdminSessionEventExportView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        events = SessionEvent.objects.select_related("session", "participant").order_by("-created_at")
        event_type = request.query_params.get("event_type")
        if event_type:
            events = events.filter(event_type=event_type)
        buffer = StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["event_id", "session_id", "event_type", "participant", "payload", "timestamp"])
        for event in events:
            writer.writerow([
                str(event.id),
                str(event.session_id)[:8].upper(),
                event.event_type,
                event.participant.display_name if event.participant else "System",
                event.payload,
                event.created_at.isoformat(),
            ])
        response = HttpResponse(buffer.getvalue(), content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="session-events.csv"'
        return response


# ─── Media Upload (staging / no-S3 fallback) ──────────────────────────────────

#: Images only. Admins upload activity illustrations and book pages here; there
#: is no use case for anything else, and an open endpoint that writes
#: attacker-named files under MEDIA_ROOT is worth closing even behind staff auth.
UPLOAD_ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
UPLOAD_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
UPLOAD_MAX_BYTES = 5 * 1024 * 1024


class MediaUploadView(APIView):
    """
    Staff-only endpoint to upload book assets and activity illustrations when S3
    is not configured. Returns the hosted URL for BookPage.image_url fields and
    for the activity builder's image pickers.
    """
    permission_classes = [permissions.IsAdminUser]
    parser_classes = [MultiPartParser]

    def post(self, request):
        import uuid as _uuid
        from pathlib import Path

        from django.utils.text import get_valid_filename

        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response(
                {"data": None, "error": {"code": "no_file", "message": "No file provided."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if file_obj.size > UPLOAD_MAX_BYTES:
            return Response(
                {
                    "data": None,
                    "error": {
                        "code": "file_too_large",
                        "message": "Images must be 5 MB or smaller.",
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check both: the content type is client-supplied and trivially spoofed,
        # while the extension is what actually decides how the file is served.
        content_type = (file_obj.content_type or "").split(";")[0].strip().lower()
        extension = Path(file_obj.name or "").suffix.lower()
        if content_type not in UPLOAD_ALLOWED_TYPES or extension not in UPLOAD_ALLOWED_EXTENSIONS:
            return Response(
                {
                    "data": None,
                    "error": {
                        "code": "unsupported_file_type",
                        "message": "Only PNG, JPEG, WebP and GIF images can be uploaded.",
                    },
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        upload_dir = Path(django_settings.MEDIA_ROOT) / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)

        # The uuid prefix already prevents collisions; get_valid_filename strips
        # separators and traversal out of the part the uploader controls. Keep
        # the original stem so admins can still recognise their own files.
        stem = get_valid_filename(Path(file_obj.name or "image").stem)[:60] or "image"
        safe_name = f"{_uuid.uuid4().hex}_{stem}{extension}"
        dest = upload_dir / safe_name
        with open(dest, "wb+") as fh:
            for chunk in file_obj.chunks():
                fh.write(chunk)

        url = request.build_absolute_uri(f"{django_settings.MEDIA_URL}uploads/{safe_name}")
        return Response({"data": {"url": url}, "error": None}, status=status.HTTP_201_CREATED)


# ─── Me: Badges ───────────────────────────────────────────────────────────────

class MeBadgesView(APIView):
    """
    Private to the authenticated parent account: awards for their child profiles only.
    Not exposed on public URLs; responses are not cacheable by shared proxies.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        awards = (
            UserBadge.objects
            .filter(child_profile__user=request.user)
            .select_related("badge", "child_profile")
            .order_by("-created_at")
        )
        data = [
            {
                "id": str(ub.id),
                "badge_code": ub.badge.code,
                "badge_name": ub.badge.name,
                "badge_description": ub.badge.description,
                "badge_icon": ub.badge.icon,
                "child_name": ub.child_profile.display_name,
                "session_id": str(ub.session_id),
                "earned_at": ub.created_at.isoformat(),
            }
            for ub in awards
        ]
        return _private_no_store_response({"data": data, "meta": {"count": len(data)}, "error": None})


# ─── Transfer Host ────────────────────────────────────────────────────────────

class TransferHostView(APIView):
    """
    POST /api/v1/sessions/{id}/transfer-host/
    Body: { current_participant_id, new_participant_id }
    Only the current host can transfer their role.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        current_id = request.data.get("current_participant_id")
        new_id = request.data.get("new_participant_id")

        current_host = SessionParticipant.objects.filter(id=current_id, session=session).first()
        if not current_host or current_host.user != request.user:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "permission_denied", "message": "Not authorized."}},
                status=status.HTTP_403_FORBIDDEN,
            )
        if current_host.session_role != SessionParticipant.SessionRole.HOST:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_host", "message": "You are not the host."}},
                status=status.HTTP_403_FORBIDDEN,
            )

        new_host = SessionParticipant.objects.filter(id=new_id, session=session).first()
        if not new_host:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Target participant not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        current_host.session_role = SessionParticipant.SessionRole.PARTICIPANT
        current_host.save(update_fields=["session_role", "updated_at"])
        new_host.session_role = SessionParticipant.SessionRole.HOST
        new_host.save(update_fields=["session_role", "updated_at"])

        SessionEvent.objects.create(
            session=session,
            participant=current_host,
            event_type="host_transferred",
            payload={"action": "transfer_host", "new_host_id": str(new_host.id), "new_host_name": new_host.display_name},
        )

        return Response(
            {
                "data": {
                    "new_host_id": str(new_host.id),
                    "new_host_name": new_host.display_name,
                },
                "meta": {},
                "error": None,
            }
        )


class AdminBookThemeView(APIView):
    """Read or upsert the reading-room theme for a book.

    A book without a theme returns `data: null` rather than 404 — the room falls
    back to the platform default, so "no theme" is a valid state, not an error.
    """

    permission_classes = [permissions.IsAdminUser]

    def _book(self, book_id):
        return Book.objects.filter(pk=book_id).first()

    def _not_found(self):
        return Response(
            {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    def get(self, request, book_id):
        book = self._book(book_id)
        if not book:
            return self._not_found()
        theme = BookTheme.objects.filter(book=book).first()
        data = BookThemeSerializer(theme).data if theme else None
        return Response({"data": data, "meta": {}, "error": None})

    def put(self, request, book_id):
        book = self._book(book_id)
        if not book:
            return self._not_found()

        theme = BookTheme.objects.filter(book=book).first()
        serializer = BookThemeWriteSerializer(theme, data=request.data, partial=theme is not None)
        serializer.is_valid(raise_exception=True)
        try:
            saved = serializer.save(book=book)
        except DjangoValidationError as exc:
            return Response(
                {
                    "data": None,
                    "meta": {},
                    "error": {"code": "invalid_theme", "message": exc.message_dict},
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"data": BookThemeSerializer(saved).data, "meta": {}, "error": None})

    def delete(self, request, book_id):
        book = self._book(book_id)
        if not book:
            return self._not_found()
        BookTheme.objects.filter(book=book).delete()
        return Response({"data": None, "meta": {}, "error": None}, status=status.HTTP_204_NO_CONTENT)
