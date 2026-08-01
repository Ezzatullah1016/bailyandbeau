from django.contrib import admin

from .models import (
    ActivityGroup,
    Theme,
    BookTheme,
    ActivityConfig,
    Badge,
    Book,
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
)


@admin.register(ChildProfile)
class ChildProfileAdmin(admin.ModelAdmin):
    list_display = ("display_name", "user", "age_band", "is_active")
    list_filter = ("age_band", "is_active")
    search_fields = ("display_name", "user__username", "user__email")


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "room_type", "age_band", "published")
    list_filter = ("room_type", "age_band", "published")
    search_fields = ("title", "slug")
    prepopulated_fields = {"slug": ("title",)}


@admin.register(FavoriteBook)
class FavoriteBookAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "created_at")
    search_fields = ("user__username", "user__email", "book__title")


@admin.register(ActivityConfig)
class ActivityConfigAdmin(admin.ModelAdmin):
    list_display = ("title", "book", "activity_type", "sort_order", "is_active")
    list_filter = ("activity_type", "is_active")
    search_fields = ("title", "book__title")


class SessionParticipantInline(admin.TabularInline):
    model = SessionParticipant
    extra = 0


@admin.register(ReadingSession)
class ReadingSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "book", "child_profile", "status", "room_type", "created_at")
    list_filter = ("status", "room_type")
    search_fields = ("book__title", "child_profile__display_name", "created_by__username")
    inlines = [SessionParticipantInline]


@admin.register(SessionInvite)
class SessionInviteAdmin(admin.ModelAdmin):
    list_display = ("session", "token", "host_role_granted", "expires_at", "used_count")
    list_filter = ("host_role_granted",)
    search_fields = ("token",)


@admin.register(SessionEvent)
class SessionEventAdmin(admin.ModelAdmin):
    list_display = ("session", "event_type", "created_at")
    list_filter = ("event_type",)


@admin.register(Entitlement)
class EntitlementAdmin(admin.ModelAdmin):
    list_display = ("user", "subscription_status", "sessions_remaining", "pack_sessions_remaining")
    list_filter = ("subscription_status",)


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "email_reminders", "session_updates", "marketing_opt_in")
    list_filter = ("email_reminders", "session_updates", "marketing_opt_in")


@admin.register(ReadingReminder)
class ReadingReminderAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "child_profile", "frequency", "time_of_day", "is_active")
    list_filter = ("frequency", "is_active")
    search_fields = ("title", "user__username", "child_profile__display_name")


@admin.register(Badge)
class BadgeAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "trigger_type", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "code")


@admin.register(UserBadge)
class UserBadgeAdmin(admin.ModelAdmin):
    list_display = ("child_profile", "badge", "session", "created_at")
    list_filter = ("badge",)


@admin.register(BookTheme)
class BookThemeAdmin(admin.ModelAdmin):
    list_display = ("book", "backdrop_kind", "chrome_mode", "accent", "updated_at")
    list_filter = ("backdrop_kind", "chrome_mode")
    search_fields = ("book__title",)


@admin.register(Theme)
class ThemeAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "accent", "sort_order", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(ActivityGroup)
class ActivityGroupAdmin(admin.ModelAdmin):
    list_display = ("title", "theme", "age_band", "sort_order", "published")
    list_filter = ("published", "theme")
    search_fields = ("title", "slug")
    prepopulated_fields = {"slug": ("title",)}
