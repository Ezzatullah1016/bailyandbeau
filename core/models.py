import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)
    room_type = models.CharField(max_length=20, choices=RoomType.choices, default=RoomType.READING)
    age_band = models.CharField(max_length=10, choices=AgeBand.choices, default=AgeBand.AGE_3_5)
    cover_image = models.URLField(blank=True)
    published = models.BooleanField(default=False)
    page_count = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    book = models.ForeignKey(Book, on_delete=models.CASCADE, related_name="activity_configs")
    title = models.CharField(max_length=255)
    activity_type = models.CharField(max_length=20, choices=ActivityType.choices)
    config = models.JSONField(default=dict, blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "title"]

    def clean(self):
        super().clean()
        config = self.config or {}
        required_keys = {
            self.ActivityType.DRAWING: ["colors"],
            self.ActivityType.DRAG_DROP: ["items", "zones"],
            self.ActivityType.QUIZ: ["question", "options", "correct_index"],
            self.ActivityType.HOTSPOT: ["image", "hotspots"],
        }
        missing = [key for key in required_keys.get(self.activity_type, []) if key not in config]
        if missing:
            raise ValidationError({"config": f"Missing required config keys: {', '.join(missing)}"})

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

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.livekit_room_name:
            self.livekit_room_name = f"session-{self.id}"
        super().save(*args, **kwargs)

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
    max_uses = models.PositiveIntegerField(default=1)
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

    def __str__(self):
        return f"{self.title} for {self.child_profile}"


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
