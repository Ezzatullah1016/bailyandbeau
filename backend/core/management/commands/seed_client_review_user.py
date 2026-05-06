from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import ChildProfile, Entitlement, NotificationPreference


class Command(BaseCommand):
    help = (
        "Create or reset the shared client-review account for external QA "
        "(login at /login/ on the deployed site). Run once per environment."
        " Re-running always refreshes entitlement session quotas for QA."
    )

    # Documented in README and MILESTONE docs — rotate via Django admin after tests if needed.
    USERNAME = "client-review"
    PASSWORD = "BaileyBeauReview2026!"
    # QA “renew package”: refreshed every time this command runs (generous for UAT / prod smoke tests)
    PLAN_CODE = "monthly-plus"
    SESSIONS_INCLUDED = 120
    SESSIONS_REMAINING = 100
    PACK_SESSIONS_REMAINING = 40

    def handle(self, *args, **options):
        User = get_user_model()

        user, created = User.objects.get_or_create(
            username=self.USERNAME,
            defaults={
                "email": "client-review@demo.baileyandbeau.app",
                "first_name": "Client",
                "last_name": "Review",
            },
        )
        user.email = user.email or "client-review@demo.baileyandbeau.app"
        user.is_staff = False
        user.is_superuser = False
        user.set_password(self.PASSWORD)
        user.save()

        child_profile, _ = ChildProfile.objects.get_or_create(
            user=user,
            display_name="Jamie",
            defaults={"age_band": ChildProfile.AgeBand.AGE_3_5},
        )
        if not child_profile.age_band:
            child_profile.age_band = ChildProfile.AgeBand.AGE_3_5
            child_profile.save(update_fields=["age_band", "updated_at"])

        entitlement, _ = Entitlement.objects.get_or_create(user=user)
        entitlement.subscription_status = Entitlement.SubscriptionStatus.ACTIVE
        entitlement.plan_code = self.PLAN_CODE
        entitlement.sessions_included = self.SESSIONS_INCLUDED
        entitlement.sessions_remaining = self.SESSIONS_REMAINING
        entitlement.pack_sessions_remaining = self.PACK_SESSIONS_REMAINING
        entitlement.save(
            update_fields=[
                "subscription_status",
                "plan_code",
                "sessions_included",
                "sessions_remaining",
                "pack_sessions_remaining",
                "updated_at",
            ]
        )

        NotificationPreference.objects.get_or_create(
            user=user,
            defaults={
                "email_reminders": True,
                "session_updates": True,
                "marketing_opt_in": False,
            },
        )

        total_sessions = entitlement.sessions_remaining + entitlement.pack_sessions_remaining
        action = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"{action} client review account for /login/: "
                f"{self.USERNAME} / {self.PASSWORD}"
            )
        )
        self.stdout.write(
            self.style.SUCCESS(
                f"Entitlement: plan={entitlement.plan_code} | "
                f"sessions_remaining={entitlement.sessions_remaining} | "
                f"pack_sessions_remaining={entitlement.pack_sessions_remaining} | "
                f"total_available_for_dashboard={total_sessions}"
            )
        )
