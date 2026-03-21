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

// EDI with S5 before N1 so N1 goes to detail, with L5/AT8/L4 inside n1_loop
const SAMPLE_204_DETAIL_N1 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*SM*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*204*0001',
  'B2**FXNL**BOL123**TL',
  'S5*1*PU',
  'N1*SH*Acme Shipper',
  'N3*123 Main St',
  'N4*Chicago*IL*60601*US',
  'L5*1*General Freight***PKG',
  'AT8*G*L*500*10',
  'L4*12*8*6',
  'SE*9*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n') + '~';

const TEST_MAP_DETAIL_N1: TransformMap = {
  id: 'test-204-detail-n1',
  transactionSet: '204',
  direction: 'inbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'heading.b2.b2_element_02', systemPath: 'standardCarrierAlphaCode' },
    { jediPath: 'heading.b2.b2_element_04', systemPath: 'order.standardOrderFields.shipperBillOfLadingNumber' },
    { jediPath: 'detail.n1_loop.0.n1.n1_element_02', systemPath: 'shipperInformation.name' },
    { jediPath: 'detail.n1_loop.0.l5.l5_element_02', systemPath: 'packages.0.description' },
    { jediPath: 'detail.n1_loop.0.l5.l5_element_05', systemPath: 'packages.0.packageType' },
    { jediPath: 'detail.n1_loop.0.at8.at8_element_03', systemPath: 'packages.0.weight', transform: 'toNumber' },
    { jediPath: 'detail.n1_loop.0.at8.at8_element_04', systemPath: 'packages.0.quantity', transform: 'toNumber' },
    { jediPath: 'detail.n1_loop.0.l4.l4_element_01', systemPath: 'packages.0.length', transform: 'toNumber' },
    { jediPath: 'detail.n1_loop.0.l4.l4_element_02', systemPath: 'packages.0.width', transform: 'toNumber' },
    { jediPath: 'detail.n1_loop.0.l4.l4_element_03', systemPath: 'packages.0.height', transform: 'toNumber' },
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

  test('toNumber transform returns typeof number not string', () => {
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

describe('Pipeline — detail n1_loop structure (N1 after S5)', () => {
  test('n1_loop at detail level resolves shipper name', () => {
    const parsed = parseEDI(SAMPLE_204_DETAIL_N1);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_DETAIL_N1) as Record<string, unknown>;
    expect((result as Record<string, Record<string, unknown>>).shipperInformation?.name).toBe('Acme Shipper');
  });

  test('l5 as direct child of n1_loop entry resolves description and packageType', () => {
    const parsed = parseEDI(SAMPLE_204_DETAIL_N1);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_DETAIL_N1) as Record<string, unknown>;
    const packages = (result as Record<string, Record<string, unknown>[]>).packages;
    expect(packages[0].description).toBe('General Freight');
    expect(packages[0].packageType).toBe('PKG');
  });

  test('at8 as direct child of n1_loop entry resolves weight and quantity as numbers', () => {
    const parsed = parseEDI(SAMPLE_204_DETAIL_N1);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_DETAIL_N1) as Record<string, unknown>;
    const packages = (result as Record<string, Record<string, unknown>[]>).packages;
    expect(packages[0].weight).toBe(500);
    expect(typeof packages[0].weight).toBe('number');
    expect(packages[0].quantity).toBe(10);
  });

  test('l4 as direct child of n1_loop entry resolves dimensions as numbers', () => {
    const parsed = parseEDI(SAMPLE_204_DETAIL_N1);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_DETAIL_N1) as Record<string, unknown>;
    const packages = (result as Record<string, Record<string, unknown>[]>).packages;
    expect(packages[0].length).toBe(12);
    expect(packages[0].width).toBe(8);
    expect(packages[0].height).toBe(6);
  });

  test('nested systemPath order.standardOrderFields.shipperBillOfLadingNumber resolves correctly', () => {
    const parsed = parseEDI(SAMPLE_204_DETAIL_N1);
    const tx = parsed.interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_DETAIL_N1) as Record<string, unknown>;
    const order = (result as Record<string, Record<string, Record<string, unknown>>>).order;
    expect(order?.standardOrderFields?.shipperBillOfLadingNumber).toBe('BOL123');
  });
});
