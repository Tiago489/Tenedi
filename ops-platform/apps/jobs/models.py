from django.db import models


class JobRecord(models.Model):
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('reprocessing', 'Reprocessing'),
    ]

    job_id = models.CharField(max_length=100, unique=True)
    queue = models.CharField(max_length=50)  # "edi:inbound" | "edi:outbound"
    source = models.CharField(max_length=20)  # "sftp" | "as2" | "rest"
    transaction_set = models.CharField(max_length=10, blank=True)
    trading_partner = models.ForeignKey(
        'partners.TradingPartner',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='jobs',
    )
    reprocessed_from = models.ForeignKey(
        'self',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='reprocessed_jobs',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='queued')
    payload_preview = models.TextField(blank=True)  # first 500 chars of raw EDI
    raw_edi = models.TextField(blank=True)  # full raw EDI for reprocessing
    error_message = models.TextField(blank=True)
    ai_narrative = models.TextField(blank=True)
    validation_errors = models.JSONField(null=True, blank=True)
    validation_warnings = models.JSONField(null=True, blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    received_at = models.DateTimeField()
    processed_at = models.DateTimeField(null=True, blank=True)

    # Multi-TX interchange tracking
    interchange_control_number = models.CharField(
        max_length=9, blank=True, default='',
        help_text='ISA interchange control number',
    )
    transaction_set_control_number = models.CharField(
        max_length=9, blank=True, default='',
        help_text='ST transaction set control number',
    )
    transaction_set_index = models.IntegerField(
        default=0,
        help_text='Index of this TX set within the interchange (0-based)',
    )
    transaction_sets_in_interchange = models.IntegerField(
        default=1,
        help_text='Total number of TX sets in the original interchange',
    )

    # Downstream API delivery
    downstream_status_code = models.IntegerField(null=True, blank=True)
    downstream_response = models.TextField(blank=True)
    downstream_delivered_at = models.DateTimeField(null=True, blank=True)
    downstream_error = models.TextField(blank=True)

    class Meta:
        db_table = 'jobs_job_record'
        ordering = ['-received_at']

    def __str__(self) -> str:
        return f'{self.queue}/{self.job_id} ({self.status})'
