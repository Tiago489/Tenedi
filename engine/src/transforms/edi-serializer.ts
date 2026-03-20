import pino from 'pino';
import type { JediInterchange, RawSegment } from '../types/jedi';

const logger = pino({ name: 'edi-serializer' });

const ELEMENT_SEP = '*';
const SEGMENT_TERM = '~';
const COMPONENT_SEP = '>';

export function serializeEDI(interchange: JediInterchange, rawSegments: RawSegment[]): string {
  const isa = interchange.interchange_control_header_ISA;
  const iea = interchange.interchange_control_trailer_IEA;
  const segs: string[] = [];

  // ISA — fixed-width
  segs.push([
    'ISA',
    (isa['authorization_information_qualifier_01'] ?? '00').padEnd(2),
    (isa['authorization_information_02'] ?? '').padEnd(10),
    (isa['security_information_qualifier_03'] ?? '00').padEnd(2),
    (isa['security_information_04'] ?? '').padEnd(10),
    (isa['interchange_id_qualifier_05'] ?? 'ZZ').padEnd(2),
    (isa['interchange_sender_id_06'] ?? '').padEnd(15),
    (isa['interchange_id_qualifier_07'] ?? 'ZZ').padEnd(2),
    (isa['interchange_receiver_id_08'] ?? '').padEnd(15),
    isa['interchange_date_09'] ?? '',
    isa['interchange_time_10'] ?? '',
    isa['interchange_control_standards_identifier_11'] ?? 'U',
    isa['interchange_control_version_number_12'] ?? '00401',
    (isa['interchange_control_number_13'] ?? '000000001').padStart(9, '0'),
    isa['acknowledgment_requested_14'] ?? '0',
    isa['usage_indicator_15'] ?? 'P',
    COMPONENT_SEP,
  ].join(ELEMENT_SEP));

  for (const fg of interchange.functional_groups) {
    const gs = fg.functional_group_header_GS;
    segs.push([
      'GS',
      gs['functional_identifier_code_01'] ?? '',
      gs['application_senders_code_02'] ?? '',
      gs['application_receivers_code_03'] ?? '',
      gs['date_04'] ?? '',
      gs['time_05'] ?? '',
      gs['group_control_number_06'] ?? '',
      gs['responsible_agency_code_07'] ?? 'X',
      gs['version_release_industry_identifier_code_08'] ?? '004010',
    ].join(ELEMENT_SEP));

    for (const tx of fg.transactions) {
      const st = tx.transaction_set_header_ST;
      segs.push(`ST${ELEMENT_SEP}${st.transaction_set_identifier_code_01}${ELEMENT_SEP}${st.transaction_set_control_number_02}`);

      const bodySegs = rawSegments.length > 0 ? rawSegments : (tx._raw ?? []);
      for (const seg of bodySegs) {
        segs.push([seg.tag, ...seg.elements].join(ELEMENT_SEP));
      }

      const se = tx.transaction_set_trailer_SE;
      segs.push(`SE${ELEMENT_SEP}${se['number_of_included_segments_01'] ?? ''}${ELEMENT_SEP}${se['transaction_set_control_number_02'] ?? ''}`);
    }

    const ge = fg.functional_group_trailer_GE;
    segs.push(`GE${ELEMENT_SEP}${ge['number_of_transaction_sets_included_01'] ?? '1'}${ELEMENT_SEP}${ge['group_control_number_02'] ?? ''}`);
  }

  segs.push(`IEA${ELEMENT_SEP}${iea['number_of_included_functional_groups_01'] ?? '1'}${ELEMENT_SEP}${iea['interchange_control_number_02'] ?? ''}`);

  const output = segs.join(`${SEGMENT_TERM}\n`) + `${SEGMENT_TERM}\n`;
  logger.debug({ segmentCount: segs.length }, 'Serialized EDI');
  return output;
}
