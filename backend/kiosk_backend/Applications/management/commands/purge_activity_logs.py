from django.core.management.base import BaseCommand

from Applications.models import ActivityLog


class Command(BaseCommand):
    help = (
        "Delete internal activity-log entries older than the retention window "
        f"(ActivityLog.RETENTION_DAYS). Run daily via cron/Task Scheduler."
    )

    def handle(self, *args, **options):
        deleted = ActivityLog.purge_old()
        self.stdout.write(self.style.SUCCESS(
            f"Purged {deleted} activity log(s) older than {ActivityLog.RETENTION_DAYS} days."
        ))
