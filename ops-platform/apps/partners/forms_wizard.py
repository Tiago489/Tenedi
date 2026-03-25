from django import forms
from .models import TradingPartner

ISA_QUALIFIER_CHOICES = [
    ('ZZ', 'ZZ — Mutually Defined'),
    ('02', '02 — DUNS'),
    ('01', '01 — DUNS +4'),
    ('08', '08 — UCC Comm ID'),
    ('14', '14 — DUNS +suffix'),
    ('20', '20 — HIN'),
    ('27', '27 — Carrier SCAC'),
    ('28', '28 — Fiscal Code'),
    ('29', '29 — Medicare'),
    ('30', '30 — Tax ID'),
    ('33', '33 — Commercial'),
]


class Step1IdentityForm(forms.ModelForm):
    isa_qualifier = forms.ChoiceField(choices=ISA_QUALIFIER_CHOICES, initial='ZZ')

    class Meta:
        model = TradingPartner
        fields = ['name', 'partner_id', 'isa_qualifier', 'transport', 'is_active']
        widgets = {
            'transport': forms.RadioSelect(choices=TradingPartner.TRANSPORT_CHOICES),
        }


class Step2SFTPForm(forms.ModelForm):
    class Meta:
        model = TradingPartner
        fields = [
            'sftp_host', 'sftp_port', 'sftp_user', 'sftp_password',
            'sftp_inbound_dir', 'sftp_outbound_dir', 'sftp_archive_dir',
            'sftp_poll_interval_ms', 'sftp_after_pull',
        ]
        widgets = {
            'sftp_password': forms.PasswordInput(render_value=True),
        }


class Step2AS2Form(forms.ModelForm):
    class Meta:
        model = TradingPartner
        fields = ['as2_id', 'as2_url', 'as2_cert']
        widgets = {
            'as2_cert': forms.Textarea(attrs={'rows': 6}),
        }


class Step2RESTForm(forms.Form):
    """REST partners push files to the engine — no config needed."""
    pass


class Step3DownstreamForm(forms.ModelForm):
    class Meta:
        model = TradingPartner
        fields = ['downstream_api_url', 'downstream_api_key']
        labels = {
            'downstream_api_url': 'Downstream API URL',
            'downstream_api_key': 'API Key / Bearer Token',
        }


class Step4MappingForm(forms.Form):
    transaction_set = forms.ChoiceField(choices=[
        ('204', '204 — Motor Carrier Load Tender'),
        ('211', '211 — Bill of Lading'),
        ('990', '990 — Response to Load Tender'),
        ('214', '214 — Shipment Status'),
        ('210', '210 — Freight Invoice'),
    ])
    direction = forms.ChoiceField(
        choices=[('inbound', 'Inbound'), ('outbound', 'Outbound')],
        widget=forms.RadioSelect,
        initial='inbound',
    )
    mapping_file = forms.FileField(
        required=False,
        label='Stedi mapping.json file',
        help_text='Upload the Stedi mapping.json export for this transaction set.',
    )


class Step5ExampleForm(forms.Form):
    edi_file = forms.FileField(required=False, label='EDI file (.edi)')
    target_file = forms.FileField(required=False, label='Target JSON (.json)')
    example_label = forms.CharField(required=False, max_length=100, label='Label (optional)')
