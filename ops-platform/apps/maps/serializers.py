from rest_framework import serializers
from .models import TransformMap, ReferenceTable, DSLKeywordRequest, MappingExample


class TransformMapSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransformMap
        fields = '__all__'
        read_only_fields = (
            'version', 'compiled_jsonata', 'validation_result',
            'published_at', 'published_by', 'created_at',
            'stedi_conversion_preview', 'stedi_conversion_notes',
        )


class ReferenceTableSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReferenceTable
        fields = '__all__'


class DSLKeywordRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = DSLKeywordRequest
        fields = '__all__'
        read_only_fields = ('created_at',)


class MappingExampleSerializer(serializers.ModelSerializer):
    class Meta:
        model = MappingExample
        fields = [
            'id', 'transaction_set', 'direction', 'trading_partner',
            'example_label', 'auto_label',
            'raw_edi', 'target_json', 'jedi_output', 'system_json_output',
            'dsl_source', 'content_hash', 'is_validated', 'created_at',
        ]
        read_only_fields = ('id', 'auto_label', 'created_at')
