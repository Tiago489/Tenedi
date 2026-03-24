"""
Standard envelope and heading fields required in every 204 inbound systemJson.

These fields come from ISA/GS envelope and B2/B2A heading segments.
Stedi mapping.json does NOT include them because Stedi handles them
at the platform level — so they must be injected by our converter
and referenced in AI prompts.

Format:
  "outputField": "MAP:jedi.path"         → $map jedi.path to outputField
  "outputField": "SET:value"             → $set outputField = "value"
  "outputField": "LOOKUP:TABLE:jedi.path" → $lookup TABLE jedi.path to outputField
"""

STANDARD_204_INBOUND_FIELDS: dict[str, str] = {
    'senderId': 'MAP:envelope.isa.isa_element_06',
    'receiverId': 'MAP:envelope.isa.isa_element_08',
    'applicationSenderCode': 'MAP:envelope.gs.gs_element_02',
    'receiverSenderCode': 'MAP:envelope.gs.gs_element_03',
    'usageIndicatorCode': 'SET:P',
    'senderContactCode': 'MAP:heading.b2.b2_element_02',
    'standardCarrierAlphaCode': 'MAP:heading.b2.b2_element_02',
    'transactionSetPurposeCode': 'LOOKUP:PURPOSE_CODES:heading.b2a.b2a_element_01',
    'paymentMethod': 'LOOKUP:PAYMENT_CODES:heading.b2.b2_element_06',
    'pickupOrDelivery': 'SET:PICKUP_AND_DELIVERY',
}

# Fields that should have ISO date formatting applied
DATE_FIELDS = {'deadlineDate'}


def standard_dsl_block(tx_set: str = '204', direction: str = 'inbound') -> str:
    """Generate the standard DSL lines for a given transaction set + direction."""
    if tx_set != '204' or direction != 'inbound':
        return ''

    lines = ['# ── Standard envelope & heading fields (auto-injected) ──']
    for output_field, spec in STANDARD_204_INBOUND_FIELDS.items():
        if spec.startswith('MAP:'):
            path = spec[4:]
            lines.append(f'$map {path} to {output_field}')
        elif spec.startswith('SET:'):
            value = spec[4:]
            lines.append(f'$set {output_field} = "{value}"')
        elif spec.startswith('LOOKUP:'):
            parts = spec.split(':', 2)
            table = parts[1]
            path = parts[2]
            lines.append(f'$lookup {table} {path} to {output_field}')
    lines.append('')
    return '\n'.join(lines)


def standard_fields_prompt() -> str:
    """Return the AI prompt instruction block for standard fields."""
    lines = [
        'IMPORTANT: Every 204 inbound map MUST include these envelope fields',
        'extracted from the ISA/GS segments and B2/B2A heading:',
    ]
    for output_field, spec in STANDARD_204_INBOUND_FIELDS.items():
        if spec.startswith('MAP:'):
            lines.append(f'- {output_field}: from {spec[4:]}')
        elif spec.startswith('SET:'):
            lines.append(f'- {output_field}: hardcoded "{spec[4:]}"')
        elif spec.startswith('LOOKUP:'):
            parts = spec.split(':', 2)
            lines.append(f'- {output_field}: lookup {parts[1]} from {parts[2]}')
    lines.append('All dates must be formatted as ISO 8601 (YYYY-MM-DD).')
    lines.append('These fields are ALWAYS required regardless of what the Stedi mapping.json contains.')
    return '\n'.join(lines)
