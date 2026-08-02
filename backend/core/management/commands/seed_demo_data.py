from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import ActivityConfig, Badge, Book, ChildProfile, Entitlement, NotificationPreference, ReadingReminder


class Command(BaseCommand):
    help = "Seed local demo data for Bailey & Beau."

    def handle(self, *args, **options):
        User = get_user_model()

        admin_user, admin_created = User.objects.get_or_create(
            username="admin",
            defaults={
                "email": "admin@baileyandbeau.local",
                "is_staff": True,
                "is_superuser": True,
            },
        )
        admin_user.is_staff = True
        admin_user.is_superuser = True
        admin_user.email = admin_user.email or "admin@baileyandbeau.local"
        admin_user.set_password("Admin123!")
        admin_user.save()

        parent_user, _ = User.objects.get_or_create(
            username="demo-parent",
            defaults={
                "email": "parent@baileyandbeau.local",
                "first_name": "Demo",
                "last_name": "Parent",
            },
        )
        parent_user.email = parent_user.email or "parent@baileyandbeau.local"
        parent_user.set_password("Demo123!")
        parent_user.save()

        child_profile, _ = ChildProfile.objects.get_or_create(
            user=parent_user,
            display_name="Ava",
            defaults={"age_band": ChildProfile.AgeBand.AGE_3_5},
        )
        if not child_profile.age_band:
            child_profile.age_band = ChildProfile.AgeBand.AGE_3_5
            child_profile.save(update_fields=["age_band", "updated_at"])

        entitlement, _ = Entitlement.objects.get_or_create(user=parent_user)
        entitlement.subscription_status = Entitlement.SubscriptionStatus.ACTIVE
        entitlement.plan_code = "monthly-starter"
        entitlement.sessions_included = 8
        entitlement.sessions_remaining = max(entitlement.sessions_remaining, 5)
        entitlement.pack_sessions_remaining = max(entitlement.pack_sessions_remaining, 2)
        entitlement.save()

        NotificationPreference.objects.get_or_create(
            user=parent_user,
            defaults={
                "email_reminders": True,
                "session_updates": True,
                "marketing_opt_in": False,
            },
        )

        reminder, _ = ReadingReminder.objects.get_or_create(
            user=parent_user,
            child_profile=child_profile,
            title="Evening reading",
            defaults={
                "frequency": ReadingReminder.Frequency.DAILY,
                "time_of_day": "19:00:00",
                "is_active": True,
            },
        )
        if not reminder.is_active:
            reminder.is_active = True
            reminder.save(update_fields=["is_active", "updated_at"])

        books = [
            {
                "title": "Moonlight Bedtime",
                "slug": "moonlight-bedtime",
                "room_type": Book.RoomType.READING,
                "age_band": Book.AgeBand.AGE_3_5,
                "description": "A calming bedtime story.",
                "page_count": 12,
            },
            {
                "title": "Colour Adventure",
                "slug": "colour-adventure",
                "room_type": Book.RoomType.ACTIVITY,
                "age_band": Book.AgeBand.AGE_3_5,
                "description": "An interactive colouring and matching activity book.",
                "page_count": 10,
            },
            {
                "title": "Little Shapes",
                "slug": "little-shapes",
                "room_type": Book.RoomType.HYBRID,
                "age_band": Book.AgeBand.AGE_3_5,
                "description": "A playful story about spotting shapes together.",
                "page_count": 14,
            },
        ]

        created_books = []
        for item in books:
            book, _ = Book.objects.get_or_create(
                slug=item["slug"],
                defaults={**item, "published": True},
            )
            if not book.published:
                book.published = True
                book.save(update_fields=["published", "updated_at"])
            created_books.append(book)

        activity_book = next((book for book in created_books if book.slug == "colour-adventure"), None)
        if activity_book:

            def quiz_envelope(book):
                return {
                    # 1.0-shaped payload (single question) — pin the version so it
                    # validates against the 1.0 rules, not the newer default.
                    "schema_version": "1.0",
                    "activity_type": "quiz",
                    "book_id": str(book.id),
                    "ui": {
                        "title": "Pick the bright stars",
                        "instructions": "Choose the answer that matches the story.",
                        "theme": "default",
                    },
                    "payload": {
                        "question": "Which star is the brightest?",
                        "options": ["Blue", "Gold", "Grey"],
                        "correct_index": 1,
                        "reveal_mode": "host_controlled",
                    },
                    "validation": {},
                }

            ActivityConfig.objects.update_or_create(
                book=activity_book,
                title="Pick the bright stars",
                defaults={
                    "activity_type": ActivityConfig.ActivityType.QUIZ,
                    "config": quiz_envelope(activity_book),
                    "sort_order": 1,
                    "is_active": True,
                },
            )

        Badge.objects.get_or_create(
            code="first-session",
            defaults={
                "name": "First Session",
                "description": "Completed your first story session.",
                "trigger_type": "session_completed",
                "trigger_config": {"milestone": 1},
                "is_active": True,
            },
        )
        Badge.objects.get_or_create(
            code="story-explorer",
            defaults={
                "name": "Story Explorer",
                "description": "Completed three story sessions.",
                "trigger_type": "session_completed",
                "trigger_config": {"milestone": 3},
                "is_active": True,
            },
        )

        self.stdout.write(
            self.style.SUCCESS(
                "Demo data prepared. Admin: admin / Admin123! | Parent: demo-parent / Demo123!"
            )
        )
