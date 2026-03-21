from rest_framework import serializers
from .models import JobRecord


class JobRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobRecord
        fields = [
            'job_id', 'queue', 'source', 'transaction_set',
            'status', 'payload_preview', 'received_at', 'processed_at',
        ]
