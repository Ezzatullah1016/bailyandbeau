from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from core.models import ChildProfile, Entitlement, NotificationPreference


class Command(BaseCommand):
    help = (
        "Create or reset the shared client-review account for external QA "
        "(login at /login/ on the deployed site). Run once per environment."
    )

    # Documented in README and MILESTONE docs — rotate via Django admin after tests if needed.
    USERNAME = "client-review"
    PASSWORD = "BaileyBeauReview2026!"

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
        entitlement.plan_code = "monthly-starter"
        entitlement.sessions_included = max(entitlement.sessions_included, 8)
        entitlement.sessions_remaining = max(entitlement.sessions_remaining, 5)
        entitlement.pack_sessions_remaining = max(entitlement.pack_sessions_remaining, 2)
        entitlement.save()

        NotificationPreference.objects.get_or_create(
            user=user,
            defaults={
                "email_reminders": True,
                "session_updates": True,
                "marketing_opt_in": False,
            },
        )

        action = "Created" if created else "Updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"{action} client review account for /login/: "
                f"{self.USERNAME} / {self.PASSWORD}"
            )
        )
