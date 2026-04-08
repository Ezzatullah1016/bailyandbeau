import csv
import secrets
from io import StringIO

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status
from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import ActivityConfig, Badge, Book, ChildProfile, Entitlement, FavoriteBook, NotificationPreference, ReadingReminder, ReadingSession, SessionEvent, SessionInvite, SessionParticipant, SessionSnapshot, UserBadge
from .serializers import (
    ActivityConfigSerializer,
    BadgeSerializer,
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


def build_realtime_token(session, participant):
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

        return Response(
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

        return Response(
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
        processed, entitlement = sync_entitlement_from_stripe_event(request.data)
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
        return Response(
            {
                "data": {
                    "plan": plan,
                    "checkout_url": f"https://checkout.stripe.com/pay/{plan['code']}",
                    "mode": "stub",
                },
                "meta": {},
                "error": None,
            }
        )


class BookListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
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
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        badges = Badge.objects.filter(is_active=True).order_by("name")
        serializer = BadgeSerializer(badges, many=True)
        return Response({"data": serializer.data, "meta": {"count": badges.count()}, "error": None})


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
        book = Book.objects.filter(pk=pk, published=True).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"data": BookSerializer(book).data, "meta": {}, "error": None})


class BookActivityListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, book_id):
        book = Book.objects.filter(pk=book_id, published=True).first()
        if not book:
            return Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Book not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        activities = book.activity_configs.filter(is_active=True).order_by("sort_order", "title")
        serializer = ActivityConfigSerializer(activities, many=True)
        return Response({"data": serializer.data, "meta": {"count": activities.count()}, "error": None})


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

        return Response(
            {"data": ReadingSessionSerializer(session).data, "meta": {}, "error": None},
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

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "room_name": session.livekit_room_name,
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

        return Response(
            {
                "data": {
                    "session_id": str(session.id),
                    "status": session.status,
                    "participant": SessionParticipantSerializer(participant).data,
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
        session.save(update_fields=["status", "ended_at", "timer_remaining_seconds", "updated_at"])
        SessionEvent.objects.create(
            session=session,
            participant=participant,
            event_type=SessionEvent.EventType.COMPLETED,
            payload={"source": "api"},
        )
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
    permission_classes = [permissions.IsAuthenticated]

    def get_session_and_participant(self, request, pk):
        session = ReadingSession.objects.filter(pk=pk).first()
        if not session:
            return None, None, Response(
                {"data": None, "meta": {}, "error": {"code": "not_found", "message": "Session not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        participant_id = request.data.get("participant_id") or request.query_params.get("participant_id")
        participant = SessionParticipant.objects.filter(id=participant_id, session=session).first()
        if not participant or participant.user != request.user:
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
                    "participant": SessionParticipantSerializer(participant).data,
                    "realtime_token": build_realtime_token(session, participant),
                    "snapshot": snapshot_payload,
                },
                "meta": {},
                "error": None,
            }
        )
