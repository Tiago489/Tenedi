"""
Convert Stedi mapping.json content to JEDI DSL field mappings.

Handles:
  - Stedi verbose segment names → JEDI short tags (B2, N1, S5, etc.)
  - Simple assignments → $map directives
  - $lookupTable calls → $lookup directives
  - Hardcoded values (strings, booleans, undefined) → $set / $omit
  - Complex JSONata ($expr) → Tier 3 escape hatch
  - Conditional/ternary expressions → flagged as NEEDS_CUSTOM_TRANSFORM
  - Qualifier-based filtering ([qualifier = "X"]) → flagged as NEEDS_CUSTOM_TRANSFORM
  - Standard envelope/heading fields auto-injected for 204 inbound
"""
import json
import re
from dataclasses import dataclass, field

from services.standard_fields import standard_dsl_block, DATE_FIELDS


# ── Stedi segment name → JEDI tag lookup ──────────────────────────────────────

STEDI_SEGMENT_MAP = {
    'transaction_set_header_ST': 'st',
    'beginning_segment_for_shipment_information_transaction_B2': 'b2',
    'set_purpose_B2A': 'b2a',
    'stop_off_details_S5': 's5',
    'name_N1': 'n1',
    'address_information_N3': 'n3',
    'geographic_location_N4': 'n4',
    'contact_G61': 'g61',
    'date_time_G62': 'g62',
    'order_identification_detail_OID': 'oid',
    'lading_detail_LAD': 'lad',
    'note_special_instruction_NTE': 'nte',
    'interline_information_MS3': 'ms3',
    'bill_of_lading_handling_requirements_AT5': 'at5',
    'shipment_weight_packaging_and_quantity_data_AT8': 'at8',
    'reference_identification_L11': 'l11',
    'total_weight_and_charges_L3': 'l3',
}

FIELD_RE = re.compile(r'_(\d{2})$')


def _translate_segment_path(stedi_path: str) -> str:
    """Translate a single Stedi dotted path to JEDI short-tag path."""
    path = stedi_path
    path = re.sub(r'^\$\$\.', '', path)
    path = re.sub(r'^transactionSets\[0\]\.', '', path)

    parts = path.split('.')
    result = []

    for part in parts:
        idx_match = re.match(r'^(.+)\[(\d+)\]$', part)
        if idx_match:
            base, idx = idx_match.group(1), idx_match.group(2)
        else:
            base, idx = part, None

        if '[' in base and '=' in base:
            return ''  # needs custom transform

        translated = base
        for stedi_name, jedi_tag in STEDI_SEGMENT_MAP.items():
            if stedi_name in base:
                translated = base.replace(stedi_name, jedi_tag)
                break

        field_match = FIELD_RE.search(translated)
        if field_match and '.' not in translated and '_loop' not in translated:
            num = field_match.group(1)
            for stedi_name, jedi_tag in STEDI_SEGMENT_MAP.items():
                if stedi_name.lower() in base.lower() or jedi_tag in translated.lower():
                    translated = f'{jedi_tag}_element_{num}'
                    break

        result.append(translated)
        if idx is not None:
            result.append(idx)

    return '.'.join(result)


@dataclass
class ConversionResult:
    dsl: str = ''
    notes: str = ''
    needs_custom_transform: bool = False
    lookup_tables: list = field(default_factory=list)
    fields_mapped: int = 0
    fields_expr: int = 0
    fields_custom: int = 0
    fields_standard: int = 0


def convert(mapping_json_str: str, tx_set: str = '204', direction: str = 'inbound') -> ConversionResult:
    """Convert Stedi mapping.json to DSL and analysis notes."""
    try:
        data = json.loads(mapping_json_str)
    except json.JSONDecodeError as e:
        return ConversionResult(notes=f'Invalid JSON: {e}')

    result = ConversionResult()

    # Extract lookup tables
    for table in data.get('lookup_tables', []):
        name = table.get('name', '')
        if name:
            result.lookup_tables.append(name)

    # Track which output fields the Stedi mapping already handles
    mapped_output_fields: set[str] = set()

    # Parse the mapping expression
    mapping_str = data.get('mapping', '{}')
    if isinstance(mapping_str, str):
        result.dsl = f'# Auto-converted from Stedi mapping: {data.get("name", "unnamed")}\n'
        result.dsl += f'# Type: {data.get("type", "unknown")}\n\n'
        _analyze_mapping_string(mapping_str, result, mapped_output_fields)
    elif isinstance(mapping_str, dict):
        result.dsl = f'# Auto-converted from Stedi mapping: {data.get("name", "unnamed")}\n\n'
        _analyze_mapping_dict(mapping_str, result, mapped_output_fields)

    # Inject standard envelope/heading fields that Stedi doesn't include
    std_block = standard_dsl_block(tx_set, direction)
    if std_block:
        # Filter out fields already present in the Stedi-converted DSL
        filtered_lines = []
        for line in std_block.split('\n'):
            if line.startswith('#') or not line.strip():
                filtered_lines.append(line)
                continue
            # Extract the output field name from "$map ... to FIELD" or "$set FIELD =" or "$lookup ... to FIELD"
            out_field = _extract_output_field(line)
            if out_field and out_field not in mapped_output_fields:
                filtered_lines.append(line)
                result.fields_standard += 1

        if result.fields_standard > 0:
            result.dsl = '\n'.join(filtered_lines) + '\n\n' + result.dsl

    # Build notes
    lines = [f'{result.fields_mapped} fields mapped from Stedi']
    if result.fields_standard > 0:
        lines.append(f'{result.fields_standard} standard envelope/heading fields auto-injected')
    if result.fields_expr > 0:
        lines.append(f'{result.fields_expr} used $expr fallback (complex JSONata)')
    if result.fields_custom > 0:
        lines.append(f'{result.fields_custom} flagged as NEEDS_CUSTOM_TRANSFORM (conditional branching / qualifier filtering)')
        result.needs_custom_transform = True
    if result.lookup_tables:
        lines.append(f'Lookup tables referenced: {", ".join(result.lookup_tables)}')
    result.notes = '\n'.join(lines)

    return result


def _extract_output_field(dsl_line: str) -> str | None:
    """Extract the output field name from a DSL directive line."""
    line = dsl_line.strip()
    # $map ... to FIELD
    m = re.search(r'\bto\s+(\S+)\s*$', line)
    if m:
        return m.group(1)
    # $set FIELD = ...
    m = re.match(r'\$set\s+(\S+)\s*=', line)
    if m:
        return m.group(1)
    return None


def _analyze_mapping_string(mapping_str: str, result: ConversionResult, mapped_fields: set):
    """Analyze a JSONata mapping string and extract what we can."""
    field_pattern = re.compile(r'"(\w+)":\s*(.+?)(?=,\s*"|}\s*}|}\s*$)')

    for match in field_pattern.finditer(mapping_str):
        field_name = match.group(1)
        value_expr = match.group(2).strip().rstrip(',').strip()

        if value_expr == 'undefined':
            result.dsl += f'# {field_name}: omitted (undefined in Stedi mapping)\n'
            continue

        if value_expr.startswith('"') and value_expr.endswith('"'):
            hardcoded = value_expr.strip('"')
            result.dsl += f'$set {field_name} = "{hardcoded}"\n'
            result.fields_mapped += 1
            mapped_fields.add(field_name)
            continue

        if value_expr in ('true', 'false'):
            result.dsl += f'$set {field_name} = {value_expr}\n'
            result.fields_mapped += 1
            mapped_fields.add(field_name)
            continue

        if '$lookupTable' in value_expr:
            table_match = re.search(r'\$tables\.(\w+)', value_expr)
            table_name = table_match.group(1) if table_match else 'UNKNOWN'
            result.dsl += f'# {field_name}: $lookup {table_name} (see Stedi mapping for source path)\n'
            result.fields_expr += 1
            mapped_fields.add(field_name)
            continue

        if '?' in value_expr and ':' in value_expr:
            result.dsl += f'# {field_name}: NEEDS_CUSTOM_TRANSFORM (conditional expression)\n'
            result.dsl += f'#   expr: {value_expr[:150]}\n'
            result.fields_custom += 1
            mapped_fields.add(field_name)
            continue

        if '[' in value_expr and '=' in value_expr:
            result.dsl += f'# {field_name}: NEEDS_CUSTOM_TRANSFORM (qualifier filtering)\n'
            result.dsl += f'#   expr: {value_expr[:150]}\n'
            result.fields_custom += 1
            mapped_fields.add(field_name)
            continue

        if '$$.' in value_expr:
            stedi_path = value_expr.strip()
            jedi_path = _translate_segment_path(stedi_path)
            if jedi_path:
                # Add date formatting for known date fields
                date_suffix = ' $as date' if field_name in DATE_FIELDS else ''
                result.dsl += f'$map {jedi_path} to {field_name}{date_suffix}\n'
                result.fields_mapped += 1
            else:
                result.dsl += f'# {field_name}: $expr "{value_expr[:150]}"\n'
                result.fields_expr += 1
            mapped_fields.add(field_name)
            continue

        result.dsl += f'# {field_name}: $expr "{value_expr[:150]}"\n'
        result.fields_expr += 1
        mapped_fields.add(field_name)


def _analyze_mapping_dict(mapping_dict: dict, result: ConversionResult, mapped_fields: set):
    """Analyze a parsed mapping dict (less common format)."""
    for key, value in mapping_dict.items():
        if isinstance(value, dict):
            result.dsl += f'# {key}: nested object (manual review needed)\n'
            result.fields_expr += 1
        elif isinstance(value, str) and '$$.' in value:
            jedi_path = _translate_segment_path(value)
            if jedi_path:
                date_suffix = ' $as date' if key in DATE_FIELDS else ''
                result.dsl += f'$map {jedi_path} to {key}{date_suffix}\n'
                result.fields_mapped += 1
            else:
                result.dsl += f'# {key}: $expr "{value[:100]}"\n'
                result.fields_expr += 1
        elif value is None:
            result.dsl += f'# {key}: omitted\n'
        else:
            result.dsl += f'$set {key} = {json.dumps(value)}\n'
            result.fields_mapped += 1
        mapped_fields.add(key)
