import type { JediInterchange, JediTransaction } from '../types/jedi';

export const GS_FUNCTIONAL_CODES: Record<string, string> = {
  '204': 'SM', '210': 'IM', '211': 'SM',
  '214': 'QM', '990': 'GF', '997': 'FA',
};

/**
 * Build a minimal JediTransaction for outbound EDI.
 * bodySegmentCount: the number of raw body segments (from systemToJedi).
 * SE_01 = ST + body + SE = bodySegmentCount + 2.
 */
export function buildTransaction(txSet: string, bodySegmentCount: number): JediTransaction {
  const ctrl = '0001';
  return {
    transaction_set_header_ST: {
      transaction_set_identifier_code_01: txSet,
      transaction_set_control_number_02: ctrl,
    },
    transaction_set_trailer_SE: {
      number_of_included_segments_01: String(bodySegmentCount + 2),
      transaction_set_control_number_02: ctrl,
    },
  };
}

/**
 * Build a minimal JEDI interchange envelope for outbound EDI.
 * Sender/receiver IDs are placeholder values — the trading-partner
 * registry will supply real values once partner config is wired in.
 */
export function buildInterchangeWrapper(txSet: string): JediInterchange {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const ctrl = String(Date.now()).slice(-9).padStart(9, '0');

  return {
    interchange_control_header_ISA: {
      authorization_information_qualifier_01: '00',
      authorization_information_02: '          ',
      security_information_qualifier_03: '00',
      security_information_04: '          ',
      interchange_id_qualifier_05: 'ZZ',
      interchange_sender_id_06: 'SENDER         ',
      interchange_id_qualifier_07: 'ZZ',
      interchange_receiver_id_08: 'RECEIVER       ',
      interchange_date_09: date.slice(2),
      interchange_time_10: time,
      interchange_control_standards_identifier_11: 'U',
      interchange_control_version_number_12: '00401',
      interchange_control_number_13: ctrl,
      acknowledgment_requested_14: '0',
      usage_indicator_15: 'P',
      component_element_separator_16: '>',
    },
    functional_groups: [{
      functional_group_header_GS: {
        functional_identifier_code_01: GS_FUNCTIONAL_CODES[txSet] ?? 'XX',
        application_senders_code_02: 'SENDER',
        application_receivers_code_03: 'RECEIVER',
        date_04: date,
        time_05: time,
        group_control_number_06: ctrl,
        responsible_agency_code_07: 'X',
        version_release_industry_identifier_code_08: '004010',
      },
      transactions: [],
      functional_group_trailer_GE: {
        number_of_transaction_sets_included_01: '1',
        group_control_number_02: ctrl,
      },
    }],
    interchange_control_trailer_IEA: {
      number_of_included_functional_groups_01: '1',
      interchange_control_number_02: ctrl,
    },
  };
}
