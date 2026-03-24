from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from django.utils import timezone
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


class MapSyncView(APIView):
    """
    POST /api/maps/sync/ — upsert TransformMap records from engine registry.
    Called automatically by the engine on startup so Django Admin stays in sync.
    Body: array of registry entries from engine's mapRegistry.registryDump().
    """
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.partners.models import TradingPartner

        entries = request.data
        if not isinstance(entries, list):
            return Response({'error': 'expected array of registry entries'}, status=400)

        created = 0
        updated = 0

        for entry in entries:
            tx_set = entry.get('transactionSet', '')
            direction = entry.get('direction', '')
            partner_key = entry.get('partnerKey')  # e.g. "cevapd" or null
            engine_id = entry.get('id', '')

            if not tx_set or not direction:
                continue

            # Resolve partner FK from partner_key
            trading_partner = None
            if partner_key:
                trading_partner = TradingPartner.objects.filter(
                    partner_id__iexact=partner_key,
                ).first()

            # Upsert by (transaction_set, direction, partner)
            obj, was_created = TransformMap.objects.update_or_create(
                transaction_set=tx_set,
                direction=direction,
                partner=trading_partner,
                defaults={
                    'version': entry.get('version', 1),
                    'custom_transform_id': entry.get('customTransformId') or '',
                    'dsl_source': entry.get('dslSource') or '',
                    'is_live': True,
                    'published_at': timezone.now(),
                },
            )

            if was_created:
                created += 1
            else:
                updated += 1

        return Response({
            'synced': created + updated,
            'created': created,
            'updated': updated,
        })
