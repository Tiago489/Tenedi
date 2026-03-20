from rest_framework import serializers
from .models import TransformMap, ReferenceTable, DSLKeywordRequest


class TransformMapSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransformMap
        fields = '__all__'
        read_only_fields = (
            'version', 'compiled_jsonata', 'validation_result',
            'published_at', 'published_by', 'created_at',
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
