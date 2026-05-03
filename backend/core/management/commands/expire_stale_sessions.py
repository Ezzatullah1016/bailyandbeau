from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from core.models import ReadingSession


class Command(BaseCommand):
    help = 'Mark sessions stuck in PENDING/LOBBY/ACTIVE with no activity for more than N hours as EXPIRED.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--hours',
            type=int,
            default=4,
            help='Number of hours of inactivity before a session is expired (default: 4)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print sessions that would be expired without making changes',
        )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(hours=options['hours'])
        stale = ReadingSession.objects.filter(
            status__in=[
                ReadingSession.Status.PENDING,
                ReadingSession.Status.LOBBY,
                ReadingSession.Status.ACTIVE,
            ],
            created_at__lt=cutoff,
        )

        count = stale.count()
        if count == 0:
            self.stdout.write(self.style.SUCCESS('No stale sessions found.'))
            return

        if options['dry_run']:
            self.stdout.write(self.style.WARNING(f'[DRY RUN] {count} session(s) would be expired:'))
            for s in stale:
                self.stdout.write(f'  {s.id}  status={s.status}  created={s.created_at}')
            return

        stale.update(status=ReadingSession.Status.EXPIRED)
        self.stdout.write(self.style.SUCCESS(f'Expired {count} stale session(s).'))
