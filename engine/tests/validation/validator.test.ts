jest.mock('axios');

import {
  validateEnvelope,
  validateSchema,
  validateBusinessRules,
  checkDuplicate,
  validateFull,
  fetchKnownPartnerIds,
  type RedisClient,
} from '../../src/validation/validator';
import axios from 'axios';
import type { ParsedEDI, JediTransaction } from '../../src/types/jedi';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTransaction(
  txSet: string,
  headingOverrides: Record<string, unknown> = {},
  detailOverrides: Record<string, unknown> = {},
  rawCount = 3,
): JediTransaction {
  return {
    transaction_set_header_ST: {
      transaction_set_identifier_code_01: txSet,
      transaction_set_control_number_02: '0001',
    },
    transaction_set_trailer_SE: {
      number_of_included_segments_01: String(rawCount + 2),
      transaction_set_control_number_02: '0001',
    },
    _raw: Array.from({ length: rawCount }, (_, i) => ({ tag: `SEG${i}`, elements: [], loopId: undefined })),
    heading: headingOverrides,
    detail: detailOverrides,
  };
}

function makeValid204(): JediTransaction {
  return makeTransaction(
    '204',
    {
      b2: { b2_element_01: '', b2_element_02: 'EFWW', b2_element_03: '' },
      b2a: { b2a_element_01: '00' },
    },
    {
      s5_loop: [{ s5: { s5_element_01: '1', s5_element_02: 'DA' } }],
    },
  );
}

function makeValid211(): JediTransaction {
  return makeTransaction(
    '211',
    {
      bol: { bol_element_01: 'EFWW', bol_element_02: 'PP', bol_element_03: 'BOL-001' },
      b2a: { b2a_element_01: '00' },
      n1_loop: [{ n1: { n1_element_01: 'SH', n1_element_02: 'Shipper Name' } }],
    },
  );
}

function makeParsedEDI(
  txSet: string,
  tx: JediTransaction,
  overrides: {
    senderId?: string;
    isaCtrl?: string;
    ieaCtrl?: string;
    fgCount?: string;
    geCount?: string;
    isaDate?: string;
  } = {},
): ParsedEDI {
  return {
    raw: '',
    transactionSets: [txSet],
    interchange: {
      interchange_control_header_ISA: {
        authorization_information_qualifier_01: '00',
        authorization_information_02: '          ',
        security_information_qualifier_03: '00',
        security_information_04: '          ',
        interchange_id_qualifier_05: 'ZZ',
        interchange_sender_id_06: overrides.senderId ?? 'EFWW',
        interchange_id_qualifier_07: 'ZZ',
        interchange_receiver_id_08: 'TENET',
        interchange_date_09: overrides.isaDate ?? '260122', // recent date
        interchange_time_10: '1200',
        interchange_control_standards_identifier_11: 'U',
        interchange_control_version_number_12: '00401',
        interchange_control_number_13: overrides.isaCtrl ?? '000000001',
        acknowledgment_requested_14: '0',
        usage_indicator_15: 'P',
        component_element_separator_16: '>',
      },
      interchange_control_trailer_IEA: {
        number_of_included_functional_groups_01: overrides.fgCount ?? '1',
        interchange_control_number_02: overrides.ieaCtrl ?? '000000001',
      },
      functional_groups: [
        {
          functional_group_header_GS: {
            functional_identifier_code_01: 'SM',
            application_senders_code_02: 'EFWW',
            application_receivers_code_03: 'TENET',
            date_04: '20260122',
            time_05: '1200',
            group_control_number_06: '1',
            responsible_agency_code_07: 'X',
            version_release_industry_identifier_code_08: '004010',
          },
          functional_group_trailer_GE: {
            number_of_transaction_sets_included_01: overrides.geCount ?? '1',
            group_control_number_02: '1',
          },
          transactions: [tx],
        },
      ],
    },
  };
}

function makeMockRedis(existingKeys: Set<string> = new Set()): RedisClient {
  return {
    get: jest.fn(async (key: string) => (existingKeys.has(key) ? '1' : null)),
    set: jest.fn(async () => 'OK'),
  };
}

// ─── Envelope validation ──────────────────────────────────────────────────────

describe('validateEnvelope', () => {
  test('valid 204 passes envelope validation', () => {
    const parsed = makeParsedEDI('204', makeValid204());
    const result = validateEnvelope(parsed);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('valid 211 passes envelope validation', () => {
    const parsed = makeParsedEDI('211', makeValid211());
    const result = validateEnvelope(parsed);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('ISA/IEA control number mismatch fails with ENVELOPE_CONTROL_NUMBER_MISMATCH', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { isaCtrl: '000000001', ieaCtrl: '000000999' });
    const result = validateEnvelope(parsed);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'ENVELOPE_CONTROL_NUMBER_MISMATCH')).toBe(true);
  });

  test('IEA group count mismatch fails with ENVELOPE_GROUP_COUNT_MISMATCH', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { fgCount: '2' }); // declares 2 but only 1 present
    const result = validateEnvelope(parsed);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'ENVELOPE_GROUP_COUNT_MISMATCH')).toBe(true);
  });

  test('GE transaction count mismatch fails with ENVELOPE_TX_COUNT_MISMATCH', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { geCount: '5' }); // declares 5 but only 1 present
    const result = validateEnvelope(parsed);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'ENVELOPE_TX_COUNT_MISMATCH')).toBe(true);
  });

  test('empty sender ID fails with ENVELOPE_EMPTY_SENDER_ID', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { senderId: '' });
    const result = validateEnvelope(parsed);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'ENVELOPE_EMPTY_SENDER_ID')).toBe(true);
  });

  test('unknown sender ID produces UNKNOWN_SENDER_ID warning, not error', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { senderId: 'UNKN' });
    const result = validateEnvelope(parsed, ['EFWW', 'FOAA', 'FAFS']);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.code === 'UNKNOWN_SENDER_ID')).toBe(true);
  });

  test('UNKNOWN_SENDER_ID check is skipped when knownPartnerIds is null', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { senderId: 'UNKN' });
    const result = validateEnvelope(parsed, null);
    expect(result.warnings.some(w => w.code === 'UNKNOWN_SENDER_ID')).toBe(false);
  });

  test('sender ID comparison is case-insensitive and trims whitespace', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { senderId: ' efww ' });
    const result = validateEnvelope(parsed, ['EFWW']);
    expect(result.warnings.some(w => w.code === 'UNKNOWN_SENDER_ID')).toBe(false);
  });

  test('stale interchange date produces STALE_INTERCHANGE_DATE warning', () => {
    const parsed = makeParsedEDI('204', makeValid204(), { isaDate: '200101' }); // Jan 2020
    const result = validateEnvelope(parsed);
    expect(result.warnings.some(w => w.code === 'STALE_INTERCHANGE_DATE')).toBe(true);
  });
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe('validateSchema', () => {
  test('valid 204 passes schema validation', () => {
    const result = validateSchema(makeValid204(), '204');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('valid 211 passes schema validation', () => {
    const result = validateSchema(makeValid211(), '211');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('204 missing B2A segment fails with MISSING_REQUIRED_SEGMENT', () => {
    const tx = makeTransaction('204', {
      b2: { b2_element_02: 'EFWW' },
      // b2a intentionally omitted
    }, {
      s5_loop: [{ s5: {} }],
    });
    const result = validateSchema(tx, '204');
    expect(result.valid).toBe(false);
    const missingB2a = result.errors.find(e => e.code === 'MISSING_REQUIRED_SEGMENT' && e.segment === 'B2A');
    expect(missingB2a).toBeDefined();
  });

  test('204 missing S5 loop fails with MISSING_REQUIRED_LOOP', () => {
    const tx = makeTransaction('204', {
      b2: { b2_element_02: 'EFWW' },
      b2a: { b2a_element_01: '00' },
    }); // no detail s5_loop
    const result = validateSchema(tx, '204');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_LOOP' && e.segment === 'S5')).toBe(true);
  });

  test('211 missing BOL fails with MISSING_REQUIRED_SEGMENT', () => {
    const tx = makeTransaction('211', {
      b2a: { b2a_element_01: '00' },
      n1_loop: [{ n1: {} }],
    });
    const result = validateSchema(tx, '211');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_SEGMENT' && e.segment === 'BOL')).toBe(true);
  });

  test('997 passes schema validation with no required segments', () => {
    const tx = makeTransaction('997', {});
    const result = validateSchema(tx, '997');
    expect(result.valid).toBe(true);
  });

  test('unknown transaction set produces UNKNOWN_TRANSACTION_SET warning, not error', () => {
    const tx = makeTransaction('999', {});
    const result = validateSchema(tx, '999');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some(w => w.code === 'UNKNOWN_TRANSACTION_SET')).toBe(true);
  });
});

// ─── Business rule validation ─────────────────────────────────────────────────

describe('validateBusinessRules', () => {
  test('valid 204 with SCAC passes business rules', () => {
    const result = validateBusinessRules(makeValid204(), '204');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('valid 211 with SCAC passes business rules', () => {
    const result = validateBusinessRules(makeValid211(), '211');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('204 with empty SCAC fails with MISSING_SCAC', () => {
    const tx = makeTransaction('204', {
      b2: { b2_element_01: '', b2_element_02: '', b2_element_03: '' }, // empty SCAC
      b2a: { b2a_element_01: '00' },
    }, { s5_loop: [{ s5: {} }] });
    const result = validateBusinessRules(tx, '204');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_SCAC')).toBe(true);
  });

  test('204 with SCAC too long fails with INVALID_SCAC_LENGTH', () => {
    const tx = makeTransaction('204', {
      b2: { b2_element_02: 'TOOLONG' },
      b2a: { b2a_element_01: '00' },
    }, { s5_loop: [{ s5: {} }] });
    const result = validateBusinessRules(tx, '204');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_SCAC_LENGTH')).toBe(true);
  });

  test('211 with empty SCAC fails with MISSING_SCAC', () => {
    const tx = makeTransaction('211', {
      bol: { bol_element_01: '' }, // empty SCAC
      b2a: { b2a_element_01: '00' },
      n1_loop: [{ n1: {} }],
    });
    const result = validateBusinessRules(tx, '211');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_SCAC')).toBe(true);
  });
});

// ─── Duplicate detection ──────────────────────────────────────────────────────

describe('checkDuplicate', () => {
  test('returns valid when key does not exist in Redis', async () => {
    const redis = makeMockRedis();
    const result = await checkDuplicate('EFWW', '000000001', redis);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('returns DUPLICATE_INTERCHANGE error when key already exists', async () => {
    const existingKeys = new Set(['edi:processed:EFWW:000000001']);
    const redis = makeMockRedis(existingKeys);
    const result = await checkDuplicate('EFWW', '000000001', redis);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_INTERCHANGE')).toBe(true);
  });

  test('does not throw when Redis is unavailable — returns valid', async () => {
    const redis: RedisClient = {
      get: jest.fn(async () => { throw new Error('Redis unavailable'); }),
      set: jest.fn(async () => 'OK'),
    };
    const result = await checkDuplicate('EFWW', '000000001', redis);
    expect(result.valid).toBe(true); // fail-open: skip duplicate check if Redis is down
  });
});

// ─── Full pipeline ────────────────────────────────────────────────────────────

describe('fetchKnownPartnerIds', () => {
  test('returns partner_id list on success', async () => {
    (axios.get as jest.Mock).mockResolvedValueOnce({
      data: { partners: [{ partner_id: 'EFWW' }, { partner_id: 'FOAA' }] },
    });
    const ids = await fetchKnownPartnerIds();
    expect(ids).toEqual(['EFWW', 'FOAA']);
  });

  test('returns null when Django is unreachable', async () => {
    (axios.get as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const ids = await fetchKnownPartnerIds();
    expect(ids).toBeNull();
  });
});

describe('validateFull', () => {
  beforeEach(() => {
    // Return the test sender so envelope validation sees it as a known partner
    (axios.get as jest.Mock).mockResolvedValue({
      data: { partners: [{ partner_id: 'EFWW' }] },
    });
  });
  test('valid 204 passes all three levels', async () => {
    const parsed = makeParsedEDI('204', makeValid204());
    const result = await validateFull(parsed);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('valid 211 passes all three levels', async () => {
    const parsed = makeParsedEDI('211', makeValid211());
    const result = await validateFull(parsed);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('duplicate interchange is detected when Redis has the key', async () => {
    const parsed = makeParsedEDI('204', makeValid204(), { isaCtrl: '000000001', ieaCtrl: '000000001' });
    const redis = makeMockRedis(new Set(['edi:processed:EFWW:000000001']));
    const result = await validateFull(parsed, redis);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_INTERCHANGE')).toBe(true);
  });

  test('schema error propagates from validateFull', async () => {
    const tx = makeTransaction('204', {
      b2: { b2_element_02: 'EFWW' },
      // B2A missing
    }, { s5_loop: [{ s5: {} }] });
    const parsed = makeParsedEDI('204', tx);
    const result = await validateFull(parsed);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_SEGMENT' && e.segment === 'B2A')).toBe(true);
  });

  test('SKIP_DUPLICATE_CHECK=true bypasses duplicate detection', async () => {
    const original = process.env.SKIP_DUPLICATE_CHECK;
    process.env.SKIP_DUPLICATE_CHECK = 'true';
    try {
      const parsed = makeParsedEDI('204', makeValid204());
      const redis = makeMockRedis(new Set(['edi:processed:EFWW:000000001']));
      const result = await validateFull(parsed, redis);
      // Should NOT have DUPLICATE_INTERCHANGE even though the key exists
      expect(result.errors.some(e => e.code === 'DUPLICATE_INTERCHANGE')).toBe(false);
    } finally {
      if (original === undefined) {
        delete process.env.SKIP_DUPLICATE_CHECK;
      } else {
        process.env.SKIP_DUPLICATE_CHECK = original;
      }
    }
  });

  test('SKIP_DUPLICATE_CHECK unset allows duplicate detection', async () => {
    const original = process.env.SKIP_DUPLICATE_CHECK;
    delete process.env.SKIP_DUPLICATE_CHECK;
    try {
      const parsed = makeParsedEDI('204', makeValid204());
      const redis = makeMockRedis(new Set(['edi:processed:EFWW:000000001']));
      const result = await validateFull(parsed, redis);
      expect(result.errors.some(e => e.code === 'DUPLICATE_INTERCHANGE')).toBe(true);
    } finally {
      if (original !== undefined) {
        process.env.SKIP_DUPLICATE_CHECK = original;
      }
    }
  });
});

// ─── Additional branch coverage ──────────────────────────────────────────────

describe('validateSchema — additional branches', () => {
  test('204 missing B2 segment fails with MISSING_REQUIRED_SEGMENT', () => {
    const tx = makeTransaction('204', {
      // b2 intentionally omitted
      b2a: { b2a_element_01: '00' },
    }, { s5_loop: [{ s5: {} }] });
    const result = validateSchema(tx, '204');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_SEGMENT' && e.segment === 'B2')).toBe(true);
  });

  test('211 missing N1 loop fails with MISSING_REQUIRED_LOOP', () => {
    const tx = makeTransaction('211', {
      bol: { bol_element_01: 'EFWW' },
      b2a: { b2a_element_01: '00' },
      // n1_loop intentionally omitted
    });
    const result = validateSchema(tx, '211');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_REQUIRED_LOOP' && e.segment === 'N1')).toBe(true);
  });

  test('outbound transaction sets (210, 214, 990) skip schema validation', () => {
    for (const txSet of ['210', '214', '990']) {
      const tx = makeTransaction(txSet, {});
      const result = validateSchema(tx, txSet);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    }
  });
});

describe('validateBusinessRules — additional branches', () => {
  test('204 with SCAC too short (1 char) fails with INVALID_SCAC_LENGTH', () => {
    const tx = makeTransaction('204', {
      b2: { b2_element_02: 'F' },
      b2a: { b2a_element_01: '00' },
    }, { s5_loop: [{ s5: {} }] });
    const result = validateBusinessRules(tx, '204');
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_SCAC_LENGTH')).toBe(true);
  });

  test('non-204/211 transaction set skips SCAC validation', () => {
    const tx = makeTransaction('997', {});
    const result = validateBusinessRules(tx, '997');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validateEnvelope — SE segment count mismatch', () => {
  test('SE count mismatch produces ENVELOPE_SEGMENT_COUNT_MISMATCH', () => {
    // Create a transaction with 3 raw segments but SE declares 99
    const tx: JediTransaction = {
      transaction_set_header_ST: {
        transaction_set_identifier_code_01: '204',
        transaction_set_control_number_02: '0001',
      },
      transaction_set_trailer_SE: {
        number_of_included_segments_01: '99', // wrong — should be 5 (3 raw + ST + SE)
        transaction_set_control_number_02: '0001',
      },
      _raw: [
        { tag: 'B2', elements: [], loopId: undefined },
        { tag: 'B2A', elements: [], loopId: undefined },
        { tag: 'S5', elements: [], loopId: undefined },
      ],
      heading: { b2: { b2_element_02: 'EFWW' }, b2a: { b2a_element_01: '00' } },
      detail: { s5_loop: [{ s5: {} }] },
    };
    const parsed = makeParsedEDI('204', tx);
    const result = validateEnvelope(parsed);
    expect(result.errors.some(e => e.code === 'ENVELOPE_SEGMENT_COUNT_MISMATCH')).toBe(true);
  });
});
