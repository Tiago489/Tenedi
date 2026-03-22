import json
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from .models import TradingPartner


def partner_to_dict(partner: TradingPartner) -> dict:
    return {
        'id': partner.pk,
        'name': partner.name,
        'partner_id': partner.partner_id,
        'isa_qualifier': partner.isa_qualifier,
        'transport': partner.transport,
        'sftp_host': partner.sftp_host,
        'sftp_port': partner.sftp_port,
        'sftp_user': partner.sftp_user,
        'sftp_password': partner.sftp_password,
        'sftp_inbound_dir': partner.sftp_inbound_dir,
        'sftp_outbound_dir': partner.sftp_outbound_dir,
        'as2_id': partner.as2_id,
        'as2_url': partner.as2_url,
        'as2_cert': partner.as2_cert,
        'downstream_api_url': partner.downstream_api_url,
        'downstream_api_key': partner.downstream_api_key,
        'is_active': partner.is_active,
    }


@method_decorator(csrf_exempt, name='dispatch')
class PartnerDetailView(View):
    """GET /api/partners/<partner_id>/ — look up by ISA partner_id string."""

    def get(self, request, partner_id: str):
        try:
            partner = TradingPartner.objects.get(partner_id=partner_id, is_active=True)
        except TradingPartner.DoesNotExist:
            return JsonResponse({'error': 'Partner not found'}, status=404)
        return JsonResponse(partner_to_dict(partner))


@method_decorator(csrf_exempt, name='dispatch')
class PartnerListView(View):
    """GET /api/partners/ — list all active partners."""

    def get(self, request):
        qs = TradingPartner.objects.filter(is_active=True)
        transport = request.GET.get('transport')
        if transport:
            qs = qs.filter(transport=transport)
        return JsonResponse({'partners': [partner_to_dict(p) for p in qs.order_by('name')]})
