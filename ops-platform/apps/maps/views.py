import json
import requests

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from django.conf import settings
from django.utils import timezone

from .models import TransformMap, ReferenceTable, MappingExample
from .serializers import TransformMapSerializer, ReferenceTableSerializer, MappingExampleSerializer
from services.dsl_ai import DSLGenerator
from services.engine_client import EngineClient
from services.stedi_converter import convert as convert_stedi

ENGINE_URL = getattr(settings, 'ENGINE_API_URL', 'http://engine:3000')


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
    """POST /api/maps/sync/ — upsert TransformMap records from engine registry."""
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
            partner_key = entry.get('partnerKey')

            if not tx_set or not direction:
                continue

            trading_partner = None
            if partner_key:
                trading_partner = TradingPartner.objects.filter(
                    partner_id__iexact=partner_key,
                ).first()

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


class ConvertStediView(APIView):
    """POST /api/maps/convert-stedi/ — convert Stedi mapping.json to DSL."""
    permission_classes = [AllowAny]

    def post(self, request):
        mapping_json = request.data.get('mapping_json', '')
        if not mapping_json:
            return Response({'error': 'mapping_json is required'}, status=400)

        if isinstance(mapping_json, dict):
            mapping_json = json.dumps(mapping_json)

        result = convert_stedi(mapping_json)
        return Response({
            'dsl': result.dsl,
            'notes': result.notes,
            'needs_custom_transform': result.needs_custom_transform,
            'lookup_tables': result.lookup_tables,
            'fields_mapped': result.fields_mapped,
            'fields_expr': result.fields_expr,
            'fields_custom': result.fields_custom,
        })


class ValidateExampleView(APIView):
    """POST /api/maps/validate-example/ — validate an EDI example against a transform."""
    permission_classes = [AllowAny]

    def post(self, request):
        raw_edi = request.data.get('raw_edi', '')
        target_json = request.data.get('target_json')
        partner_id = request.data.get('partner_id', '')
        transaction_set = request.data.get('transaction_set', '')
        direction = request.data.get('direction', 'inbound')

        if not raw_edi or target_json is None:
            return Response({'error': 'raw_edi and target_json are required'}, status=400)

        # Parse EDI via engine
        try:
            parse_resp = requests.post(
                f'{ENGINE_URL}/edi/inbound',
                data=raw_edi.encode('utf-8'),
                headers={'Content-Type': 'text/plain', 'X-Dry-Run': 'true'},
                timeout=10,
            )
        except Exception as exc:
            return Response({'error': f'Engine unreachable: {exc}'}, status=502)

        # Compare target with actual output
        if isinstance(target_json, str):
            try:
                target_json = json.loads(target_json)
            except json.JSONDecodeError:
                return Response({'error': 'target_json is not valid JSON'}, status=400)

        # For now, return the target as-is since the full transform comparison
        # requires the engine to run the partner-specific transform pipeline.
        # TODO: Add engine endpoint for dry-run transform
        return Response({
            'match': False,
            'note': 'Full transform comparison requires engine dry-run endpoint (not yet implemented)',
            'target_json': target_json,
        })


class GenerateWithAIView(APIView):
    """POST /api/maps/generate-with-ai/ — AI-assisted map generation from Stedi mapping + examples."""
    permission_classes = [AllowAny]

    def post(self, request):
        partner_id = request.data.get('partner_id', '')
        transaction_set = request.data.get('transaction_set', '')
        stedi_mapping = request.data.get('stedi_mapping', '')

        if not transaction_set:
            return Response({'error': 'transaction_set is required'}, status=400)

        # Gather validated examples for this partner + tx_set
        examples = MappingExample.objects.filter(
            is_validated=True,
            transaction_set=transaction_set,
        )
        if partner_id:
            from apps.partners.models import TradingPartner
            partner = TradingPartner.objects.filter(partner_id__iexact=partner_id).first()
            if partner:
                examples = examples.filter(trading_partner=partner)

        example_pairs = []
        for ex in examples[:3]:
            example_pairs.append({
                'jedi': ex.jedi_output,
                'system_json': ex.target_json or ex.system_json_output,
            })

        api_key = getattr(settings, 'ANTHROPIC_API_KEY', '')
        if not api_key:
            return Response({'error': 'ANTHROPIC_API_KEY not configured'}, status=500)

        prompt = _build_ai_prompt(stedi_mapping, example_pairs, transaction_set)

        try:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            message = client.messages.create(
                model='claude-sonnet-4-20250514',
                max_tokens=2000,
                messages=[{'role': 'user', 'content': prompt}],
            )
            dsl = message.content[0].text if message.content else ''
            return Response({
                'dsl': dsl,
                'examples_used': len(example_pairs),
                'has_stedi_context': bool(stedi_mapping),
            })
        except Exception as exc:
            return Response({'error': f'AI generation failed: {exc}'}, status=500)


def _build_ai_prompt(stedi_mapping: str, examples: list, tx_set: str) -> str:
    prompt = (
        f'You are an EDI mapping expert. Generate DSL field mappings for '
        f'transaction set {tx_set}.\n\n'
    )

    if stedi_mapping:
        prompt += f'## Stedi Mapping Reference\n```json\n{stedi_mapping[:5000]}\n```\n\n'

    if examples:
        prompt += '## Validated Examples\n'
        for i, ex in enumerate(examples, 1):
            prompt += f'\n### Example {i}\nInput JEDI:\n```json\n{json.dumps(ex["jedi"], indent=2)[:2000]}\n```\n'
            prompt += f'Target Output:\n```json\n{json.dumps(ex["system_json"], indent=2)[:2000]}\n```\n'

    prompt += (
        '\n## Instructions\n'
        'Generate DSL that maps the JEDI input to the target system JSON output. '
        'Use $map, $set, $lookup, and $expr directives. '
        'Return only the DSL code, no explanation.\n'
    )

    return prompt
