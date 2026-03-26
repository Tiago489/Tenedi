import json
import os
from django.test import TestCase
from services.stedi_converter import convert, _translate_segment_path


FIXTURE_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')


def _make_mapping(field_name, value_expr):
    """Build a minimal Stedi mapping.json string with a single field."""
    return json.dumps({
        'name': 'Test',
        'type': 'only_mapped_keys',
        'mapping': f'{{ "{field_name}": {value_expr} }}',
        'lookup_tables': [],
    })


def _make_mapping_with_tables(field_name, value_expr, tables):
    return json.dumps({
        'name': 'Test',
        'type': 'only_mapped_keys',
        'mapping': f'{{ "{field_name}": {value_expr} }}',
        'lookup_tables': tables,
    })


class TestSimpleFieldMapping(TestCase):
    def test_simple_path_converts_to_map_directive(self):
        """Stedi verbose path → $map heading.b2.b2_element_02 to field"""
        mapping = _make_mapping(
            'standardCarrierAlphaCode',
            '$$.transactionSets[0].heading.beginning_segment_for_shipment_information_transaction_B2.standard_carrier_alpha_code_02',
        )
        result = convert(mapping)
        self.assertIn('$map', result.dsl)
        self.assertIn('b2_element_02', result.dsl)
        self.assertIn('standardCarrierAlphaCode', result.dsl)
        self.assertGreaterEqual(result.fields_mapped, 1)


class TestHardcodedValue(TestCase):
    def test_string_value_converts_to_set(self):
        mapping = _make_mapping('pickupOrDelivery', '"PICKUP_AND_DELIVERY"')
        result = convert(mapping)
        self.assertIn('$set pickupOrDelivery', result.dsl)
        self.assertIn('PICKUP_AND_DELIVERY', result.dsl)

    def test_boolean_value_converts_to_set(self):
        mapping = _make_mapping('isLineHaul', 'false')
        result = convert(mapping)
        self.assertIn('$set isLineHaul = false', result.dsl)

    def test_undefined_is_omitted(self):
        mapping = _make_mapping('ignoredField', 'undefined')
        result = convert(mapping)
        self.assertIn('omitted', result.dsl)
        self.assertNotIn('$set ignoredField', result.dsl)


class TestLookupTableConversion(TestCase):
    def test_lookup_table_detected(self):
        mapping = _make_mapping(
            'transactionSetPurposeCode',
            '$lookupTable($tables.PURPOSE_CODES, "Key", $$.transactionSets[0].heading.set_purpose_B2A.transaction_set_purpose_code_01).Value',
        )
        result = convert(mapping)
        self.assertIn('PURPOSE_CODES', result.dsl)
        self.assertIn('transactionSetPurposeCode', result.dsl)


class TestCustomTransformFlagging(TestCase):
    def test_ternary_conditional_flags_custom_transform(self):
        mapping = _make_mapping('mawb', '$$.something = "X" ? valueA : valueB')
        result = convert(mapping)
        self.assertIn('NEEDS_CUSTOM_TRANSFORM', result.dsl)
        self.assertEqual(result.fields_custom, 1)

    def test_qualifier_filter_flags_custom_transform(self):
        mapping = _make_mapping(
            'deadlineDate',
            '$$.transactionSets[0].detail.stop_off_details_S5_loop[0].date_time_G62[date_qualifier_01 = "69"].date_02',
        )
        result = convert(mapping)
        self.assertIn('NEEDS_CUSTOM_TRANSFORM', result.dsl)
        self.assertGreaterEqual(result.fields_custom, 1)


class TestLookupTableExtraction(TestCase):
    def test_lookup_tables_extracted_from_mapping_json(self):
        mapping = _make_mapping_with_tables(
            'field1', '"value"',
            [
                {'name': 'PURPOSE_CODES', 'values': [{'Key': '00', 'Value': 'ORIGINAL'}]},
                {'name': 'PAYMENT_CODES', 'values': [{'Key': 'PP', 'Value': 'PREPAID_BY_SELLER'}]},
            ],
        )
        result = convert(mapping)
        self.assertIn('PURPOSE_CODES', result.lookup_tables)
        self.assertIn('PAYMENT_CODES', result.lookup_tables)


class TestStandardFieldsInjection(TestCase):
    def test_standard_fields_injected_for_204_inbound(self):
        mapping = json.dumps({
            'name': 'Empty', 'type': 'only_mapped_keys',
            'mapping': '{}', 'lookup_tables': [],
        })
        result = convert(mapping, '204', 'inbound')
        for field in ['senderId', 'receiverId', 'applicationSenderCode',
                       'receiverSenderCode', 'usageIndicatorCode',
                       'senderContactCode', 'standardCarrierAlphaCode',
                       'transactionSetPurposeCode', 'paymentMethod', 'pickupOrDelivery']:
            self.assertIn(field, result.dsl, f'Standard field {field} missing from DSL')
        self.assertEqual(result.fields_standard, 10)

    def test_envelope_fields_injected_for_211_inbound(self):
        """211 inbound should get the 5 envelope fields but NOT the 204-specific heading fields."""
        mapping = json.dumps({
            'name': 'Empty', 'type': 'only_mapped_keys',
            'mapping': '{}', 'lookup_tables': [],
        })
        result = convert(mapping, '211', 'inbound')
        self.assertEqual(result.fields_standard, 5)
        self.assertIn('senderId', result.dsl)
        self.assertIn('receiverId', result.dsl)
        self.assertIn('usageIndicatorCode', result.dsl)
        self.assertNotIn('paymentMethod', result.dsl)
        self.assertNotIn('pickupOrDelivery', result.dsl)


class TestNoDuplicateStandardFields(TestCase):
    def test_existing_field_not_duplicated(self):
        """If standardCarrierAlphaCode is already in Stedi mapping, don't inject again."""
        mapping = _make_mapping(
            'standardCarrierAlphaCode',
            '$$.transactionSets[0].heading.beginning_segment_for_shipment_information_transaction_B2.standard_carrier_alpha_code_02',
        )
        result = convert(mapping, '204', 'inbound')
        # Count occurrences of standardCarrierAlphaCode in non-comment lines
        active_lines = [l for l in result.dsl.split('\n') if not l.strip().startswith('#') and 'standardCarrierAlphaCode' in l]
        self.assertEqual(len(active_lines), 1, f'Expected 1 active line for standardCarrierAlphaCode, got {len(active_lines)}: {active_lines}')


class TestDateFields(TestCase):
    def test_deadline_date_gets_as_date_suffix(self):
        mapping = _make_mapping(
            'deadlineDate',
            '$$.transactionSets[0].detail.stop_off_details_S5_loop[0].date_time_G62.date_02',
        )
        result = convert(mapping)
        self.assertIn('$as date', result.dsl)


class TestConversionNotesAccuracy(TestCase):
    def test_notes_contain_field_counts(self):
        mapping = json.dumps({
            'name': 'Test', 'type': 'only_mapped_keys',
            'mapping': '{ "field1": "hardcoded", "field2": false }',
            'lookup_tables': [{'name': 'MY_TABLE', 'values': []}],
        })
        result = convert(mapping, '204', 'inbound')
        self.assertIn('fields mapped from Stedi', result.notes)
        self.assertIn('standard envelope/heading fields auto-injected', result.notes)
        self.assertIn('MY_TABLE', result.notes)


class TestFullCevaMappingConversion(TestCase):
    def test_ceva_mapping_roundtrip(self):
        fixture_path = os.path.join(FIXTURE_DIR, 'ceva-204-mapping.json')
        with open(fixture_path) as f:
            mapping_json = f.read()

        result = convert(mapping_json, '204', 'inbound')

        # CEVA has conditionals → needs custom transform
        self.assertTrue(result.needs_custom_transform)

        # All 10 standard fields present
        for field in ['senderId', 'receiverId', 'usageIndicatorCode',
                       'standardCarrierAlphaCode', 'paymentMethod']:
            self.assertIn(field, result.dsl, f'{field} missing from CEVA DSL')

        # Lookup tables extracted
        self.assertIn('PURPOSE_CODES', result.lookup_tables)
        self.assertIn('PAYMENT_CODES', result.lookup_tables)

        # fields_mapped > 0 (at least the hardcoded values)
        self.assertGreater(result.fields_mapped, 0)


class TestTranslateSegmentPath(TestCase):
    def test_b2_path_translates(self):
        path = _translate_segment_path(
            '$$.transactionSets[0].heading.beginning_segment_for_shipment_information_transaction_B2.standard_carrier_alpha_code_02'
        )
        self.assertIn('b2', path)
        self.assertIn('element_02', path)

    def test_s5_loop_array_index(self):
        path = _translate_segment_path(
            '$$.transactionSets[0].detail.stop_off_details_S5_loop[0]'
        )
        self.assertIn('s5_loop', path)
        self.assertIn('0', path)

    def test_qualifier_filter_returns_empty(self):
        path = _translate_segment_path(
            '$$.transactionSets[0].detail.stop_off_details_S5_loop[0].date_time_G62[date_qualifier_01 = "69"].date_02'
        )
        self.assertEqual(path, '')

    def test_invalid_json_returns_error_note(self):
        result = convert('not valid json at all')
        self.assertIn('Invalid JSON', result.notes)
