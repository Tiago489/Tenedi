from django.core.management.base import BaseCommand
from apps.partners.models import TradingPartner


class Command(BaseCommand):
    help = 'Seed a test trading partner for local SFTP end-to-end testing'

    def handle(self, *args, **options):
        partner, created = TradingPartner.objects.update_or_create(
            partner_id='EFWW',
            defaults={
                'name': 'EFW Test Partner',
                'isa_qualifier': '02',
                'transport': 'sftp',
                'sftp_host': 'localhost',
                'sftp_port': 2222,
                'sftp_user': 'edi',
                'sftp_password': 'edi123',
                'sftp_inbound_dir': '/home/edi/inbound',
                'sftp_outbound_dir': '/home/edi/outbound',
                'downstream_api_url': 'https://webhook.site/4091a1e9-b93d-4182-bbaa-41d8c5e34bd4',
                'downstream_api_key': '',
                'is_active': True,
            },
        )

        action = 'Created' if created else 'Updated'
        self.stdout.write(self.style.SUCCESS(
            f'{action} trading partner: {partner.name} (partner_id={partner.partner_id})'
        ))
