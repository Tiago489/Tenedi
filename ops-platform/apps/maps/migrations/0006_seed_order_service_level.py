from django.db import migrations


ORDER_SERVICE_LEVEL = {
    'name': 'ORDER_SERVICE_LEVEL',
    'description': 'AT5 service level codes used in 211 BOL (AT5_01). '
                   'Maps X12 code to human-readable delivery type.',
    'data': {
        'DEL': 'DELIVERY',
        'PUC': 'PICKUP',
        'PUD': 'DELIVERY',
        'PDL': 'PICKUP_AND_DELIVERY',
    },
}


def seed(apps, schema_editor):
    ReferenceTable = apps.get_model('maps', 'ReferenceTable')
    ReferenceTable.objects.update_or_create(
        name=ORDER_SERVICE_LEVEL['name'],
        defaults={
            'description': ORDER_SERVICE_LEVEL['description'],
            'data': ORDER_SERVICE_LEVEL['data'],
        },
    )


def unseed(apps, schema_editor):
    apps.get_model('maps', 'ReferenceTable').objects.filter(
        name=ORDER_SERVICE_LEVEL['name'],
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('maps', '0005_seed_reference_tables'),
    ]

    operations = [
        migrations.RunPython(seed, reverse_code=unseed),
    ]
