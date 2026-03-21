from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('jobs', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='jobrecord',
            name='ai_narrative',
            field=models.TextField(blank=True),
        ),
    ]
