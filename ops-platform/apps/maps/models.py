from django.db import models
from django.conf import settings


class ReferenceTable(models.Model):
    name = models.CharField(max_length=100, unique=True)  # e.g. "ServiceTypeTable"
    description = models.TextField(blank=True)
    data = models.JSONField(default=dict)  # {"TL": "Truckload", "LTL": "Less Than Truckload"}
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'maps_reference_table'

    def __str__(self) -> str:
        return self.name


class JediSampleFixture(models.Model):
    transaction_set = models.CharField(max_length=10)  # "204", "210", etc.
    description = models.CharField(max_length=255)
    sample_jedi = models.JSONField()
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = 'maps_jedi_sample_fixture'

    def __str__(self) -> str:
        return f'{self.transaction_set} — {self.description}'


class TransformMap(models.Model):
    DIRECTION_CHOICES = [('inbound', 'Inbound'), ('outbound', 'Outbound')]

    partner = models.ForeignKey(
        'partners.TradingPartner',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='transform_maps',
    )
    transaction_set = models.CharField(max_length=10)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)
    version = models.PositiveIntegerField(default=1)
    dsl_source = models.TextField(blank=True)  # source of truth — human/AI edits this
    custom_transform_id = models.CharField(
        max_length=100, blank=True,
        help_text='Engine-side custom transform ID (e.g. "cevapd-204"). When set, the engine uses a coded transform instead of DSL.',
    )
    compiled_jsonata = models.TextField(blank=True)
    validation_result = models.JSONField(null=True, blank=True)
    is_live = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='published_maps',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'maps_transform_map'

    def __str__(self) -> str:
        label = self.partner.partner_id if self.partner else 'default'
        return f'{label} — {self.transaction_set} {self.direction} v{self.version}'

    @property
    def map_type(self) -> str:
        if self.custom_transform_id:
            return f'Custom Transform: {self.custom_transform_id}'
        return 'DSL Map'


class DSLKeywordRequest(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
    ]
    intent = models.TextField()
    description = models.TextField()
    transaction_set = models.CharField(max_length=10)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'maps_dsl_keyword_request'

    def __str__(self) -> str:
        return f'KeywordRequest({self.transaction_set}, {self.status})'


class DSLExample(models.Model):
    """Few-shot examples used to guide AI DSL generation."""
    transaction_set = models.CharField(max_length=10)
    intent = models.TextField()
    dsl_source = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'maps_dsl_example'

    def __str__(self) -> str:
        return f'DSLExample({self.transaction_set})'


class MappingExample(models.Model):
    """
    A real production EDI file processed through the pipeline.
    Each record stores the raw EDI, the JEDI parse output, the system JSON
    output, and (once reviewed) the DSL that produced that output.
    Validated records are used as RAG few-shot context when the AI generates DSL.
    """
    DIRECTION_CHOICES = [('inbound', 'Inbound'), ('outbound', 'Outbound')]

    transaction_set = models.CharField(max_length=10)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES, default='inbound')
    trading_partner = models.ForeignKey(
        'partners.TradingPartner',
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name='mapping_examples',
    )
    raw_edi = models.TextField()
    jedi_output = models.JSONField()
    system_json_output = models.JSONField()
    dsl_source = models.TextField(blank=True)  # filled in after human review
    content_hash = models.CharField(max_length=64, unique=True)  # SHA1 of raw_edi, for dedup
    is_validated = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'maps_mapping_example'
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'MappingExample({self.transaction_set}, {self.content_hash[:8]})'
