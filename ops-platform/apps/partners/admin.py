from django.contrib import admin
from .models import TradingPartner


@admin.register(TradingPartner)
class TradingPartnerAdmin(admin.ModelAdmin):
    list_display = ('name', 'partner_id', 'transport', 'is_active', 'created_at')
    list_filter = ('transport', 'is_active')
    search_fields = ('name', 'partner_id', 'as2_id')
    readonly_fields = ('created_at', 'updated_at')

    fieldsets = (
        ('General', {
            'fields': ('name', 'partner_id', 'isa_qualifier', 'transport', 'is_active'),
        }),
        ('SFTP Config', {
            'classes': ('collapse',),
            'fields': ('sftp_host', 'sftp_user', 'sftp_password', 'sftp_inbound_dir', 'sftp_outbound_dir'),
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
