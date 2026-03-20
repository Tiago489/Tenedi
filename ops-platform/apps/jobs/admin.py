from django.contrib import admin
from django.contrib import messages
from .models import JobRecord
from services.engine_client import EngineClient


def requeue_jobs(modeladmin, request, queryset):
    """Requeue failed jobs back to the engine."""
    client = EngineClient()
    requeued = 0

    for job in queryset.filter(status='failed'):
        try:
            client._post('/edi/inbound', {
                'raw': job.payload_preview,
                'source': 'requeue',
                'jobId': job.job_id,
            })
            job.status = 'queued'
            job.retry_count += 1
            job.error_message = ''
            job.save()
            requeued += 1
        except Exception as exc:
            messages.error(request, f'Failed to requeue {job.job_id}: {exc}')

    messages.success(request, f'Requeued {requeued} job(s).')


requeue_jobs.short_description = 'Requeue selected failed jobs'


@admin.register(JobRecord)
class JobRecordAdmin(admin.ModelAdmin):
    list_display = (
        'job_id', 'queue', 'source', 'transaction_set',
        'status', 'retry_count', 'received_at', 'processed_at',
    )
    list_filter = ('status', 'queue', 'transaction_set', 'source')
    search_fields = ('job_id', 'error_message', 'transaction_set')
    readonly_fields = (
        'job_id', 'queue', 'source', 'transaction_set', 'trading_partner',
        'payload_preview', 'received_at', 'processed_at',
    )
    actions = [requeue_jobs]

    def has_add_permission(self, request):
        return False  # Jobs are created by the engine, not manually
