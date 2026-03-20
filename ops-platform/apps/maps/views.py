from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import TransformMap, ReferenceTable
from .serializers import TransformMapSerializer, ReferenceTableSerializer
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
