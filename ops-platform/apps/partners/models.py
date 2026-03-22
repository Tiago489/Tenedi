from django.db import models


class TradingPartner(models.Model):
    TRANSPORT_CHOICES = [
        ('sftp', 'SFTP'),
        ('as2', 'AS2'),
        ('rest', 'REST'),
    ]

    name = models.CharField(max_length=255)
    partner_id = models.CharField(max_length=15, unique=True)  # ISA sender/receiver ID
    isa_qualifier = models.CharField(max_length=2, default='ZZ')
    transport = models.CharField(max_length=10, choices=TRANSPORT_CHOICES)

    # SFTP config
    sftp_host = models.CharField(max_length=255, blank=True)
    sftp_port = models.IntegerField(default=22)
    sftp_user = models.CharField(max_length=255, blank=True)
    sftp_password = models.CharField(max_length=255, blank=True)  # encrypted in production
    sftp_inbound_dir = models.CharField(max_length=500, blank=True)
    sftp_outbound_dir = models.CharField(max_length=500, blank=True)

    # AS2 config
    as2_id = models.CharField(max_length=128, blank=True)
    as2_url = models.CharField(max_length=500, blank=True)
    as2_cert = models.TextField(blank=True)

    # Downstream API
    downstream_api_url = models.CharField(max_length=500, blank=True)
    downstream_api_key = models.CharField(max_length=255, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'partners_trading_partner'

    def __str__(self) -> str:
        return f'{self.name} ({self.partner_id})'
