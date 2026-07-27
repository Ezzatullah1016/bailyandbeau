import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

try:
    from storages.backends.s3 import S3Storage as _S3StorageCls
except ImportError:
    _S3StorageCls = None  # storages optional in some dev setups


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


def invite_expiry_default():
    return timezone.now() + timedelta(hours=24)


def generate_invite_token():
    return secrets.token_urlsafe(24)


class ChildProfile(TimeStampedModel):
    class AgeBand(models.TextChoices):
        AGE_0_2 = "0-2", "0-2 years"
        AGE_3_5 = "3-5", "3-5 years"
        AGE_6_8 = "6-8", "6-8 years"
        AGE_9_12 = "9-12", "9-12 years"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="child_profiles")
    display_name = models.CharField(max_length=50)
    age_band = models.CharField(max_length=10, choices=AgeBand.choices)
    avatar_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["display_name"]

    def __str__(self):
        return self.display_name


class UserProfile(TimeStampedModel):
    """Optional profile fields for auth users (parent accounts)."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    avatar_url = models.URLField(max_length=2048, blank=True)

    class Meta:
        verbose_name = "User profile"

    def __str__(self):
        return f"{self.user}"


class Book(TimeStampedModel):
    class RoomType(models.TextChoices):
        READING = "reading", "Reading"
        ACTIVITY = "activity", "Activity"
        HYBRID = "hybrid", "Hybrid"

    class AgeBand(models.TextChoices):
        AGE_0_2 = "0-2", "0-2 years"
        AGE_3_5 = "3-5", "3-5 years"
        AGE_6_8 = "6-8", "6-8 years"
        AGE_9_12 = "9-12", "9-12 years"

    class AssetType(models.TextChoices):
        PDF = "pdf", "PDF"
        IMAGES = "images", "Pre-rendered images"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    room_type = models.CharField(max_length=20, choices=RoomType.choices, default=RoomType.READING)
    age_band = models.CharField(max_length=10, choices=AgeBand.choices, default=AgeBand.AGE_3_5)
    cover_image = models.URLField(blank=True)
    published = models.BooleanField(default=False)
    page_count = models.PositiveIntegerField(default=1)
    asset_type = models.CharField(max_length=10, choices=AssetType.choices, default=AssetType.IMAGES)
    s3_key = models.CharField(max_length=512, blank=True, help_text="S3 key prefix for this book's assets (e.g. books/uuid/)")

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title

    @property
    def pdf_view_url(self):
        """URL to open the stored PDF (local MEDIA_URL or remote storage). Empty if not a PDF asset."""
        if self.asset_type != self.AssetType.PDF:
            return ""
        key = (self.s3_key or "").strip()
        if not key:
            return ""

        try:
            if _S3StorageCls is not None and isinstance(default_storage, _S3StorageCls):
                from core.s3_presign import presigned_get_object_url

                signed = presigned_get_object_url(key)
                if signed:
                    return signed
        except Exception:
            pass

        try:
            return default_storage.url(key)
        except Exception:
            media = (settings.MEDIA_URL or "/media/").rstrip("/")
            return f"{media}/{key.lstrip('/')}"


class BookPage(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="pages")
    page_number = models.PositiveIntegerField()
    image_url = models.URLField()

    class Meta:
        ordering = ["page_number"]
        unique_together = ("book", "page_number")

    def __str__(self):
        return f"{self.book.title} p.{self.page_number}"


class FavoriteBook(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favorite_books")
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="saved_by_users")

    class Meta:
        ordering = ["-created_at"]
        unique_together = ("user", "book")

    def __str__(self):
        return f"{self.user} saved {self.book}"


class ActivityConfig(TimeStampedModel):
    class ActivityType(models.TextChoices):
        DRAWING = "drawing", "Drawing"
        DRAG_DROP = "drag_drop", "Drag and drop"
        QUIZ = "quiz", "Quiz"
        HOTSPOT = "hotspot", "Hotspot"

    SCHEMA_VERSION = "1.1"
    SUPPORTED_SCHEMA_VERSIONS = frozenset({"1.0", "1.1"})
    QUIZ_REVEAL_MODES = frozenset({"host_controlled", "instant"})
    HOTSPOT_DISPLAY_MODES = frozenset({"popup", "panel"})

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="activity_configs")
    title = models.CharField(max_length=255)
    activity_type = models.CharField(max_length=20, choices=ActivityType.choices)
    config = models.JSONField(default=dict, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "title"]

    @staticmethod
    def _is_non_empty_list(value):
        return isinstance(value, list) and len(value) > 0

    @staticmethod
    def _validate_coords(obj, label):
        """Return an error string if x/y/w/h on ``obj`` are not all numbers, else None."""
        for coord in ("x", "y", "w", "h"):
            if coord not in obj:
                return f"{label} missing required field {coord}."
            if not isinstance(obj[coord], (int, float)):
                return f"{label} {coord} must be a number."
        return None

    def _validate_drawing_payload(self, payload, version="1.0"):
        errors = []
        pal = payload.get("palette")
        if not self._is_non_empty_list(pal) or not all(isinstance(c, str) and c.strip() for c in pal):
            errors.append("drawing payload requires palette (non-empty list of color strings).")
        brushes = payload.get("brush_sizes")
        if not self._is_non_empty_list(brushes) or not all(
            isinstance(x, (int, float)) and x > 0 for x in brushes
        ):
            errors.append("drawing payload requires brush_sizes (non-empty list of positive numbers).")
        if "allow_eraser" not in payload:
            errors.append("drawing payload requires allow_eraser (boolean).")
        elif not isinstance(payload.get("allow_eraser"), bool):
            errors.append("allow_eraser must be a boolean.")
        if version == "1.1":
            # Optional coloring-page background + tool toggles.
            if "background_url" in payload and not isinstance(payload.get("background_url"), str):
                errors.append("background_url must be a string when present.")
            for flag in ("allow_fill", "allow_shapes", "allow_submit"):
                if flag in payload and not isinstance(payload.get(flag), bool):
                    errors.append(f"{flag} must be a boolean when present.")
        return errors

    def _validate_drag_drop_payload(self, payload, version="1.0"):
        errors = []
        if version == "1.1":
            # Image-anchored: one illustration, draggable text labels, positioned zones.
            if not isinstance(payload.get("image_url"), str) or not payload.get("image_url"):
                errors.append("drag_drop 1.1 payload requires image_url (string).")
            labels = payload.get("labels")
            if not self._is_non_empty_list(labels):
                errors.append("drag_drop 1.1 payload requires labels (non-empty list).")
            else:
                label_ids = set()
                for i, lb in enumerate(labels):
                    if not isinstance(lb, dict) or not isinstance(lb.get("id"), str) or not isinstance(lb.get("text"), str):
                        errors.append(f"labels[{i}] must be an object with string id and text.")
                    else:
                        label_ids.add(lb["id"])
                zones = payload.get("drop_zones")
                if not self._is_non_empty_list(zones):
                    errors.append("drag_drop 1.1 payload requires drop_zones (non-empty list).")
                else:
                    for i, z in enumerate(zones):
                        if not isinstance(z, dict) or not isinstance(z.get("id"), str):
                            errors.append(f"drop_zones[{i}] must be an object with a string id.")
                            continue
                        coord_err = self._validate_coords(z, f"drop_zones[{i}]")
                        if coord_err:
                            errors.append(coord_err)
                        if "accepts" in z and z["accepts"] not in label_ids:
                            errors.append(f"drop_zones[{i}].accepts must reference a label id.")
            return errors
        # 1.0: flat string lists.
        if not self._is_non_empty_list(payload.get("items")):
            errors.append("drag_drop payload requires items (non-empty list).")
        if not self._is_non_empty_list(payload.get("drop_zones")):
            errors.append("drag_drop payload requires drop_zones (non-empty list).")
        return errors

    def _validate_quiz_payload(self, payload, version="1.0"):
        errors = []
        if version == "1.1":
            # Multi-question sequence, optional per-question image + feedback.
            questions = payload.get("questions")
            if not self._is_non_empty_list(questions):
                errors.append("quiz 1.1 payload requires questions (non-empty list).")
            else:
                for i, q in enumerate(questions):
                    if not isinstance(q, dict):
                        errors.append(f"questions[{i}] must be an object.")
                        continue
                    if not isinstance(q.get("id"), str):
                        errors.append(f"questions[{i}] requires string id.")
                    if not isinstance(q.get("prompt"), str) or not q.get("prompt"):
                        errors.append(f"questions[{i}] requires prompt (string).")
                    opts = q.get("options")
                    if not isinstance(opts, list) or not (2 <= len(opts) <= 4) or not all(isinstance(o, str) and o for o in opts):
                        errors.append(f"questions[{i}] requires options (2 to 4 non-empty strings).")
                    ci = q.get("correct_index")
                    if not isinstance(ci, int) or ci < 0 or (isinstance(opts, list) and ci >= len(opts)):
                        errors.append(f"questions[{i}] correct_index must be an int within options.")
                    for opt_key in ("image_url", "feedback_correct", "feedback_wrong"):
                        if opt_key in q and not isinstance(q[opt_key], str):
                            errors.append(f"questions[{i}].{opt_key} must be a string when present.")
            rm = payload.get("reveal_mode")
            if rm not in self.QUIZ_REVEAL_MODES:
                errors.append("quiz payload requires reveal_mode (host_controlled or instant).")
            return errors
        # 1.0: single question.
        q = payload.get("question")
        if not q or not isinstance(q, str):
            errors.append("quiz payload requires question (string).")
        opts = payload.get("options")
        if not isinstance(opts, list) or not (2 <= len(opts) <= 4):
            errors.append("quiz payload requires options (list of 2 to 4 entries).")
        ci = payload.get("correct_index")
        if not isinstance(ci, int) or ci < 0:
            errors.append("quiz payload requires correct_index (non-negative int).")
        elif isinstance(opts, list) and ci >= len(opts):
            errors.append("correct_index must be within options length.")
        rm = payload.get("reveal_mode")
        if rm not in self.QUIZ_REVEAL_MODES:
            errors.append("quiz payload requires reveal_mode (host_controlled or instant).")
        return errors

    def _validate_hotspot_payload(self, payload, version="1.0"):
        errors = []
        url = payload.get("image_url")
        if not url or not isinstance(url, str):
            errors.append("hotspot payload requires image_url (string).")
        if version == "1.1" and "display" in payload and payload["display"] not in self.HOTSPOT_DISPLAY_MODES:
            errors.append("hotspot display must be 'popup' or 'panel' when present.")
        hs = payload.get("hotspots")
        if not isinstance(hs, list) or len(hs) < 1:
            errors.append("hotspot payload requires hotspots (non-empty list).")
            return errors
        for i, h in enumerate(hs):
            if not isinstance(h, dict):
                errors.append(f"hotspots[{i}] must be an object.")
                continue
            if not isinstance(h.get("id"), str) or not isinstance(h.get("content"), str):
                errors.append(f"hotspots[{i}] id and content must be strings.")
            coord_err = self._validate_coords(h, f"hotspots[{i}]")
            if coord_err:
                errors.append(coord_err)
        return errors

    def clean(self):
        super().clean()
        config = self.config or {}
        if not isinstance(config, dict):
            raise ValidationError({"config": "Config must be a JSON object."})

        schema_version = config.get("schema_version")
        if schema_version not in self.SUPPORTED_SCHEMA_VERSIONS:
            supported = '", "'.join(sorted(self.SUPPORTED_SCHEMA_VERSIONS))
            raise ValidationError({"config": f'config.schema_version must be one of "{supported}".'})

        config_activity_type = config.get("activity_type")
        if not config_activity_type:
            raise ValidationError({"config": "config.activity_type is required."})
        if config_activity_type != self.activity_type:
            raise ValidationError({"config": "config.activity_type must match activity_type."})

        config_book_id = config.get("book_id")
        if config_book_id and str(config_book_id) != str(self.book_id):
            raise ValidationError({"config": "config.book_id must match book."})

        ui = config.get("ui")
        if not isinstance(ui, dict):
            raise ValidationError({"config": "config.ui must be an object with title and instructions."})
        if not isinstance(ui.get("title"), str):
            raise ValidationError({"config": "config.ui.title must be a string."})
        if not isinstance(ui.get("instructions"), str):
            raise ValidationError({"config": "config.ui.instructions must be a string (may be empty)."})

        payload = config.get("payload")
        if not isinstance(payload, dict):
            raise ValidationError({"config": "config.payload must be an object."})

        errors = []
        if self.activity_type == self.ActivityType.DRAWING:
            errors.extend(self._validate_drawing_payload(payload, schema_version))
        elif self.activity_type == self.ActivityType.DRAG_DROP:
            errors.extend(self._validate_drag_drop_payload(payload, schema_version))
        elif self.activity_type == self.ActivityType.QUIZ:
            errors.extend(self._validate_quiz_payload(payload, schema_version))
        elif self.activity_type == self.ActivityType.HOTSPOT:
            errors.extend(self._validate_hotspot_payload(payload, schema_version))

        if errors:
            raise ValidationError({"config": " ".join(errors)})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.title} ({self.activity_type})"


class ReadingSession(TimeStampedModel):
    class RoomType(models.TextChoices):
        READING = "reading", "Reading"
        ACTIVITY = "activity", "Activity"
        HYBRID = "hybrid", "Hybrid"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        LOBBY = "lobby", "Lobby"
        ACTIVE = "active", "Active"
        RECONNECTING = "reconnecting", "Reconnecting"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.PROTECT, related_name="sessions")
    child_profile = models.ForeignKey(ChildProfile, on_delete=models.PROTECT, related_name="sessions")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_sessions")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    room_type = models.CharField(max_length=20, choices=RoomType.choices, default=RoomType.READING)
    livekit_room_name = models.CharField(max_length=120, blank=True)
    current_page = models.PositiveIntegerField(default=1)
    timer_total_seconds = models.PositiveIntegerField(default=1200)
    timer_remaining_seconds = models.PositiveIntegerField(default=1200)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    # The activity a session finished on (Activity Room). Denormalized title
    # survives config deletion so the completion screen can still name it.
    completed_activity = models.ForeignKey(
        "ActivityConfig",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="completed_in_sessions",
    )
    completed_activity_title = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.livekit_room_name:
            self.livekit_room_name = f"session-{self.id}"
        super().save(*args, **kwargs)

    @property
    def reading_duration_seconds(self) -> int:
        if self.started_at and self.ended_at:
            return max(0, int((self.ended_at - self.started_at).total_seconds()))
        return 0

    def __str__(self):
        return f"{self.book.title} · {self.child_profile.display_name}"


class SessionParticipant(TimeStampedModel):
    class ParticipantType(models.TextChoices):
        REGISTERED = "registered", "Registered"
        GUEST = "guest", "Guest"

    class SessionRole(models.TextChoices):
        HOST = "host", "Host"
        PARTICIPANT = "participant", "Participant"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ReadingSession, on_delete=models.CASCADE, related_name="participants")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="session_participations")
    display_name = models.CharField(max_length=60)
    participant_type = models.CharField(max_length=20, choices=ParticipantType.choices, default=ParticipantType.REGISTERED)
    session_role = models.CharField(max_length=20, choices=SessionRole.choices, default=SessionRole.PARTICIPANT)
    ready_at = models.DateTimeField(null=True, blank=True)
    joined_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.display_name} ({self.session_role})"


class SessionInvite(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.OneToOneField(ReadingSession, on_delete=models.CASCADE, related_name="invite")
    token = models.CharField(max_length=64, unique=True, default=generate_invite_token, editable=False)
    host_role_granted = models.BooleanField(default=False)
    expires_at = models.DateTimeField(default=invite_expiry_default)
    max_uses = models.PositiveIntegerField(
        default=50,
        help_text="Max number of guests who can claim this link (each join consumes one use).",
    )
    used_count = models.PositiveIntegerField(default=0)

    def is_usable(self):
        return self.used_count < self.max_uses and timezone.now() < self.expires_at

    def __str__(self):
        return self.token


class SessionEvent(TimeStampedModel):
    class EventType(models.TextChoices):
        CREATED = "created", "Created"
        STARTED = "started", "Started"
        RECONNECTED = "reconnected", "Reconnected"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ReadingSession, on_delete=models.CASCADE, related_name="events")
    participant = models.ForeignKey(SessionParticipant, on_delete=models.SET_NULL, null=True, blank=True, related_name="events")
    event_type = models.CharField(max_length=30, choices=EventType.choices)
    payload = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]


class SessionSnapshot(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.OneToOneField(ReadingSession, on_delete=models.CASCADE, related_name="snapshot")
    page_number = models.PositiveIntegerField(default=1)
    timer_state = models.JSONField(default=dict, blank=True)
    annotation_state = models.JSONField(default=dict, blank=True)
    activity_state = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return f"Snapshot for {self.session_id}"


class Entitlement(TimeStampedModel):
    class SubscriptionStatus(models.TextChoices):
        NONE = "none", "None"
        ACTIVE = "active", "Active"
        PAST_DUE = "past_due", "Past due"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="entitlement")
    subscription_status = models.CharField(max_length=20, choices=SubscriptionStatus.choices, default=SubscriptionStatus.NONE)
    plan_code = models.CharField(max_length=50, blank=True)
    stripe_customer_id = models.CharField(max_length=120, blank=True)
    stripe_subscription_id = models.CharField(max_length=120, blank=True)
    stripe_price_id = models.CharField(max_length=120, blank=True)
    last_webhook_event = models.CharField(max_length=120, blank=True)
    sessions_included = models.PositiveIntegerField(default=0)
    sessions_remaining = models.PositiveIntegerField(default=0)
    pack_sessions_remaining = models.PositiveIntegerField(default=0)
    renewal_date = models.DateField(null=True, blank=True)

    def __str__(self):
        return f"{self.user} · {self.sessions_remaining} sessions"


class NotificationPreference(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preferences")
    email_reminders = models.BooleanField(default=True)
    session_updates = models.BooleanField(default=True)
    marketing_opt_in = models.BooleanField(default=False)

    def __str__(self):
        return f"Notification preferences for {self.user}"


class ReadingReminder(TimeStampedModel):
    class Frequency(models.TextChoices):
        DAILY = "daily", "Daily"
        WEEKLY = "weekly", "Weekly"
        WEEKDAYS = "weekdays", "Weekdays"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reading_reminders")
    child_profile = models.ForeignKey(ChildProfile, on_delete=models.CASCADE, related_name="reading_reminders")
    title = models.CharField(max_length=120)
    frequency = models.CharField(max_length=20, choices=Frequency.choices, default=Frequency.DAILY)
    time_of_day = models.TimeField()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["time_of_day", "title"]

    @property
    def next_due(self) -> str:
        """Return ISO date string of the next scheduled reminder."""
        from datetime import date, timedelta
        today = date.today()
        weekday = today.weekday()  # 0=Mon, 6=Sun
        if self.frequency == self.Frequency.DAILY:
            next_date = today
        elif self.frequency == self.Frequency.WEEKLY:
            next_date = today
        elif self.frequency == self.Frequency.WEEKDAYS:
            # Skip to Monday if today is weekend
            if weekday >= 5:
                next_date = today + timedelta(days=(7 - weekday))
            else:
                next_date = today
        else:
            next_date = today
        return f"{next_date}T{self.time_of_day.strftime('%H:%M')}:00"

    def __str__(self):
        return f"{self.title} for {self.child_profile}"


class PortalSettings(models.Model):
    """Singleton (pk=1) settings editable from the super-admin portal; overrides env when filled."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)

    platform_name = models.CharField(max_length=120, default="Bailey & Beau")
    support_email = models.EmailField(blank=True)
    default_from_email = models.CharField(max_length=254, blank=True)
    public_base_url = models.URLField(blank=True)

    default_session_duration_minutes = models.PositiveSmallIntegerField(default=20)
    session_warning_one_minutes = models.PositiveSmallIntegerField(default=5)
    session_warning_two_minutes = models.PositiveSmallIntegerField(default=2)
    invite_link_type_label = models.CharField(max_length=80, default="Single use", blank=True)

    stripe_secret_key = models.TextField(blank=True)
    stripe_webhook_secret = models.TextField(blank=True)

    livekit_api_key = models.CharField(max_length=255, blank=True)
    livekit_api_secret = models.TextField(blank=True)
    livekit_url = models.URLField(blank=True)

    storage_plan_total_gb = models.PositiveIntegerField(default=50)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Portal settings"
        verbose_name_plural = "Portal settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Badge(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.SlugField(unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    icon = models.URLField(blank=True)
    trigger_type = models.CharField(max_length=50)
    trigger_config = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class UserBadge(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    child_profile = models.ForeignKey(ChildProfile, on_delete=models.CASCADE, related_name="user_badges")
    badge = models.ForeignKey(Badge, on_delete=models.CASCADE, related_name="awards")
    session = models.ForeignKey(ReadingSession, on_delete=models.CASCADE, related_name="awarded_badges")

    class Meta:
        unique_together = ("child_profile", "badge", "session")

    def __str__(self):
        return f"{self.child_profile} · {self.badge}"


HEX_COLOR_VALIDATOR = RegexValidator(
    regex=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
    message="Enter a hex colour such as #3D3B62.",
)


class BookTheme(TimeStampedModel):
    """Per-book styling for the reading room.

    The room reads these values as CSS custom properties, so a book can bring
    its own world (a night sky, an ocean, a meadow) instead of every session
    looking identical. Books without a theme fall back to the platform default.
    """

    class Backdrop(models.TextChoices):
        COLOR = "color", "Solid colour"
        GRADIENT = "gradient", "Gradient"
        IMAGE = "image", "Image"
        VIDEO = "video", "Video"

    class ChromeMode(models.TextChoices):
        LIGHT = "light", "Light chrome"
        DARK = "dark", "Dark chrome"

    class BookShadow(models.TextChoices):
        NONE = "none", "None"
        SOFT = "soft", "Soft"
        DEEP = "deep", "Deep"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.OneToOneField(Book, related_name="theme", on_delete=models.CASCADE)

    # ── Backdrop ─────────────────────────────────────────────────────────────
    backdrop_kind = models.CharField(
        max_length=10, choices=Backdrop.choices, default=Backdrop.GRADIENT
    )
    bg_color = models.CharField(max_length=9, blank=True, validators=[HEX_COLOR_VALIDATOR])
    bg_color_2 = models.CharField(max_length=9, blank=True, validators=[HEX_COLOR_VALIDATOR])
    gradient_angle = models.PositiveSmallIntegerField(default=170)
    bg_image = models.ImageField(upload_to="themes/bg/", blank=True)
    bg_video = models.FileField(upload_to="themes/video/", blank=True)
    bg_video_poster = models.ImageField(upload_to="themes/poster/", blank=True)

    # ── Chrome ───────────────────────────────────────────────────────────────
    accent = models.CharField(
        max_length=9, default="#3D3B62", validators=[HEX_COLOR_VALIDATOR]
    )
    ink = models.CharField(max_length=9, default="#23324A", validators=[HEX_COLOR_VALIDATOR])
    chrome_mode = models.CharField(
        max_length=10, choices=ChromeMode.choices, default=ChromeMode.LIGHT
    )

    # ── Book presentation ────────────────────────────────────────────────────
    book_shadow = models.CharField(
        max_length=10, choices=BookShadow.choices, default=BookShadow.SOFT
    )
    tilt_degrees = models.SmallIntegerField(default=-2)

    # ── Ambience ─────────────────────────────────────────────────────────────
    ambient_audio = models.FileField(upload_to="themes/audio/", blank=True)
    ambient_volume = models.PositiveSmallIntegerField(default=20)

    class Meta:
        ordering = ["book__title"]

    def __str__(self):
        return f"Theme · {self.book.title}"

    def clean(self):
        super().clean()
        errors = {}

        if self.backdrop_kind == self.Backdrop.COLOR and not self.bg_color:
            errors["bg_color"] = "A solid-colour backdrop needs a colour."
        if self.backdrop_kind == self.Backdrop.GRADIENT and not (self.bg_color and self.bg_color_2):
            errors["bg_color_2"] = "A gradient backdrop needs both colours."
        if self.backdrop_kind == self.Backdrop.IMAGE and not self.bg_image:
            errors["bg_image"] = "An image backdrop needs an image."
        if self.backdrop_kind == self.Backdrop.VIDEO and not self.bg_video:
            errors["bg_video"] = "A video backdrop needs a video file."

        if self.gradient_angle > 360:
            errors["gradient_angle"] = "Angle must be between 0 and 360 degrees."
        if not -8 <= self.tilt_degrees <= 8:
            errors["tilt_degrees"] = "Tilt must be between -8 and 8 degrees."
        if self.ambient_volume > 100:
            errors["ambient_volume"] = "Volume must be between 0 and 100."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)
