from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from .models import TransformMap, ReferenceTable, MappingExample
from .serializers import TransformMapSerializer, ReferenceTableSerializer, MappingExampleSerializer
from services.dsl_ai import DSLGenerator
from services.engine_client import EngineClient


class TransformMapViewSet(viewsets.ModelViewSet):
    queryset = TransformMap.objects.all().order_by('-created_at')
    serializer_class = TransformMapSerializer

    @action(detail=False, methods=['post'], url_path='generate-dsl')
    def generate_dsl(self, request):
        """AI-assisted DSL generation endpoint."""
        intent = request.data.get('intent', '')
        transaction_set = request.data.get('transaction_set', '')

        if not intent or not transaction_set:
            return Response({'error': 'intent and transaction_set are required'}, status=400)

        generator = DSLGenerator()
        result = generator.generate(intent=intent, transaction_set=transaction_set)
        return Response(result)

    @action(detail=True, methods=['post'], url_path='publish')
    def publish(self, request, pk=None):
        """Compile and publish a map to the engine."""
        transform_map = self.get_object()
        client = EngineClient()

        try:
            compile_result = client.compile_dsl(
                dsl=transform_map.dsl_source,
                transaction_set=transform_map.transaction_set,
            )
            return Response(compile_result)
        except Exception as exc:
            return Response({'error': str(exc)}, status=500)


class ReferenceTableViewSet(viewsets.ModelViewSet):
    queryset = ReferenceTable.objects.all()
    serializer_class = ReferenceTableSerializer


class MappingExampleView(APIView):
    """
    POST /api/maps/mapping-examples/  — ingest a new example (called by import script).
    GET  /api/maps/mapping-examples/?tx_set=204 — list validated examples for DSL generation.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        # Check for existing record before running the serializer so that DRF's
        # unique-field validator doesn't reject duplicates as a 400 error.
        content_hash = request.data.get('content_hash', '')
        existing = MappingExample.objects.filter(content_hash=content_hash).first()
        if existing:
            return Response(MappingExampleSerializer(existing).data, status=status.HTTP_200_OK)

        serializer = MappingExampleSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        obj = serializer.save()
        return Response(MappingExampleSerializer(obj).data, status=status.HTTP_201_CREATED)

    def get(self, request):
        tx_set = request.query_params.get('tx_set')
        qs = MappingExample.objects.filter(is_validated=True)
        if tx_set:
            qs = qs.filter(transaction_set=tx_set)
        return Response(MappingExampleSerializer(qs[:20], many=True).data)
