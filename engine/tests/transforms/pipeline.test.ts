import { parseEDI } from '../../src/transforms/edi-parser';
import { jediToSystem } from '../../src/transforms/jedi-to-system';
import type { TransformMap } from '../../src/types/maps';

const SAMPLE_204 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*SM*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*204*0001',
  'B2**ABCD*PRO123**TL**SHIP001',
  'N1*SH*Acme Shipper',
  'N3*123 Main Street',
  'N4*Chicago*IL*60601',
  'L3*1500*G***750.00',
  'SE*7*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n') + '~';

const TEST_MAP: TransformMap = {
  id: 'test-204',
  transactionSet: '204',
  direction: 'inbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'heading.b2.b2_element_02', systemPath: 'shipment.scac' },
    { jediPath: 'heading.b2.b2_element_03', systemPath: 'shipment.proNumber' },
    { jediPath: 'heading.b2.b2_element_05', systemPath: 'shipment.serviceCode' },
    { jediPath: 'heading.b2.b2_element_07', systemPath: 'shipment.shipmentId' },
    { jediPath: 'summary.l3.l3_element_01', systemPath: 'totals.weight', transform: 'toNumber' },
    { jediPath: 'nonexistent.path', systemPath: 'missing.field', default: 'DEFAULT_VAL' },
    { jediPath: 'truly.missing', systemPath: 'absent.field' },
  ],
};

describe('Full Pipeline', () => {
  test('raw EDI 204 -> parseEDI -> jediToSystem produces correct system JSON', () => {
    const parsed = parseEDI(SAMPLE_204);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP) as Record<string, Record<string, unknown>>;

    expect(result.shipment?.scac).toBe('ABCD');
    expect(result.shipment?.proNumber).toBe('PRO123');
    expect(result.shipment?.serviceCode).toBe('TL');
    expect(result.shipment?.shipmentId).toBe('SHIP001');
  });

  test('TransformFunctions.toNumber converts weight string to a number', () => {
    const parsed = parseEDI(SAMPLE_204);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP) as Record<string, Record<string, unknown>>;
    expect(typeof result.totals?.weight).toBe('number');
  });

  test('missing JEDI path uses default value from mapping', () => {
    const parsed = parseEDI(SAMPLE_204);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP) as Record<string, Record<string, unknown>>;
    expect(result.missing?.field).toBe('DEFAULT_VAL');
  });

  test('missing JEDI path with no default is omitted from output', () => {
    const parsed = parseEDI(SAMPLE_204);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP) as Record<string, Record<string, unknown>>;
    expect(result.absent?.field).toBeUndefined();
  });

  test('TransformFunctions.dateYYMMDD converts YYYYMMDD to YYYY-MM-DD', () => {
    const { TransformFunctions } = require('../../src/types/maps');
    expect(TransformFunctions.dateYYMMDD('20231016')).toBe('2023-10-16');
  });

  test('TransformFunctions.toUpperCase converts correctly', () => {
    const { TransformFunctions } = require('../../src/types/maps');
    expect(TransformFunctions.toUpperCase('hello')).toBe('HELLO');
  });
});
