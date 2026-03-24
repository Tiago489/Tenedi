import requests as http_requests
from django.contrib import admin
from django.contrib import messages
from django.conf import settings
from django.utils.html import format_html
from .models import TradingPartner, SFTPLog
from apps.maps.models import TransformMap


def test_sftp_connection(modeladmin, request, queryset):
    """Test SFTP connection for selected partners via the engine."""
    engine_url = settings.ENGINE_API_URL.rstrip('/')

    for partner in queryset:
        if partner.transport != 'sftp':
            messages.warning(request, f'{partner.name}: transport is {partner.transport}, not SFTP — skipping')
            continue
        try:
            response = http_requests.post(
                f'{engine_url}/api/partners/{partner.partner_id}/test-sftp',
                timeout=15,
            )
            response.raise_for_status()
            result = response.json()
            if result.get('success'):
                files_found = result.get('filesFound', 0)
                messages.success(request, f'{partner.name}: connected successfully — {files_found} file(s) in inbound dir')
            else:
                messages.error(request, f'{partner.name}: connection failed — {result.get("error", "unknown error")}')
        except Exception as exc:
            messages.error(request, f'{partner.name}: could not reach engine — {exc}')


test_sftp_connection.short_description = 'Test SFTP connection'


def pull_now(modeladmin, request, queryset):
    """Trigger an immediate SFTP poll cycle for a single partner."""
    if queryset.count() != 1:
        messages.error(request, 'Select exactly one partner to use Pull Now.')
        return

    partner = queryset.first()
    if partner.transport != 'sftp':
        messages.error(request, f'{partner.name}: transport is {partner.transport}, not SFTP.')
        return

    engine_url = settings.ENGINE_API_URL.rstrip('/')
    try:
        response = http_requests.post(
            f'{engine_url}/api/partners/{partner.partner_id}/poll-now',
            timeout=35,
        )
        response.raise_for_status()
        result = response.json()
        messages.success(
            request,
            f'Poll complete: {result["filesFound"]} file(s) found, {result["filesProcessed"]} processed',
        )
        if result.get('errors'):
            for err in result['errors']:
                messages.warning(request, f'Poll error: {err}')
    except Exception as exc:
        messages.error(request, f'Poll failed for {partner.name}: {exc}')


pull_now.short_description = 'Pull now (single partner only)'


class TransformMapInline(admin.TabularInline):
    """Inline view of transform maps owned by this trading partner."""
    model = TransformMap
    extra = 0
    fields = ('transaction_set', 'direction', 'display_type', 'custom_transform_id', 'is_live', 'edit_link')
    readonly_fields = ('display_type', 'edit_link')
    show_change_link = True

    @admin.display(description='Type')
    def display_type(self, obj):
        if not obj.pk:
            return '—'
        return obj.map_type

    @admin.display(description='Edit')
    def edit_link(self, obj):
        if not obj.pk:
            return '—'
        from django.urls import reverse
        url = reverse('admin:maps_transformmap_change', args=[obj.pk])
        return format_html('<a href="{}">Open full editor &rarr;</a>', url)


@admin.register(TradingPartner)
class TradingPartnerAdmin(admin.ModelAdmin):
    list_display = ('name', 'partner_id', 'transport', 'is_active', 'map_count', 'created_at')
    list_filter = ('transport', 'is_active')
    search_fields = ('name', 'partner_id', 'as2_id')
    readonly_fields = ('created_at', 'updated_at')
    actions = [test_sftp_connection, pull_now]
    inlines = [TransformMapInline]

    fieldsets = (
        ('General', {
            'fields': ('name', 'partner_id', 'isa_qualifier', 'transport', 'is_active'),
        }),
        ('SFTP Config', {
            'classes': ('collapse',),
            'fields': (
                'sftp_host', 'sftp_port', 'sftp_user', 'sftp_password',
                'sftp_inbound_dir', 'sftp_outbound_dir', 'sftp_archive_dir',
                'sftp_poll_interval_ms', 'sftp_after_pull',
            ),
        }),
        ('AS2 Config', {
            'classes': ('collapse',),
            'fields': ('as2_id', 'as2_url', 'as2_cert'),
        }),
        ('Downstream API', {
            'classes': ('collapse',),
            'fields': ('downstream_api_url', 'downstream_api_key'),
        }),
        ('Timestamps', {
            'classes': ('collapse',),
            'fields': ('created_at', 'updated_at'),
        }),
    )

    @admin.display(description='Maps')
    def map_count(self, obj):
        count = obj.transform_maps.count()
        if count == 0:
            return '—'
        return count


@admin.register(SFTPLog)
class SFTPLogAdmin(admin.ModelAdmin):
    list_display = ('timestamp', 'partner', 'action', 'filename', 'status', 'file_size')
    list_filter = ('partner', 'action', 'status')
    search_fields = ('filename',)
    readonly_fields = (
        'partner', 'timestamp', 'action', 'filename',
        'status', 'error_message', 'file_size',
    )

    def has_add_permission(self, request):
        return False  # Logs are created by the engine only

    def has_change_permission(self, request, obj=None):
        return False
