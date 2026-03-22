from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('partners', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='tradingpartner',
            name='sftp_port',
            field=models.IntegerField(default=22),
        ),
    ]
