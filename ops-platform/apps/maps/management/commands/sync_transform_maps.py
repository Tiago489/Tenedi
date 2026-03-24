import requests
from django.core.management.base import BaseCommand
from django.conf import settings
from django.utils import timezone
from apps.maps.models import TransformMap
from apps.partners.models import TradingPartner


class Command(BaseCommand):
    help = 'Sync transform maps from the engine registry into Django DB'

    def add_arguments(self, parser):
        parser.add_argument(
            '--engine-url',
            default=settings.ENGINE_API_URL.rstrip('/'),
            help='Engine base URL (default: ENGINE_API_URL from settings)',
        )

    def handle(self, *args, **options):
        engine_url = options['engine_url']
        url = f'{engine_url}/maps/registry'

        self.stdout.write(f'Fetching registry from {url}...')

        try:
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            entries = resp.json()
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f'Failed to reach engine: {exc}'))
            return

        created = 0
        updated = 0

        for entry in entries:
            tx_set = entry.get('transactionSet', '')
            direction = entry.get('direction', '')
            partner_key = entry.get('partnerKey')

            if not tx_set or not direction:
                continue

            trading_partner = None
            if partner_key:
                trading_partner = TradingPartner.objects.filter(
                    partner_id__iexact=partner_key,
                ).first()
                if not trading_partner:
                    self.stdout.write(self.style.WARNING(
                        f'  No TradingPartner found for partner_key={partner_key!r} — FK left null'
                    ))

            obj, was_created = TransformMap.objects.update_or_create(
                transaction_set=tx_set,
                direction=direction,
                partner=trading_partner,
                defaults={
                    'version': entry.get('version', 1),
                    'custom_transform_id': entry.get('customTransformId') or '',
                    'dsl_source': entry.get('dslSource') or '',
                    'is_live': True,
                    'published_at': timezone.now(),
                },
            )

            action = 'created' if was_created else 'updated'
            label = f'{partner_key or "default"} — {tx_set} {direction}'
            self.stdout.write(f'  {action}: {label}')

            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(self.style.SUCCESS(
            f'Sync complete: {created} created, {updated} updated, {created + updated} total'
        ))
