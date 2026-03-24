from django.db import models


class TradingPartner(models.Model):
    AFTER_PULL_CHOICES = [
        ('MOVE_TO_ARCHIVE', 'Move to Archive'),
        ('DELETE', 'Delete'),
    ]

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
    sftp_poll_interval_ms = models.IntegerField(default=30000)
    sftp_after_pull = models.CharField(max_length=20, choices=AFTER_PULL_CHOICES, default='MOVE_TO_ARCHIVE')
    sftp_archive_dir = models.CharField(
        max_length=500, blank=True, default='',
        help_text='Directory to move files after processing. Defaults to {inbound_dir}/archive if blank.',
    )

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


class SFTPLog(models.Model):
    ACTION_CHOICES = [
        ('POLL', 'Poll'),
        ('PULL', 'Pull'),
        ('MOVE', 'Move'),
        ('DELETE', 'Delete'),
        ('UPLOAD', 'Upload'),
        ('CONNECT', 'Connect'),
        ('ERROR', 'Error'),
    ]
    STATUS_CHOICES = [
        ('SUCCESS', 'Success'),
        ('FAILURE', 'Failure'),
    ]

    partner = models.ForeignKey(
        TradingPartner,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='sftp_logs',
    )
    timestamp = models.DateTimeField(auto_now_add=True)
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    filename = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    error_message = models.TextField(blank=True)
    file_size = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = 'partners_sftp_log'
        ordering = ['-timestamp']

    def __str__(self) -> str:
        return f'{self.action} {self.filename} ({self.status})'
