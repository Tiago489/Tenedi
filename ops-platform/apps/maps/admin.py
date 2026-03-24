import json
from django.contrib import admin
from django.contrib import messages
from django.utils import timezone
from django.utils.html import format_html
from .models import ReferenceTable, JediSampleFixture, TransformMap, DSLKeywordRequest, DSLExample, MappingExample
from services.engine_client import EngineClient
from services.stedi_converter import convert as convert_stedi


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


def convert_stedi_mapping(modeladmin, request, queryset):
    """Admin action: convert uploaded Stedi mapping.json to DSL preview."""
    for transform_map in queryset:
        if not transform_map.stedi_mapping_json:
            messages.warning(request, f'{transform_map}: No Stedi mapping.json uploaded — skipping')
            continue

        result = convert_stedi(transform_map.stedi_mapping_json)
        transform_map.stedi_conversion_preview = result.dsl
        transform_map.stedi_conversion_notes = result.notes
        if result.needs_custom_transform:
            transform_map.stedi_conversion_notes += '\n\n⚠ NEEDS CUSTOM TRANSFORM — human review required'
        transform_map.save(update_fields=['stedi_conversion_preview', 'stedi_conversion_notes'])

        messages.success(request, f'{transform_map}: Converted — {result.fields_mapped} fields mapped')


convert_stedi_mapping.short_description = 'Convert Stedi mapping.json to DSL'


@admin.register(TransformMap)
class TransformMapAdmin(admin.ModelAdmin):
    """Top-level audit view for all transform maps across partners."""
    list_display = ('partner_link', 'transaction_set', 'direction', 'display_map_type', 'is_live', 'has_stedi', 'published_at')
    list_filter = ('direction', 'is_live', 'transaction_set', 'partner')
    search_fields = ('transaction_set', 'dsl_source', 'custom_transform_id')
    readonly_fields = (
        'version', 'compiled_jsonata', 'validation_result',
        'published_at', 'published_by', 'created_at', 'display_map_type',
        'stedi_conversion_preview', 'stedi_conversion_notes',
    )
    actions = [compile_and_publish, convert_stedi_mapping]

    fieldsets = (
        ('Partner & Identity', {
            'fields': ('partner', 'transaction_set', 'direction', 'display_map_type', 'custom_transform_id'),
        }),
        ('Import from Stedi', {
            'classes': ('collapse',),
            'fields': ('stedi_mapping_json', 'stedi_conversion_notes', 'stedi_conversion_preview'),
        }),
        ('DSL Source', {
            'classes': ('collapse',),
            'fields': ('dsl_source',),
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

    @admin.display(description='Stedi', boolean=True)
    def has_stedi(self, obj):
        return bool(obj.stedi_mapping_json)

    def save_model(self, request, obj, form, change):
        # Auto-convert Stedi mapping on save if uploaded and no DSL yet
        if obj.stedi_mapping_json and not obj.stedi_conversion_preview:
            result = convert_stedi(obj.stedi_mapping_json)
            obj.stedi_conversion_preview = result.dsl
            obj.stedi_conversion_notes = result.notes
            if result.needs_custom_transform:
                obj.stedi_conversion_notes += '\n\n⚠ NEEDS CUSTOM TRANSFORM — human review required'
        super().save_model(request, obj, form, change)


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
    list_display = ('display_label', 'transaction_set', 'direction', 'trading_partner', 'is_validated', 'created_at')
    list_filter = ('transaction_set', 'direction', 'is_validated', 'trading_partner')
    search_fields = ('transaction_set', 'content_hash', 'example_label', 'auto_label')
    readonly_fields = ('auto_label', 'content_hash', 'jedi_output', 'system_json_output', 'created_at')
    actions = ['mark_validated', 'mark_unvalidated']

    fieldsets = (
        ('Classification', {
            'fields': (
                'trading_partner', 'transaction_set', 'direction',
                'example_label', 'auto_label',
                'is_validated', 'content_hash', 'created_at',
            ),
        }),
        ('Input: Raw EDI', {
            'fields': ('raw_edi',),
        }),
        ('Input: Target System JSON', {
            'fields': ('target_json',),
            'description': 'Paste the expected systemJson output (from Stedi target-document.json)',
        }),
        ('Auto-Parsed Outputs', {
            'classes': ('collapse',),
            'fields': ('jedi_output', 'system_json_output'),
        }),
        ('DSL Source (manual)', {
            'fields': ('dsl_source',),
            'classes': ('collapse',),
        }),
    )

    @admin.display(description='Label')
    def display_label(self, obj):
        return obj.auto_label or obj.example_label or obj.content_hash[:8]

    @admin.action(description='Mark selected as validated')
    def mark_validated(self, request, queryset):
        updated = queryset.update(is_validated=True)
        messages.success(request, f'{updated} example(s) marked as validated.')

    @admin.action(description='Mark selected as unvalidated')
    def mark_unvalidated(self, request, queryset):
        updated = queryset.update(is_validated=False)
        messages.success(request, f'{updated} example(s) marked as unvalidated.')
