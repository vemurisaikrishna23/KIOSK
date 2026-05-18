from django.core.management.base import BaseCommand
from UserAccounts.permissions_seed import create_default_permissions

class Command(BaseCommand):
    help = 'Seeds default permissions'

    def handle(self, *args, **options):
        create_default_permissions()
