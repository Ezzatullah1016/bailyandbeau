from django.core.mail import send_mail
from django.core.management.base import BaseCommand

from core.models import NotificationPreference, ReadingReminder
from core.portal_settings import effective_default_from_email


class Command(BaseCommand):
    help = "Send reading reminder emails for active reminders."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview reminder delivery without sending emails.",
        )

    def handle(self, *args, **options):
        reminders = ReadingReminder.objects.filter(is_active=True).select_related("user", "child_profile")
        processed = reminders.count()
        sent = 0

        for reminder in reminders:
            preferences, _ = NotificationPreference.objects.get_or_create(user=reminder.user)
            if not preferences.email_reminders or not reminder.user.email:
                continue

            subject = f"Reading reminder: {reminder.title}"
            message = (
                f"Hi {reminder.user.get_username()},\n\n"
                f"This is your {reminder.frequency} Bailey & Beau reading reminder for "
                f"{reminder.child_profile.display_name} at {reminder.time_of_day.strftime('%H:%M')}.\n\n"
                "Thanks for reading together!"
            )

            if not options["dry_run"]:
                send_mail(
                    subject,
                    message,
                    effective_default_from_email(),
                    [reminder.user.email],
                    fail_silently=False,
                )

            sent += 1

        self.stdout.write(self.style.SUCCESS(f"Processed {processed} reminder(s); sent {sent} email(s)."))
