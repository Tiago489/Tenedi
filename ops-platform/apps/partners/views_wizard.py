import hashlib
import json

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import redirect, render, get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views import View

from .models import TradingPartner
from .forms_wizard import (
    Step1IdentityForm, Step2SFTPForm, Step2AS2Form, Step2RESTForm,
    Step3DownstreamForm, Step4MappingForm, Step5ExampleForm,
)
from apps.maps.models import TransformMap, MappingExample


STEPS = [
    {'num': 1, 'label': 'Identity', 'icon': 'fa-id-card'},
    {'num': 2, 'label': 'Transport', 'icon': 'fa-plug'},
    {'num': 3, 'label': 'API', 'icon': 'fa-cloud'},
    {'num': 4, 'label': 'Mapping', 'icon': 'fa-exchange-alt'},
    {'num': 5, 'label': 'Examples', 'icon': 'fa-file-alt'},
    {'num': 6, 'label': 'Review', 'icon': 'fa-check-circle'},
]


def _ctx(request, step_num, partner=None, **extra):
    """Build common wizard context."""
    from django.contrib.admin import site as admin_site
    return {
        'steps': STEPS,
        'current_step': step_num,
        'partner': partner,
        'title': f'New Partner — Step {step_num} of 6',
        **admin_site.each_context(request),
        **extra,
    }


def _get_partner(request):
    """Load the in-progress partner from session."""
    pk = request.session.get('wizard_partner_id')
    if pk:
        try:
            return TradingPartner.objects.get(pk=pk)
        except TradingPartner.DoesNotExist:
            pass
    return None


@method_decorator(staff_member_required, name='dispatch')
class WizardStartView(View):
    """GET /admin/partners/wizard/ — redirect to step 1 or resume."""
    def get(self, request):
        partner = _get_partner(request)
        if partner:
            return redirect('wizard_step', step=1)
        request.session.pop('wizard_partner_id', None)
        return redirect('wizard_step', step=1)


@method_decorator(staff_member_required, name='dispatch')
class WizardStepView(View):
    """GET/POST /admin/partners/wizard/step/<N>/"""

    def get(self, request, step):
        step = int(step)
        partner = _get_partner(request)

        if step == 1:
            form = Step1IdentityForm(instance=partner)
            return render(request, 'admin/partners/wizard/step1_identity.html', _ctx(request, 1, partner, form=form))

        if not partner:
            messages.warning(request, 'Please complete Step 1 first.')
            return redirect('wizard_step', step=1)

        if step == 2:
            form = self._get_transport_form(partner)
            return render(request, 'admin/partners/wizard/step2_transport.html', _ctx(request, 2, partner, form=form))
        if step == 3:
            form = Step3DownstreamForm(instance=partner)
            return render(request, 'admin/partners/wizard/step3_api.html', _ctx(request, 3, partner, form=form))
        if step == 4:
            form = Step4MappingForm()
            maps = TransformMap.objects.filter(partner=partner)
            return render(request, 'admin/partners/wizard/step4_mapping.html', _ctx(request, 4, partner, form=form, maps=maps))
        if step == 5:
            form = Step5ExampleForm()
            examples = MappingExample.objects.filter(trading_partner=partner)
            return render(request, 'admin/partners/wizard/step5_examples.html', _ctx(request, 5, partner, form=form, examples=examples))
        if step == 6:
            maps = TransformMap.objects.filter(partner=partner)
            examples = MappingExample.objects.filter(trading_partner=partner)
            return render(request, 'admin/partners/wizard/step6_review.html', _ctx(request, 6, partner, maps=maps, examples=examples))

        return redirect('wizard_step', step=1)

    def post(self, request, step):
        step = int(step)
        partner = _get_partner(request)

        if step == 1:
            form = Step1IdentityForm(request.POST, instance=partner)
            if form.is_valid():
                p = form.save(commit=False)
                p.is_active = False  # don't activate until step 6
                p.save()
                request.session['wizard_partner_id'] = p.pk
                return redirect('wizard_step', step=2)
            return render(request, 'admin/partners/wizard/step1_identity.html', _ctx(request, 1, partner, form=form))

        if not partner:
            return redirect('wizard_step', step=1)

        if step == 2:
            form = self._get_transport_form(partner, request.POST)
            if form.is_valid():
                if hasattr(form, 'save'):
                    form.save()
                return redirect('wizard_step', step=3)
            return render(request, 'admin/partners/wizard/step2_transport.html', _ctx(request, 2, partner, form=form))

        if step == 3:
            form = Step3DownstreamForm(request.POST, instance=partner)
            if form.is_valid():
                form.save()
                return redirect('wizard_step', step=4)
            return render(request, 'admin/partners/wizard/step3_api.html', _ctx(request, 3, partner, form=form))

        if step == 4:
            form = Step4MappingForm(request.POST, request.FILES)
            if form.is_valid():
                mapping_file = request.FILES.get('mapping_file')
                if mapping_file:
                    content = mapping_file.read().decode('utf-8')
                    TransformMap.objects.update_or_create(
                        partner=partner,
                        transaction_set=form.cleaned_data['transaction_set'],
                        direction=form.cleaned_data['direction'],
                        defaults={
                            'stedi_mapping_json': content,
                            'is_live': True,
                        },
                    )
                    messages.success(request, 'Mapping uploaded successfully.')
            return redirect('wizard_step', step=5)

        if step == 5:
            # Process uploaded example files
            edi_file = request.FILES.get('edi_file')
            target_file = request.FILES.get('target_file')
            label = request.POST.get('example_label', '')

            if edi_file:
                raw_edi = edi_file.read().decode('utf-8')
                content_hash = hashlib.sha1(raw_edi.encode()).hexdigest()
                target_json = None
                if target_file:
                    try:
                        target_json = json.loads(target_file.read().decode('utf-8'))
                    except json.JSONDecodeError:
                        messages.error(request, 'Target JSON file is not valid JSON.')

                MappingExample.objects.update_or_create(
                    content_hash=content_hash,
                    defaults={
                        'trading_partner': partner,
                        'transaction_set': '204',
                        'direction': 'inbound',
                        'raw_edi': raw_edi,
                        'target_json': target_json,
                        'example_label': label,
                    },
                )
                messages.success(request, 'Example uploaded.')

            return redirect('wizard_step', step=6)

        if step == 6:
            # Activate
            partner.is_active = True
            partner.save(update_fields=['is_active'])
            request.session.pop('wizard_partner_id', None)
            messages.success(request, f'{partner.name} is now active and ready to receive files.')
            return redirect(reverse('admin:partners_tradingpartner_change', args=[partner.pk]))

        return redirect('wizard_step', step=1)

    def _get_transport_form(self, partner, data=None):
        if partner.transport == 'sftp':
            return Step2SFTPForm(data, instance=partner)
        elif partner.transport == 'as2':
            return Step2AS2Form(data, instance=partner)
        return Step2RESTForm(data)
