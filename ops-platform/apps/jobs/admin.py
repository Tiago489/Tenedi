import json
import requests as http_requests
from django.contrib import admin
from django.contrib import messages
from django.utils import timezone
from django.utils.html import format_html
from django.conf import settings
from .models import JobRecord
from services.engine_client import EngineClient
from services.narrative import NarrativeService


def requeue_jobs(modeladmin, request, queryset):
    """Requeue failed jobs back to the engine (legacy — uses payload_preview)."""
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


def reprocess_jobs(modeladmin, request, queryset):
    """Reprocess selected jobs by submitting their full raw EDI back to the engine."""
    engine_url = settings.ENGINE_API_URL.rstrip('/')
    reprocessed = 0

    for job in queryset.filter(status__in=['failed', 'completed']):
        if not job.raw_edi:
            messages.warning(request, f'Job {job.job_id} has no raw EDI stored — cannot reprocess')
            continue
        try:
            response = http_requests.post(
                f'{engine_url}/edi/inbound',
                data=job.raw_edi.encode('utf-8'),
                headers={'Content-Type': 'text/plain'},
                timeout=10,
            )
            response.raise_for_status()
            new_job_id = response.json().get('jobId', f'reprocess-{job.job_id}-{int(timezone.now().timestamp())}')

            JobRecord.objects.create(
                job_id=new_job_id,
                queue=job.queue,
                source='reprocess',
                transaction_set=job.transaction_set,
                status='queued',
                raw_edi=job.raw_edi,
                reprocessed_from=job,
                received_at=timezone.now(),
            )

            job.status = 'reprocessing'
            job.save(update_fields=['status'])
            reprocessed += 1
        except Exception as exc:
            messages.error(request, f'Failed to reprocess {job.job_id}: {exc}')

    messages.success(request, f'Reprocessed {reprocessed} job(s).')


reprocess_jobs.short_description = 'Reprocess selected jobs (uses full raw EDI)'


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
        'reprocessed_from', 'payload_preview', 'received_at', 'processed_at',
        'ai_narrative', 'formatted_validation_errors', 'formatted_validation_warnings',
    )
    actions = [requeue_jobs, reprocess_jobs]

    fieldsets = (
        (None, {
            'fields': (
                'job_id', 'queue', 'source', 'transaction_set',
                'trading_partner', 'reprocessed_from', 'status', 'retry_count',
            ),
        }),
        ('Validation', {
            'fields': ('formatted_validation_errors', 'formatted_validation_warnings'),
            'classes': ('wide',),
        }),
        ('AI Summary', {
            'fields': ('ai_narrative',),
            'classes': ('wide',),
        }),
        ('Detail', {
            'fields': ('payload_preview', 'error_message', 'received_at', 'processed_at'),
            'classes': ('collapse',),
        }),
    )

    def formatted_validation_errors(self, obj):
        if obj.validation_errors:
            return format_html('<pre style="white-space:pre-wrap">{}</pre>', json.dumps(obj.validation_errors, indent=2))
        return '—'

    formatted_validation_errors.short_description = 'Validation Errors'

    def formatted_validation_warnings(self, obj):
        if obj.validation_warnings:
            return format_html('<pre style="white-space:pre-wrap">{}</pre>', json.dumps(obj.validation_warnings, indent=2))
        return '—'

    formatted_validation_warnings.short_description = 'Validation Warnings'

    def has_add_permission(self, request):
        return False  # Jobs are created by the engine, not manually

    def change_view(self, request, object_id, form_url='', extra_context=None):
        obj = self.get_object(request, object_id)
        if obj is not None:
            if obj.validation_errors:
                messages.error(request, 'This job has validation errors. See the Validation section below.')
            if not obj.ai_narrative:
                try:
                    obj.ai_narrative = NarrativeService().generate(obj)
                    obj.save(update_fields=['ai_narrative'])
                except Exception as exc:
                    messages.warning(request, f'Could not generate AI narrative: {exc}')
        return super().change_view(request, object_id, form_url, extra_context)
