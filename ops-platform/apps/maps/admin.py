from django.contrib import admin
from django.contrib import messages
from django.utils import timezone
from django.utils.html import format_html
from .models import ReferenceTable, JediSampleFixture, TransformMap, DSLKeywordRequest, DSLExample, MappingExample
from services.engine_client import EngineClient


@admin.register(ReferenceTable)
class ReferenceTableAdmin(admin.ModelAdmin):
    list_display = ('name', 'description', 'updated_at')
    search_fields = ('name', 'description')
    readonly_fields = ('updated_at',)


@admin.register(JediSampleFixture)
class JediSampleFixtureAdmin(admin.ModelAdmin):
    list_display = ('transaction_set', 'description', 'is_default')
    list_filter = ('transaction_set', 'is_default')
    search_fields = ('transaction_set', 'description')


def compile_and_publish(modeladmin, request, queryset):
    """Admin action: compile DSL and publish map to the TypeScript engine."""
    client = EngineClient()

    for transform_map in queryset:
        try:
            compile_result = client.compile_dsl(
                dsl=transform_map.dsl_source,
                transaction_set=transform_map.transaction_set,
            )

            if not compile_result.get('ok'):
                messages.error(
                    request,
                    f'Compile failed for {transform_map}: {compile_result.get("error")}',
                )
                continue

            transform_map.compiled_jsonata = compile_result.get('jsonata', '')
            transform_map.validation_result = compile_result

            publish_data = {
                'id': f'django-{transform_map.pk}',
                'transactionSet': transform_map.transaction_set,
                'direction': transform_map.direction,
                'mappings': [],
                'dslSource': transform_map.dsl_source,
            }
            publish_result = client.publish_map(publish_data)

            transform_map.is_live = True
            transform_map.published_at = timezone.now()
            transform_map.published_by = request.user
            transform_map.version = publish_result.get('version', transform_map.version + 1)
            transform_map.save()

            messages.success(
                request,
                f'Published {transform_map} — v{transform_map.version}. '
                f'JSONata preview: {str(transform_map.compiled_jsonata)[:200]}',
            )

        except Exception as exc:
            messages.error(request, f'Error publishing {transform_map}: {exc}')


compile_and_publish.short_description = 'Compile & Publish selected maps'


@admin.register(TransformMap)
class TransformMapAdmin(admin.ModelAdmin):
    """Top-level audit view for all transform maps across partners."""
    list_display = ('partner_link', 'transaction_set', 'direction', 'display_map_type', 'is_live', 'published_at')
    list_filter = ('direction', 'is_live', 'transaction_set', 'partner')
    search_fields = ('transaction_set', 'dsl_source', 'custom_transform_id')
    readonly_fields = (
        'version', 'compiled_jsonata', 'validation_result',
        'published_at', 'published_by', 'created_at', 'display_map_type',
    )
    actions = [compile_and_publish]

    fieldsets = (
        ('Partner & Identity', {
            'fields': ('partner', 'transaction_set', 'direction', 'display_map_type', 'custom_transform_id'),
        }),
        ('DSL Source', {
            'fields': ('dsl_source',),
            'classes': ('collapse',) if True else (),
        }),
        ('Compiled Output', {
            'classes': ('collapse',),
            'fields': ('compiled_jsonata', 'validation_result'),
        }),
        ('Publication', {
            'fields': ('is_live', 'version', 'published_at', 'published_by', 'created_at'),
        }),
    )

    @admin.display(description='Type')
    def display_map_type(self, obj):
        return obj.map_type

    @admin.display(description='Partner')
    def partner_link(self, obj):
        if obj.partner:
            from django.urls import reverse
            url = reverse('admin:partners_tradingpartner_change', args=[obj.partner.pk])
            return format_html('<a href="{}">{}</a>', url, obj.partner)
        return '—'


@admin.register(DSLKeywordRequest)
class DSLKeywordRequestAdmin(admin.ModelAdmin):
    list_display = ('transaction_set', 'status', 'created_at', 'description')
    list_filter = ('status', 'transaction_set')
    search_fields = ('description', 'intent')
    readonly_fields = ('created_at',)
    actions = ['mark_accepted', 'mark_rejected']

    @admin.action(description='Mark selected as Accepted')
    def mark_accepted(self, request, queryset):
        updated = queryset.update(status='accepted')
        messages.success(request, f'{updated} keyword request(s) marked accepted.')

    @admin.action(description='Mark selected as Rejected')
    def mark_rejected(self, request, queryset):
        updated = queryset.update(status='rejected')
        messages.success(request, f'{updated} keyword request(s) marked rejected.')


@admin.register(DSLExample)
class DSLExampleAdmin(admin.ModelAdmin):
    list_display = ('transaction_set', 'intent', 'created_at')
    list_filter = ('transaction_set',)
    search_fields = ('intent', 'dsl_source')


@admin.register(MappingExample)
class MappingExampleAdmin(admin.ModelAdmin):
    list_display = ('transaction_set', 'direction', 'trading_partner', 'short_hash', 'is_validated', 'created_at')
    list_filter = ('transaction_set', 'direction', 'is_validated', 'trading_partner')
    search_fields = ('transaction_set', 'content_hash')
    readonly_fields = ('content_hash', 'raw_edi', 'jedi_output', 'system_json_output', 'created_at')
    actions = ['mark_validated', 'mark_unvalidated']

    fieldsets = (
        ('Classification', {
            'fields': ('transaction_set', 'direction', 'trading_partner', 'is_validated', 'content_hash', 'created_at'),
        }),
        ('DSL Source (edit to fill in the mapping)', {
            'fields': ('dsl_source',),
            'classes': ('wide',),
        }),
        ('Raw EDI', {
            'fields': ('raw_edi',),
            'classes': ('collapse',),
        }),
        ('JEDI Output', {
            'fields': ('jedi_output',),
            'classes': ('collapse',),
        }),
        ('System JSON Output', {
            'fields': ('system_json_output',),
            'classes': ('collapse',),
        }),
    )

    @admin.display(description='Hash')
    def short_hash(self, obj):
        return obj.content_hash[:8]

    @admin.action(description='Mark selected as validated')
    def mark_validated(self, request, queryset):
        updated = queryset.update(is_validated=True)
        messages.success(request, f'{updated} example(s) marked as validated.')

    @admin.action(description='Mark selected as unvalidated')
    def mark_unvalidated(self, request, queryset):
        updated = queryset.update(is_validated=False)
        messages.success(request, f'{updated} example(s) marked as unvalidated.')
