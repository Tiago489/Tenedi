from django.db import migrations


REFERENCE_TABLES = [
    {
        'name': 'RESERVATION_ACTION_CODES',
        'description': 'Action codes used in 990 tender response (B1_04). '
                       'Maps human-readable intent to X12 code.',
        'data': {
            'ACCEPTED': 'A',
            'CANCELED': 'D',
            'DELETE':   'R',
        },
    },
    {
        'name': 'PAYMENT_CODES',
        'description': 'Shipment method of payment codes used in 204/210 (B2_05 / B3_04).',
        'data': {
            'PP': 'PREPAID_BY_SELLER',
            'CC': 'COLLECT',
            'NC': 'SERVICE_FREIGHT_NO_CHARGES',
            'TP': 'THIRD_PARTY_PAY',
        },
    },
    {
        'name': 'PURPOSE_CODES',
        'description': 'Transaction purpose codes used in 204 (B2_08).',
        'data': {
            '00': 'ORIGINAL',
            '01': 'CANCELLATION',
            '04': 'CHANGE',
        },
    },
    {
        'name': 'DELIVERY_PICKUP',
        'description': 'Stop reason codes used in 204 S5 loop (S5_02).',
        'data': {
            'PA': 'PICKUP',
            'DA': 'DELIVERY',
            'LH': 'NONE',
        },
    },
    {
        'name': 'ORDER_SERVICE_LEVEL',
        'description': 'AT5 service level codes used in 211 BOL (AT5_01). '
                       'Maps X12 code to human-readable delivery type.',
        'data': {
            'DEL': 'DELIVERY',
            'PUC': 'PICKUP',
            'PUD': 'DELIVERY',
            'PDL': 'PICKUP_AND_DELIVERY',
        },
    },
]


def seed_reference_tables(apps, schema_editor):
    ReferenceTable = apps.get_model('maps', 'ReferenceTable')
    for entry in REFERENCE_TABLES:
        ReferenceTable.objects.update_or_create(
            name=entry['name'],
            defaults={
                'description': entry['description'],
                'data': entry['data'],
            },
        )


def unseed_reference_tables(apps, schema_editor):
    ReferenceTable = apps.get_model('maps', 'ReferenceTable')
    ReferenceTable.objects.filter(
        name__in=[t['name'] for t in REFERENCE_TABLES],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('maps', '0004_mappingexample_direction'),
    ]

    operations = [
        migrations.RunPython(seed_reference_tables, reverse_code=unseed_reference_tables),
    ]
