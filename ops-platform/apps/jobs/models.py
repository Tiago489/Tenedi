from django.db import models


class JobRecord(models.Model):
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
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
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='queued')
    payload_preview = models.TextField(blank=True)  # first 500 chars of raw EDI
    error_message = models.TextField(blank=True)
    ai_narrative = models.TextField(blank=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    received_at = models.DateTimeField()
    processed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'jobs_job_record'
        ordering = ['-received_at']

    def __str__(self) -> str:
        return f'{self.queue}/{self.job_id} ({self.status})'
