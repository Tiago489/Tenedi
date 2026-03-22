from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('jobs', '0002_jobrecord_ai_narrative'),
    ]

    operations = [
        migrations.AddField(
            model_name='jobrecord',
            name='raw_edi',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='jobrecord',
            name='validation_errors',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='jobrecord',
            name='validation_warnings',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='jobrecord',
            name='reprocessed_from',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='reprocessed_jobs',
                to='jobs.jobrecord',
            ),
        ),
        migrations.AlterField(
            model_name='jobrecord',
            name='status',
            field=models.CharField(
                choices=[
                    ('queued', 'Queued'),
                    ('active', 'Active'),
                    ('completed', 'Completed'),
                    ('failed', 'Failed'),
                    ('reprocessing', 'Reprocessing'),
                ],
                default='queued',
                max_length=20,
            ),
        ),
    ]
