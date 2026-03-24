from django.test import TestCase
from services.standard_fields import (
    STANDARD_204_INBOUND_FIELDS,
    DATE_FIELDS,
    standard_dsl_block,
    standard_fields_prompt,
)


class TestStandard204InboundFields(TestCase):
    def test_all_10_standard_fields_defined(self):
        expected = {
            'senderId', 'receiverId', 'applicationSenderCode',
            'receiverSenderCode', 'usageIndicatorCode',
            'senderContactCode', 'standardCarrierAlphaCode',
            'transactionSetPurposeCode', 'paymentMethod',
            'pickupOrDelivery',
        }
        self.assertEqual(set(STANDARD_204_INBOUND_FIELDS.keys()), expected)

    def test_field_specs_have_valid_prefixes(self):
        for field, spec in STANDARD_204_INBOUND_FIELDS.items():
            valid = spec.startswith('MAP:') or spec.startswith('SET:') or spec.startswith('LOOKUP:')
            self.assertTrue(valid, f'{field} has invalid spec prefix: {spec}')


class TestStandardDslBlock(TestCase):
    def test_generates_dsl_for_204_inbound(self):
        block = standard_dsl_block('204', 'inbound')
        self.assertIn('$map envelope.isa.isa_element_06 to senderId', block)
        self.assertIn('$map envelope.isa.isa_element_08 to receiverId', block)
        self.assertIn('$set usageIndicatorCode = "P"', block)
        self.assertIn('$set pickupOrDelivery = "PICKUP_AND_DELIVERY"', block)
        self.assertIn('$lookup PURPOSE_CODES', block)
        self.assertIn('$lookup PAYMENT_CODES', block)

    def test_returns_empty_for_non_204(self):
        self.assertEqual(standard_dsl_block('211', 'inbound'), '')

    def test_returns_empty_for_outbound(self):
        self.assertEqual(standard_dsl_block('204', 'outbound'), '')

    def test_each_field_produces_one_directive_line(self):
        block = standard_dsl_block()
        directive_lines = [l for l in block.split('\n') if l.strip() and not l.startswith('#')]
        self.assertEqual(len(directive_lines), len(STANDARD_204_INBOUND_FIELDS))


class TestStandardFieldsPrompt(TestCase):
    def test_prompt_contains_all_field_names(self):
        prompt = standard_fields_prompt()
        for field in STANDARD_204_INBOUND_FIELDS:
            self.assertIn(field, prompt, f'Field {field} missing from prompt')

    def test_prompt_mentions_iso_date_format(self):
        prompt = standard_fields_prompt()
        self.assertIn('ISO 8601', prompt)
        self.assertIn('YYYY-MM-DD', prompt)


class TestDateFields(TestCase):
    def test_deadline_date_in_date_fields(self):
        self.assertIn('deadlineDate', DATE_FIELDS)
