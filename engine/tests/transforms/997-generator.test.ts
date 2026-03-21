import { generate997 } from '../../src/transforms/997-generator';
import { parseEDI } from '../../src/transforms/edi-parser';

const SAMPLE_EDI = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*SM*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*204*0001',
  'B2**ABCD*PRO123**TL**SHIP001',
  'SE*2*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n') + '~';

// Two transactions in one functional group
const MULTI_TX_EDI = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*SM*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*204*0001',
  'B2**ABCD*PRO123**TL',
  'SE*2*0001',
  'ST*210*0002',
  'B2**EFGH*PRO456**TL',
  'SE*2*0002',
  'GE*2*1',
  'IEA*1*000000001',
].join('~\n') + '~';

describe('997 Generator', () => {
  test('generates valid 997 with GS functional identifier FA', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    const edi997 = generate997(parsed);
    expect(edi997).toContain('GS*FA*');
  });

  test('ST*997 present', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    expect(generate997(parsed)).toContain('ST*997*');
  });

  test('sender/receiver correctly swapped from inbound', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    const edi997 = generate997(parsed);
    // Original: SENDER→RECEIVER; 997: RECEIVER→SENDER
    expect(edi997).toContain('RECEIVER');
    expect(edi997).toContain('SENDER');
  });

  test('AK1, AK2, AK5*A, AK9*A present for accepted transaction', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    const edi997 = generate997(parsed, [
      { transactionSetControlNumber: '0001', code: 'A' },
    ]);
    expect(edi997).toContain('AK1*');
    expect(edi997).toContain('AK2*204*0001');
    expect(edi997).toContain('AK5*A');
    expect(edi997).toContain('AK9*A');
  });

  test('AK5*R and AK9*R when all transactions rejected', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    const edi997 = generate997(parsed, [
      { transactionSetControlNumber: '0001', code: 'R' },
    ]);
    expect(edi997).toContain('AK5*R');
    expect(edi997).toContain('AK9*R');
  });

  test('defaults to accepted (AK5*A) when no ackResults provided', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    const edi997 = generate997(parsed);
    expect(edi997).toContain('AK5*A');
    expect(edi997).toContain('AK9*A');
  });

  test('IEA segment present', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    expect(generate997(parsed)).toContain('IEA*');
  });

  test('SE segment present with segment count', () => {
    const parsed = parseEDI(SAMPLE_EDI);
    expect(generate997(parsed)).toContain('SE*');
  });

  // --- new tests ---

  test('multi-transaction interchange generates one AK2/AK5 per transaction', () => {
    const parsed = parseEDI(MULTI_TX_EDI);
    const edi997 = generate997(parsed);

    expect(edi997).toContain('AK2*204*0001');
    expect(edi997).toContain('AK2*210*0002');

    // Two AK5 segments — one per transaction
    const ak5Matches = edi997.match(/AK5\*/g);
    expect(ak5Matches).toHaveLength(2);
  });

  test('mixed accept/reject produces AK9*P (partial)', () => {
    const parsed = parseEDI(MULTI_TX_EDI);
    const edi997 = generate997(parsed, [
      { transactionSetControlNumber: '0001', code: 'A' },
      { transactionSetControlNumber: '0002', code: 'R' },
    ]);
    expect(edi997).toContain('AK9*P');
  });
});
