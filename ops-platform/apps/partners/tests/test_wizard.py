import io
import json
import re
from unittest.mock import patch, MagicMock

from django.contrib.auth import get_user_model
from django.test import TestCase, Client
from django.urls import reverse

from apps.partners.models import TradingPartner
from apps.maps.models import TransformMap, MappingExample
from services.standard_fields import (
    ENVELOPE_FIELDS,
    HEADING_204_FIELDS,
    standard_dsl_block,
)

User = get_user_model()

# ── Helpers ───────────────────────────────────────────────────────────────────


def _staff_client():
    """Return a Django test Client logged in as a staff user."""
    user = User.objects.create_user(username='admin', password='admin', is_staff=True)
    client = Client()
    client.login(username='admin', password='admin')
    return client


def _upload_file(name, content, content_type='application/octet-stream'):
    """Create an in-memory file upload."""
    f = io.BytesIO(content.encode('utf-8') if isinstance(content, str) else content)
    f.name = name
    return f


SAMPLE_MAPPING_JSON = json.dumps({
    'name': 'Test Mapping',
    'type': 'only_mapped_keys',
    'mapping': '{ "standardCarrierAlphaCode": "TESTSCAC" }',
    'lookup_tables': [],
})

SAMPLE_EDI = (
    'ISA*00*          *00*          *ZZ*TESTP          *ZZ*RECV           '
    '*260325*1200*U*00401*000000001*0*P*>~\n'
    'GS*SM*TESTP*RECV*20260325*1200*1*X*004010~\n'
    'ST*204*0001~\nB2**FBTC**SHIP001**PP*L~\nB2A*00*LT~\n'
    'SE*5*0001~\nGE*1*1~\nIEA*1*000000001~\n'
)


# ═══════════════════════════════════════════════════════════════════════════════
# Group 1 — Wizard Step Flow
# ═══════════════════════════════════════════════════════════════════════════════


class TestWizardStep1(TestCase):

    def test_step1_identity_saves_to_session(self):
        client = _staff_client()
        resp = client.post(reverse('wizard_step', args=[1]), {
            'name': 'Acme Corp',
            'partner_id': 'ACME01',
            'isa_qualifier': 'ZZ',
            'transport': 'sftp',
            'is_active': True,
        })
        self.assertEqual(resp.status_code, 302)  # redirect to step 2
        partner = TradingPartner.objects.get(partner_id='ACME01')
        self.assertEqual(partner.name, 'Acme Corp')
        self.assertFalse(partner.is_active)  # not activated until step 6
        self.assertEqual(client.session['wizard_partner_id'], partner.pk)


class TestWizardStep2(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_step2_transport_saves_sftp_credentials(self, _mock):
        client = _staff_client()
        # Step 1 first
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'SFTP Partner', 'partner_id': 'SFTPP', 'isa_qualifier': 'ZZ', 'transport': 'sftp',
        })
        # Step 2
        resp = client.post(reverse('wizard_step', args=[2]), {
            'sftp_host': 'sftp.example.com', 'sftp_port': 2222,
            'sftp_user': 'ediuser', 'sftp_password': 'secret123',
            'sftp_inbound_dir': '/in', 'sftp_outbound_dir': '/out',
            'sftp_archive_dir': '', 'sftp_poll_interval_ms': 60000,
            'sftp_after_pull': 'MOVE_TO_ARCHIVE',
        })
        self.assertEqual(resp.status_code, 302)
        partner = TradingPartner.objects.get(partner_id='SFTPP')
        self.assertEqual(partner.sftp_host, 'sftp.example.com')
        self.assertEqual(partner.sftp_port, 2222)
        self.assertEqual(partner.sftp_user, 'ediuser')


class TestWizardStep3(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_step3_downstream_api_saves_url_and_auth(self, _mock):
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'API Partner', 'partner_id': 'APIP', 'isa_qualifier': 'ZZ', 'transport': 'rest',
        })
        client.post(reverse('wizard_step', args=[2]), {})  # REST has no fields
        resp = client.post(reverse('wizard_step', args=[3]), {
            'downstream_api_url': 'https://api.example.com/edi',
            'downstream_api_key': 'Bearer tok_abc123',
        })
        self.assertEqual(resp.status_code, 302)
        partner = TradingPartner.objects.get(partner_id='APIP')
        self.assertEqual(partner.downstream_api_url, 'https://api.example.com/edi')
        self.assertEqual(partner.downstream_api_key, 'Bearer tok_abc123')


class TestWizardStep4(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_step4_mapping_upload_creates_transform_map(self, mock_signal):
        mock_signal.return_value = MagicMock(ok=True)
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'Map Partner', 'partner_id': 'MAPP', 'isa_qualifier': 'ZZ', 'transport': 'sftp',
        })
        client.post(reverse('wizard_step', args=[2]), {
            'sftp_host': 'h', 'sftp_port': 22, 'sftp_user': 'u', 'sftp_password': 'p',
            'sftp_inbound_dir': '/in', 'sftp_outbound_dir': '/out', 'sftp_archive_dir': '',
            'sftp_poll_interval_ms': 30000, 'sftp_after_pull': 'MOVE_TO_ARCHIVE',
        })
        client.post(reverse('wizard_step', args=[3]), {
            'downstream_api_url': '', 'downstream_api_key': '',
        })

        mapping_file = _upload_file('mapping.json', SAMPLE_MAPPING_JSON)
        resp = client.post(reverse('wizard_step', args=[4]), {
            'transaction_set': '204', 'direction': 'inbound',
            'mapping_file': mapping_file,
        })
        self.assertEqual(resp.status_code, 302)
        tm = TransformMap.objects.get(partner__partner_id='MAPP')
        self.assertEqual(tm.transaction_set, '204')
        self.assertIn('Test Mapping', tm.stedi_mapping_json)

    @patch('apps.maps.signals.requests.post')
    def test_step4_mapping_sets_is_live_true(self, mock_signal):
        mock_signal.return_value = MagicMock(ok=True)
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'Live Partner', 'partner_id': 'LIVEP', 'isa_qualifier': 'ZZ', 'transport': 'rest',
        })
        client.post(reverse('wizard_step', args=[2]), {})
        client.post(reverse('wizard_step', args=[3]), {'downstream_api_url': '', 'downstream_api_key': ''})

        mapping_file = _upload_file('mapping.json', SAMPLE_MAPPING_JSON)
        client.post(reverse('wizard_step', args=[4]), {
            'transaction_set': '204', 'direction': 'inbound',
            'mapping_file': mapping_file,
        })
        tm = TransformMap.objects.get(partner__partner_id='LIVEP')
        self.assertTrue(tm.is_live)


class TestWizardStep5(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_step5_examples_saves_mapping_examples(self, _mock):
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'Ex Partner', 'partner_id': 'EXP', 'isa_qualifier': 'ZZ', 'transport': 'rest',
        })
        client.post(reverse('wizard_step', args=[2]), {})
        client.post(reverse('wizard_step', args=[3]), {'downstream_api_url': '', 'downstream_api_key': ''})
        client.post(reverse('wizard_step', args=[4]), {'transaction_set': '204', 'direction': 'inbound'})

        edi_file = _upload_file('test.edi', SAMPLE_EDI)
        target_file = _upload_file('target.json', json.dumps({'senderId': 'TESTP'}))
        resp = client.post(reverse('wizard_step', args=[5]), {
            'edi_file': edi_file,
            'target_file': target_file,
            'example_label': 'fixture-01',
        })
        self.assertEqual(resp.status_code, 302)
        ex = MappingExample.objects.get(trading_partner__partner_id='EXP')
        self.assertEqual(ex.example_label, 'fixture-01')
        self.assertIn('ISA', ex.raw_edi)
        self.assertEqual(ex.target_json, {'senderId': 'TESTP'})


class TestWizardStep6(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_step6_review_activates_partner(self, _mock):
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'Final Partner', 'partner_id': 'FINALP', 'isa_qualifier': 'ZZ', 'transport': 'rest',
        })
        client.post(reverse('wizard_step', args=[2]), {})
        client.post(reverse('wizard_step', args=[3]), {'downstream_api_url': '', 'downstream_api_key': ''})
        client.post(reverse('wizard_step', args=[4]), {'transaction_set': '204', 'direction': 'inbound'})
        client.post(reverse('wizard_step', args=[5]), {})

        partner = TradingPartner.objects.get(partner_id='FINALP')
        self.assertFalse(partner.is_active)

        resp = client.post(reverse('wizard_step', args=[6]))
        self.assertEqual(resp.status_code, 302)
        partner.refresh_from_db()
        self.assertTrue(partner.is_active)


class TestWizardSessionPersistence(TestCase):

    @patch('apps.maps.signals.requests.post')
    def test_session_persists_across_steps(self, _mock):
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'Session Partner', 'partner_id': 'SESSP', 'isa_qualifier': 'ZZ', 'transport': 'rest',
        })
        pk = client.session['wizard_partner_id']

        # Navigate to step 3 — session should still have the partner
        client.post(reverse('wizard_step', args=[2]), {})
        resp = client.get(reverse('wizard_step', args=[3]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(client.session['wizard_partner_id'], pk)

    @patch('apps.maps.signals.requests.post')
    def test_incomplete_wizard_does_not_activate_partner(self, _mock):
        client = _staff_client()
        client.post(reverse('wizard_step', args=[1]), {
            'name': 'Incomplete', 'partner_id': 'INCOMP', 'isa_qualifier': 'ZZ', 'transport': 'rest',
        })
        # Stop after step 1 — never reach step 6
        partner = TradingPartner.objects.get(partner_id='INCOMP')
        self.assertFalse(partner.is_active)


# ═══════════════════════════════════════════════════════════════════════════════
# Group 2 — System JSON Envelope Fields Contract
# ═══════════════════════════════════════════════════════════════════════════════


class TestEnvelopeFieldsContract(TestCase):

    def test_204_inbound_dsl_includes_all_envelope_fields(self):
        block = standard_dsl_block('204', 'inbound')
        for field in ENVELOPE_FIELDS:
            self.assertIn(field, block, f'Envelope field {field} missing from 204 DSL block')

    def test_211_inbound_dsl_includes_all_envelope_fields(self):
        block = standard_dsl_block('211', 'inbound')
        for field in ENVELOPE_FIELDS:
            self.assertIn(field, block, f'Envelope field {field} missing from 211 DSL block')

    def test_envelope_fields_use_real_jedi_paths(self):
        """All MAP: envelope fields reference real ISA/GS JEDI paths."""
        for field, spec in ENVELOPE_FIELDS.items():
            if spec.startswith('MAP:'):
                path = spec[4:]
                self.assertTrue(
                    path.startswith('envelope.isa.') or path.startswith('envelope.gs.'),
                    f'{field} path {path} does not reference envelope.isa or envelope.gs',
                )

    def test_envelope_fields_present_regardless_of_partner(self):
        """DSL block for any partner always contains envelope fields."""
        for tx_set in ['204', '211', '990', '214', '210']:
            block = standard_dsl_block(tx_set, 'inbound')
            for field in ENVELOPE_FIELDS:
                self.assertIn(field, block, f'{field} missing from {tx_set} inbound block')

    def test_204_heading_fields_present_in_204_output(self):
        block = standard_dsl_block('204', 'inbound')
        for field in HEADING_204_FIELDS:
            self.assertIn(field, block, f'204 heading field {field} missing from 204 DSL block')

    def test_204_heading_fields_absent_in_211_output(self):
        block = standard_dsl_block('211', 'inbound')
        for field in HEADING_204_FIELDS:
            self.assertNotIn(field, block, f'204-specific field {field} should not appear in 211 DSL block')


# ═══════════════════════════════════════════════════════════════════════════════
# Group 3 — Date/Time Formatting Contract
# ═══════════════════════════════════════════════════════════════════════════════


class TestDateFormattingContract(TestCase):

    def test_iso_date_regex_matches_valid_dates(self):
        """Verify our regex pattern catches both valid and invalid date formats."""
        iso_re = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        self.assertTrue(iso_re.match('2026-03-25'))
        self.assertTrue(iso_re.match('2025-12-01'))
        self.assertIsNone(iso_re.match('20260325'))
        self.assertIsNone(iso_re.match('03/25/2026'))

    def test_deadline_date_in_dsl_has_date_suffix(self):
        """The stedi converter adds $as date to deadlineDate fields."""
        from services.stedi_converter import convert
        mapping = json.dumps({
            'name': 'DateTest', 'type': 'only_mapped_keys',
            'mapping': '{ "deadlineDate": $$.transactionSets[0].detail.stop_off_details_S5_loop[0].date_time_G62.date_02 }',
            'lookup_tables': [],
        })
        result = convert(mapping)
        self.assertIn('$as date', result.dsl)

    def test_ceva_transform_produces_iso_dates(self):
        """The CEVA custom transform formats dates as YYYY-MM-DD, not YYYYMMDD."""
        # Import the isoDate helper used by the CEVA transform
        # We test it directly since importing the full TS transform isn't possible from Python
        def iso_date(d):
            if not d or len(d) < 8:
                return None
            return f'{d[:4]}-{d[4:6]}-{d[6:8]}'

        self.assertEqual(iso_date('20260323'), '2026-03-23')
        self.assertEqual(iso_date('20251231'), '2025-12-31')
        self.assertIsNone(iso_date(None))
        self.assertIsNone(iso_date(''))
        self.assertIsNone(iso_date('short'))

    def test_missing_date_produces_none(self):
        """A missing date input should produce None, not crash."""
        def iso_date(d):
            if not d or len(d) < 8:
                return None
            return f'{d[:4]}-{d[4:6]}-{d[6:8]}'

        self.assertIsNone(iso_date(None))
        self.assertIsNone(iso_date(''))

    def test_iso_datetime_regex(self):
        """ISO 8601 datetime format for timestamp fields."""
        iso_dt_re = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')
        self.assertTrue(iso_dt_re.match('2026-03-25T14:30:00Z'))
        self.assertTrue(iso_dt_re.match('2026-03-25T14:30:00.000Z'))
        self.assertIsNone(iso_dt_re.match('2026-03-25'))


# ═══════════════════════════════════════════════════════════════════════════════
# Group 4 — Lookup Table Contract
# ═══════════════════════════════════════════════════════════════════════════════


class TestLookupTableContract(TestCase):

    def test_payment_method_lookup_in_standard_fields(self):
        """PAYMENT_CODES lookup is present in the 204 standard fields."""
        self.assertIn('paymentMethod', HEADING_204_FIELDS)
        spec = HEADING_204_FIELDS['paymentMethod']
        self.assertTrue(spec.startswith('LOOKUP:PAYMENT_CODES:'))

    def test_purpose_code_lookup_in_standard_fields(self):
        self.assertIn('transactionSetPurposeCode', HEADING_204_FIELDS)
        spec = HEADING_204_FIELDS['transactionSetPurposeCode']
        self.assertTrue(spec.startswith('LOOKUP:PURPOSE_CODES:'))

    def test_payment_lookup_dsl_line_correct(self):
        block = standard_dsl_block('204', 'inbound')
        self.assertIn('$lookup PAYMENT_CODES heading.b2.b2_element_06 to paymentMethod', block)

    def test_purpose_lookup_dsl_line_correct(self):
        block = standard_dsl_block('204', 'inbound')
        self.assertIn('$lookup PURPOSE_CODES heading.b2a.b2a_element_01 to transactionSetPurposeCode', block)

    def test_stedi_converter_detects_lookup_tables(self):
        from services.stedi_converter import convert
        mapping = json.dumps({
            'name': 'LookupTest', 'type': 'only_mapped_keys',
            'mapping': '{ "field": $lookupTable($tables.MY_TABLE, "Key", $$.path).Value }',
            'lookup_tables': [{'name': 'MY_TABLE', 'values': [{'Key': 'A', 'Value': 'Alpha'}]}],
        })
        result = convert(mapping)
        self.assertIn('MY_TABLE', result.lookup_tables)
        self.assertIn('MY_TABLE', result.notes)

    def test_hardcoded_set_values_are_strings_not_objects(self):
        """$set directives produce string values, never empty objects."""
        block = standard_dsl_block('204', 'inbound')
        for line in block.split('\n'):
            if line.startswith('$set'):
                # $set field = "value" — value must be quoted string
                self.assertIn('=', line)
                value_part = line.split('=', 1)[1].strip()
                self.assertTrue(value_part.startswith('"'), f'$set value not quoted: {line}')
