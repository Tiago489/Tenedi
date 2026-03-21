from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework import status
from .models import JobRecord
from .serializers import JobRecordSerializer


class JobRecordCreateView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = JobRecordSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        job_id = serializer.validated_data['job_id']
        defaults = {k: v for k, v in serializer.validated_data.items() if k != 'job_id'}
        JobRecord.objects.update_or_create(job_id=job_id, defaults=defaults)
        return Response({'status': 'ok'}, status=status.HTTP_201_CREATED)
