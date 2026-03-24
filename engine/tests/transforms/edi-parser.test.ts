import { parseEDI } from '../../src/transforms/edi-parser';

const ISA = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>';
const GS  = 'GS*SM*SENDER*RECEIVER*20231015*1200*1*X*004010';
const IEA = 'IEA*1*000000001';

const SAMPLE_204 = [
  ISA,
  GS,
  'ST*204*0001',
  'B2**ABCD*PRO123**TL**SHIP001',
  'N1*SH*Acme Shipper*ZZ*ACM',
  'N3*123 Main Street',
  'N4*Chicago*IL*60601',
  'N1*CN*Bob Consignee*ZZ*BOB',
  'N3*456 Elm Ave',
  'N4*Springfield*MO*65802',
  'S5*1*PU',
  'G62*10*20231016*1*0800',
  'S5*2*D',
  'G62*11*20231017*2*1700',
  'L3*1000*G***500.00',
  'SE*15*0001',
  'GE*1*1',
  IEA,
].join('~\n') + '~';

describe('EDI Parser', () => {
  test('parses a 204 EDI string to correct JEDI structure', () => {
    const result = parseEDI(SAMPLE_204);
    expect(result.interchange).toBeDefined();
    expect(result.interchange.functional_groups).toHaveLength(1);
  });

  test('ISA header fields correctly named and extracted', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const isa = interchange.interchange_control_header_ISA;
    expect(isa['interchange_sender_id_06']).toContain('SENDER');
    expect(isa['interchange_receiver_id_08']).toContain('RECEIVER');
    expect(isa['interchange_control_number_13']).toBe('000000001');
  });

  test('GS functional group correctly named', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const gs = interchange.functional_groups[0].functional_group_header_GS;
    expect(gs['functional_identifier_code_01']).toBe('SM');
    expect(gs['application_senders_code_02']).toBe('SENDER');
  });

  test('ST transaction correctly identified', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const tx = interchange.functional_groups[0].transactions[0];
    expect(tx.transaction_set_header_ST.transaction_set_identifier_code_01).toBe('204');
    expect(tx.transaction_set_header_ST.transaction_set_control_number_02).toBe('0001');
  });

  test('_raw segments preserved on transaction', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const tx = interchange.functional_groups[0].transactions[0];
    expect(tx._raw).toBeDefined();
    expect(Array.isArray(tx._raw)).toBe(true);
    expect(tx._raw!.length).toBeGreaterThan(0);
    expect(tx._raw![0].tag).toBe('B2');
  });

  test('transactionSets array contains "204"', () => {
    const result = parseEDI(SAMPLE_204);
    expect(result.transactionSets).toContain('204');
  });

  test('throws on invalid EDI (no ISA header)', () => {
    expect(() => parseEDI('ST*204*0001~')).toThrow('Invalid EDI');
  });

  test('heading section populated for B2 segment', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const tx = interchange.functional_groups[0].transactions[0];
    expect(tx.heading).toBeDefined();
    expect((tx.heading as Record<string, unknown>)['b2']).toBeDefined();
  });

  test('loop segments grouped into n1_loop array', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const tx = interchange.functional_groups[0].transactions[0];
    const heading = tx.heading as Record<string, unknown>;
    expect(heading['n1_loop']).toBeDefined();
    expect(Array.isArray(heading['n1_loop'])).toBe(true);
    expect((heading['n1_loop'] as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  test('summary section populated for L3 segment', () => {
    const { interchange } = parseEDI(SAMPLE_204);
    const tx = interchange.functional_groups[0].transactions[0];
    expect(tx.summary).toBeDefined();
  });

  // --- new tests ---

  test('strips UTF-8 BOM before parsing', () => {
    const result = parseEDI('\uFEFF' + SAMPLE_204);
    expect(result.interchange.functional_groups).toHaveLength(1);
    const tx = result.interchange.functional_groups[0].transactions[0];
    expect(tx.transaction_set_header_ST.transaction_set_identifier_code_01).toBe('204');
  });

  test('strips Windows carriage returns (CRLF) before parsing', () => {
    const withCrlf = SAMPLE_204.replace(/\n/g, '\r\n');
    const result = parseEDI(withCrlf);
    expect(result.interchange.functional_groups).toHaveLength(1);
    expect(result.transactionSets).toContain('204');
  });

  test('parses multiple transactions in one interchange', () => {
    const multiTx = [
      ISA,
      GS,
      'ST*204*0001',
      'B2**ABCD*PRO123**TL',
      'SE*2*0001',
      'ST*204*0002',
      'B2**EFGH*PRO456**LTL',
      'SE*2*0002',
      'GE*2*1',
      IEA,
    ].join('~\n') + '~';

    const result = parseEDI(multiTx);
    const transactions = result.interchange.functional_groups[0].transactions;
    expect(transactions).toHaveLength(2);
    expect(transactions[0].transaction_set_header_ST.transaction_set_control_number_02).toBe('0001');
    expect(transactions[1].transaction_set_header_ST.transaction_set_control_number_02).toBe('0002');
  });

  test('produces empty functional_groups when GS segment is missing', () => {
    const noGs = [ISA, IEA].join('~\n') + '~';
    const result = parseEDI(noGs);
    expect(result.interchange.functional_groups).toHaveLength(0);
  });

  test('does not throw and returns transaction with empty SE trailer when SE is missing', () => {
    const noSe = [ISA, GS, 'ST*204*0001', 'B2**ABCD*PRO123**TL', 'GE*1*1', IEA].join('~\n') + '~';
    expect(() => parseEDI(noSe)).not.toThrow();
    const tx = parseEDI(noSe).interchange.functional_groups[0]?.transactions[0];
    expect(tx).toBeDefined();
    expect(tx.transaction_set_trailer_SE).toEqual({});
  });

  test('multiple L11 segments grouped into an array in heading', () => {
    const multiL11 = [
      ISA, GS,
      'ST*204*0001',
      'B2**ABCD*PRO123**TL',
      'L11*MAWB123*MA',
      'L11*SVC001*SL',
      'L11*QUAT001*QN',
      'SE*5*0001',
      'GE*1*1',
      IEA,
    ].join('~\n') + '~';

    const tx = parseEDI(multiL11).interchange.functional_groups[0].transactions[0];
    const heading = tx.heading as Record<string, unknown>;
    expect(Array.isArray(heading['l11'])).toBe(true);
    const l11Arr = heading['l11'] as Record<string, string>[];
    expect(l11Arr).toHaveLength(3);
    expect(l11Arr[0]['l11_element_01']).toBe('MAWB123');
    expect(l11Arr[1]['l11_element_01']).toBe('SVC001');
    expect(l11Arr[2]['l11_element_01']).toBe('QUAT001');
  });

  test('N1 loop is classified into detail section when preceded by S5', () => {
    const withDetailN1 = [
      ISA, GS,
      'ST*204*0001',
      'B2**ABCD*PRO123**TL',
      'S5*1*PU',
      'N1*SH*Acme Shipper',
      'N3*123 Main St',
      'N4*Chicago*IL*60601',
      'SE*6*0001',
      'GE*1*1',
      IEA,
    ].join('~\n') + '~';

    const tx = parseEDI(withDetailN1).interchange.functional_groups[0].transactions[0];
    const detail = tx.detail as Record<string, unknown>;
    const heading = tx.heading as Record<string, unknown>;

    expect(detail).toBeDefined();
    // With nested loop support, N1 nests inside the S5 loop entry
    const s5Loop = detail['s5_loop'] as Record<string, unknown>[];
    expect(s5Loop).toBeDefined();
    expect(s5Loop[0]['n1_loop']).toBeDefined();
    expect(heading['n1_loop']).toBeUndefined();

    const n1Loop = s5Loop[0]['n1_loop'] as Record<string, unknown>[];
    expect(n1Loop[0]).toHaveProperty('n1');
    expect(n1Loop[0]).toHaveProperty('n3');
    expect(n1Loop[0]).toHaveProperty('n4');
  });
});
