import { parseEDI } from '../../src/transforms/edi-parser';

const SAMPLE_204 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*SM*SENDER*RECEIVER*20231015*1200*1*X*004010',
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
  'IEA*1*000000001',
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
});
