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

    transaction_set = models.CharField(max_length=10)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)
    version = models.PositiveIntegerField(default=1)
    dsl_source = models.TextField()           # source of truth — human/AI edits this
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
        return f'{self.transaction_set} {self.direction} v{self.version}'


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
