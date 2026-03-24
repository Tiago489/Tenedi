from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('partners', '0002_tradingpartner_sftp_port'),
    ]

    operations = [
        migrations.AddField(
            model_name='tradingpartner',
            name='sftp_poll_interval_ms',
            field=models.IntegerField(default=30000),
        ),
        migrations.AddField(
            model_name='tradingpartner',
            name='sftp_after_pull',
            field=models.CharField(
                choices=[('MOVE_TO_ARCHIVE', 'Move to Archive'), ('DELETE', 'Delete')],
                default='MOVE_TO_ARCHIVE',
                max_length=20,
            ),
        ),
        migrations.CreateModel(
            name='SFTPLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(auto_now_add=True)),
                ('action', models.CharField(
                    choices=[
                        ('POLL', 'Poll'),
                        ('PULL', 'Pull'),
                        ('MOVE', 'Move'),
                        ('DELETE', 'Delete'),
                        ('UPLOAD', 'Upload'),
                        ('CONNECT', 'Connect'),
                        ('ERROR', 'Error'),
                    ],
                    max_length=10,
                )),
                ('filename', models.CharField(blank=True, max_length=500)),
                ('status', models.CharField(
                    choices=[('SUCCESS', 'Success'), ('FAILURE', 'Failure')],
                    max_length=10,
                )),
                ('error_message', models.TextField(blank=True)),
                ('file_size', models.IntegerField(blank=True, null=True)),
                ('partner', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='sftp_logs',
                    to='partners.tradingpartner',
                )),
            ],
            options={
                'db_table': 'partners_sftp_log',
                'ordering': ['-timestamp'],
            },
        ),
    ]
