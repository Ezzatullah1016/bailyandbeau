from urllib.parse import urlparse

from django.conf import settings as django_settings
from django.contrib.auth import authenticate, get_user_model
from django.utils.text import slugify
from rest_framework import serializers

from django.core.exceptions import ValidationError as DjangoValidationError

from .models import (
    ActivityConfig,
    Badge,
    Book,
    BookPage,
    ChildProfile,
    Entitlement,
    FavoriteBook,
    NotificationPreference,
    ReadingReminder,
    ReadingSession,
    SessionEvent,
    SessionInvite,
    SessionParticipant,
    UserBadge,
    UserProfile,
)


class SessionParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = SessionParticipant
        fields = (
            "id",
            "display_name",
            "participant_type",
            "session_role",
            "ready_at",
            "joined_at",
            "last_seen_at",
        )
        read_only_fields = fields


class SessionEventSerializer(serializers.ModelSerializer):
    participant_name = serializers.CharField(source="participant.display_name", read_only=True)

    class Meta:
        model = SessionEvent
        fields = (
            "id",
            "event_type",
            "payload",
            "participant_name",
            "created_at",
        )
        read_only_fields = fields


class SessionInviteSerializer(serializers.ModelSerializer):
    is_usable = serializers.SerializerMethodField()

    class Meta:
        model = SessionInvite
        fields = (
            "id",
            "token",
            "host_role_granted",
            "expires_at",
            "max_uses",
            "used_count",
            "is_usable",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "token", "used_count", "is_usable", "created_at", "updated_at")

    def get_is_usable(self, obj):
        return obj.is_usable()


User = get_user_model()


MEDIA_KEY_PREFIXES = ("book-covers/", "book-pdfs/", "book-pages/", "user-avatars/")


def _media_key_from_value(raw: str):
    """Extract an S3/media object key from a stored cover/url value, or None for external URLs.

    Handles bare keys (book-covers/x.png), root-relative (/media/...), absolute
    (http://host/media/...), and full — possibly already-presigned — S3 URLs
    (https://bucket.s3.../book-covers/x.png?X-Amz-...). The query string is dropped so a
    new key is re-signed on read (stored presigned URLs would otherwise expire). Returns
    None for genuinely external URLs (e.g. a stock-photo CDN).
    """
    raw = (raw or "").strip()
    if not raw:
        return None
    path = raw.split("?", 1)[0]  # drop any query string (e.g. expiring SigV4 params)
    marker = "/media/"
    if marker in path:
        return path.split(marker, 1)[1].lstrip("/")
    for prefix in MEDIA_KEY_PREFIXES:
        idx = path.find(prefix)
        if idx != -1:
            return path[idx:]
    return None


def resolve_media_url(raw: str):
    """Return a fetchable URL for a stored media value: presign S3 keys, pass external URLs through."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    key = _media_key_from_value(raw)
    if key:
        from core.s3_presign import presigned_get_object_url

        signed = presigned_get_object_url(key)
        if signed:
            return signed
        # Fall back to local/media URL when S3 is not in play.
        try:
            from django.core.files.storage import default_storage

            return default_storage.url(key)
        except Exception:
            media = (django_settings.MEDIA_URL or "/media/").rstrip("/")
            return f"{media}/{key.lstrip('/')}"
    return raw  # external URL — use as-is


class BookSerializer(serializers.ModelSerializer):
    pdf_view_url = serializers.SerializerMethodField()

    class Meta:
        model = Book
        fields = (
            "id",
            "title",
            "slug",
            "description",
            "room_type",
            "age_band",
            "cover_image",
            "pdf_view_url",
            "published",
            "page_count",
            "asset_type",
            "s3_key",
            "created_at",
        )
        read_only_fields = ("id", "created_at")

    def get_pdf_view_url(self, obj):
        if obj.asset_type != Book.AssetType.PDF:
            return ""
        return resolve_media_url(obj.s3_key)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Resolve stored cover value (local/media key or external URL) to a fetchable URL.
        data["cover_image"] = resolve_media_url(instance.cover_image)
        return data


class UserSerializer(serializers.ModelSerializer):
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "avatar_url")

    def get_avatar_url(self, obj):
        profile = UserProfile.objects.filter(user_id=obj.pk).first()
        return resolve_media_url((profile.avatar_url or "").strip()) if profile else ""


class BadgeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Badge
        fields = (
            "id",
            "code",
            "name",
            "description",
            "icon",
            "trigger_type",
            "trigger_config",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")


class BadgeCatalogSerializer(serializers.ModelSerializer):
    """Customer-facing badge definitions only (no trigger rules, draft flags, or admin metadata)."""

    class Meta:
        model = Badge
        fields = ("id", "code", "name", "description", "icon")
        read_only_fields = fields


class FavoriteBookSerializer(serializers.ModelSerializer):
    book = BookSerializer(read_only=True)

    class Meta:
        model = FavoriteBook
        fields = ("id", "book", "created_at")
        read_only_fields = fields


class ActivityConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityConfig
        fields = (
            "id",
            "book",
            "title",
            "activity_type",
            "config",
            "sort_order",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "created_at", "updated_at")

    def validate(self, attrs):
        instance = self.instance or ActivityConfig()
        for field in ("book", "title", "activity_type", "config", "sort_order", "is_active"):
            if field in attrs:
                setattr(instance, field, attrs[field])
        try:
            instance.full_clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict)
        return attrs


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ("username", "email", "password", "first_name", "last_name")

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        username = (attrs.get("username") or "").strip()
        password = attrs.get("password")
        lookup_username = username
        if "@" in username:
            User = get_user_model()
            matched = User.objects.filter(email__iexact=username).first()
            if matched:
                lookup_username = matched.username
        user = authenticate(username=lookup_username, password=password)
        if not user:
            raise serializers.ValidationError("Invalid username or password.")
        attrs["user"] = user
        return attrs


class ChildProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChildProfile
        fields = ("id", "display_name", "age_band", "avatar_url", "is_active", "created_at")
        read_only_fields = ("id", "created_at")

    def create(self, validated_data):
        return ChildProfile.objects.create(user=self.context["request"].user, **validated_data)


class EntitlementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Entitlement
        fields = (
            "subscription_status",
            "plan_code",
            "stripe_customer_id",
            "stripe_subscription_id",
            "stripe_price_id",
            "last_webhook_event",
            "sessions_included",
            "sessions_remaining",
            "pack_sessions_remaining",
            "renewal_date",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = (
            "email_reminders",
            "session_updates",
            "marketing_opt_in",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")


class ReadingReminderSerializer(serializers.ModelSerializer):
    child_profile_id = serializers.UUIDField(write_only=True, required=False)
    child_name = serializers.CharField(source="child_profile.display_name", read_only=True)
    next_due = serializers.CharField(read_only=True)

    class Meta:
        model = ReadingReminder
        fields = (
            "id",
            "child_profile_id",
            "child_name",
            "title",
            "frequency",
            "time_of_day",
            "is_active",
            "next_due",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("id", "child_name", "next_due", "created_at", "updated_at")

    def validate_child_profile_id(self, value):
        user = self.context["request"].user
        if not ChildProfile.objects.filter(id=value, user=user, is_active=True).exists():
            raise serializers.ValidationError("Child profile not found.")
        return value

    def create(self, validated_data):
        child_profile_id = validated_data.pop("child_profile_id")
        child_profile = ChildProfile.objects.get(id=child_profile_id, user=self.context["request"].user, is_active=True)
        return ReadingReminder.objects.create(user=self.context["request"].user, child_profile=child_profile, **validated_data)

    def update(self, instance, validated_data):
        child_profile_id = validated_data.pop("child_profile_id", None)
        if child_profile_id:
            instance.child_profile = ChildProfile.objects.get(id=child_profile_id, user=self.context["request"].user, is_active=True)
        return super().update(instance, validated_data)


class ReadingSessionSerializer(serializers.ModelSerializer):
    invite_token = serializers.CharField(source="invite.token", read_only=True)
    book_title = serializers.CharField(source="book.title", read_only=True)
    child_name = serializers.CharField(source="child_profile.display_name", read_only=True)
    reading_duration_seconds = serializers.IntegerField(read_only=True)

    class Meta:
        model = ReadingSession
        fields = (
            "id",
            "status",
            "room_type",
            "book",
            "book_title",
            "child_profile",
            "child_name",
            "livekit_room_name",
            "current_page",
            "timer_total_seconds",
            "timer_remaining_seconds",
            "invite_token",
            "created_at",
            "started_at",
            "ended_at",
            "reading_duration_seconds",
        )
        read_only_fields = fields


class BookPageSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookPage
        fields = ("id", "book", "page_number", "image_url", "created_at")
        read_only_fields = ("id", "created_at")

    def to_representation(self, instance):
        data = super().to_representation(instance)
        image_url = data.get("image_url")
        bucket_name = getattr(django_settings, "AWS_STORAGE_BUCKET_NAME", "")

        if not image_url or not bucket_name:
            return data

        try:
            parsed = urlparse(image_url)
            if parsed.scheme and parsed.netloc:
                if bucket_name not in parsed.netloc and "amazonaws.com" not in parsed.netloc:
                    return data
                object_key = parsed.path.lstrip("/")
                if object_key.startswith(f"{bucket_name}/"):
                    object_key = object_key.split("/", 1)[1]
            else:
                object_key = image_url.lstrip("/")

            from core.s3_presign import s3_client_for_media

            signed_url = s3_client_for_media().generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket_name, "Key": object_key},
                ExpiresIn=getattr(django_settings, "AWS_QUERYSTRING_EXPIRE", 3600),
            )
            data["image_url"] = signed_url
        except Exception:
            data["image_url"] = image_url

        return data


class AdminSessionDetailSerializer(serializers.ModelSerializer):
    book_title = serializers.CharField(source="book.title", read_only=True)
    child_name = serializers.CharField(source="child_profile.display_name", read_only=True)
    child_age_band = serializers.CharField(source="child_profile.age_band", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    participants = SessionParticipantSerializer(many=True, read_only=True)
    events = SessionEventSerializer(many=True, read_only=True)
    invite = SessionInviteSerializer(read_only=True)

    class Meta:
        model = ReadingSession
        fields = (
            "id", "status", "room_type", "book", "book_title",
            "child_profile", "child_name", "child_age_band",
            "livekit_room_name", "current_page",
            "timer_total_seconds", "timer_remaining_seconds",
            "started_at", "ended_at", "created_at",
            "created_by_name", "participants", "events", "invite",
        )
        read_only_fields = fields

    def get_created_by_name(self, obj):
        return obj.created_by.get_full_name() or obj.created_by.username


class AdminEntitlementSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = Entitlement
        fields = (
            "id", "user", "user_email", "user_name",
            "subscription_status", "plan_code",
            "stripe_customer_id", "stripe_subscription_id",
            "sessions_included", "sessions_remaining", "pack_sessions_remaining",
            "renewal_date", "last_webhook_event", "created_at", "updated_at",
        )
        read_only_fields = (
            "id", "user", "user_email", "user_name",
            "stripe_customer_id", "stripe_subscription_id",
            "last_webhook_event", "created_at", "updated_at",
        )

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.username


class AdminBadgeAwardSerializer(serializers.ModelSerializer):
    badge_name = serializers.CharField(source="badge.name", read_only=True)
    badge_code = serializers.CharField(source="badge.code", read_only=True)
    child_name = serializers.CharField(source="child_profile.display_name", read_only=True)
    session_short_id = serializers.SerializerMethodField()

    class Meta:
        model = UserBadge
        fields = ("id", "badge_name", "badge_code", "child_name", "session_short_id", "created_at")
        read_only_fields = fields

    def get_session_short_id(self, obj):
        return str(obj.session_id)[:8].upper()


class AdminChildProfileSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    session_count = serializers.IntegerField(read_only=True)
    badge_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = ChildProfile
        fields = ("id", "display_name", "age_band", "user_email", "is_active", "session_count", "badge_count", "created_at")
        read_only_fields = fields


class AdminSessionEventSerializer(serializers.ModelSerializer):
    participant_name = serializers.CharField(source="participant.display_name", read_only=True, default=None)
    session_short_id = serializers.SerializerMethodField()

    class Meta:
        model = SessionEvent
        fields = ("id", "session", "session_short_id", "event_type", "payload", "participant_name", "created_at")
        read_only_fields = fields

    def get_session_short_id(self, obj):
        return str(obj.session_id)[:8].upper()


class SessionCreateSerializer(serializers.Serializer):
    book_id = serializers.UUIDField()
    child_profile_id = serializers.UUIDField()
    room_type = serializers.ChoiceField(choices=ReadingSession.RoomType.choices)

    def validate(self, attrs):
        user = self.context["request"].user

        try:
            attrs["book"] = Book.objects.get(id=attrs["book_id"], published=True)
        except Book.DoesNotExist as exc:
            raise serializers.ValidationError({"book_id": "Published book not found."}) from exc

        try:
            attrs["child_profile"] = ChildProfile.objects.get(
                id=attrs["child_profile_id"],
                user=user,
                is_active=True,
            )
        except ChildProfile.DoesNotExist as exc:
            raise serializers.ValidationError({"child_profile_id": "Child profile not found."}) from exc

        return attrs

    def create(self, validated_data):
        from core.portal_settings import effective_session_timer_seconds

        user = self.context["request"].user
        timer_seconds = effective_session_timer_seconds()
        session = ReadingSession.objects.create(
            book=validated_data["book"],
            child_profile=validated_data["child_profile"],
            created_by=user,
            room_type=validated_data["room_type"],
            timer_total_seconds=timer_seconds,
            timer_remaining_seconds=timer_seconds,
        )
        SessionParticipant.objects.create(
            session=session,
            user=user,
            display_name=user.get_full_name() or user.username,
            participant_type=SessionParticipant.ParticipantType.REGISTERED,
            session_role=SessionParticipant.SessionRole.HOST,
        )
        SessionInvite.objects.create(session=session, host_role_granted=False)
        SessionEvent.objects.create(
            session=session,
            event_type=SessionEvent.EventType.CREATED,
            payload={"room_type": session.room_type, "book_slug": slugify(session.book.title)},
        )
        return session
