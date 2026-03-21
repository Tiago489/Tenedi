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

// 210 — N1 loop in heading, LX loop in detail, L3 in summary
const SAMPLE_210 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*IM*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*210*0001',
  'B3**INVOICE001*REF456*TL*20231015*1500.00',
  'N1*BT*Payer Corp',
  'N1*SF*Payee LLC',
  'LX*1',
  'L5*1*Heavy Machinery',
  'L0*1**G*1000*LB',
  'L3*1000*G***1500.00',
  'SE*10*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n') + '~';

const TEST_MAP_210: TransformMap = {
  id: 'test-210',
  transactionSet: '210',
  direction: 'inbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'heading.b3.b3_element_02', systemPath: 'invoice.proNumber' },
    { jediPath: 'heading.b3.b3_element_04', systemPath: 'invoice.serviceCode' },
    { jediPath: 'heading.b3.b3_element_06', systemPath: 'invoice.totalCharges', transform: 'toNumber' },
    { jediPath: 'heading.n1_loop.0.n1.n1_element_01', systemPath: 'payer.entityCode' },
    { jediPath: 'heading.n1_loop.0.n1.n1_element_02', systemPath: 'payer.name' },
    { jediPath: 'heading.n1_loop.1.n1.n1_element_02', systemPath: 'payee.name' },
    { jediPath: 'detail.lx_loop.0.l5.l5_element_02', systemPath: 'lineItems.0.description' },
    { jediPath: 'detail.lx_loop.0.l0.l0_element_01', systemPath: 'lineItems.0.billedRating' },
    { jediPath: 'summary.l3.l3_element_01', systemPath: 'totals.weight', transform: 'toNumber' },
    { jediPath: 'summary.l3.l3_element_05', systemPath: 'totals.charges', transform: 'toNumber' },
  ],
};

// 214 — B10 in heading, LX loop in detail
const SAMPLE_214 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*QM*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*214*0001',
  'B10*SHIPREF001*FXNL*12345',
  'LX*1',
  'AT7*D1*NS**20231015*1200*CT',
  'MS1*Chicago*IL',
  'SE*7*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n') + '~';

const TEST_MAP_214: TransformMap = {
  id: 'test-214',
  transactionSet: '214',
  direction: 'inbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'heading.b10.b10_element_01', systemPath: 'shipment.referenceNumber' },
    { jediPath: 'heading.b10.b10_element_02', systemPath: 'shipment.scac' },
    { jediPath: 'heading.b10.b10_element_03', systemPath: 'shipment.inquiryRequestNumber' },
    { jediPath: 'detail.lx_loop.0.at7.at7_element_01', systemPath: 'status.0.shipmentStatusCode' },
    { jediPath: 'detail.lx_loop.0.at7.at7_element_02', systemPath: 'status.0.shipmentStatusReasonCode' },
    { jediPath: 'detail.lx_loop.0.at7.at7_element_04', systemPath: 'status.0.statusDate' },
    { jediPath: 'detail.lx_loop.0.ms1.ms1_element_01', systemPath: 'status.0.city' },
    { jediPath: 'detail.lx_loop.0.ms1.ms1_element_02', systemPath: 'status.0.state' },
  ],
};

// 211 — MS3 + N1 loop in heading, L3 in summary (no OID/LX → no detail section)
const SAMPLE_211 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *231015*1200*U*00401*000000001*0*P*>',
  'GS*BO*SENDER*RECEIVER*20231015*1200*1*X*004010',
  'ST*211*0001',
  'MS3*FXNL*D*11111*Chicago*IL',
  'N1*SH*Shipper Inc',
  'N3*456 Oak Ave',
  'N4*Dallas*TX*75201',
  'N1*CN*Consignee Co',
  'L3*500*G***750.00',
  'SE*9*0001',
  'GE*1*1',
  'IEA*1*000000001',
].join('~\n') + '~';

const TEST_MAP_211: TransformMap = {
  id: 'test-211',
  transactionSet: '211',
  direction: 'inbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'heading.ms3.ms3_element_01', systemPath: 'bill.scac' },
    { jediPath: 'heading.ms3.ms3_element_04', systemPath: 'bill.city' },
    { jediPath: 'heading.ms3.ms3_element_05', systemPath: 'bill.stateCode' },
    { jediPath: 'heading.n1_loop.0.n1.n1_element_02', systemPath: 'shipper.name' },
    { jediPath: 'heading.n1_loop.0.n3.n3_element_01', systemPath: 'shipper.address' },
    { jediPath: 'heading.n1_loop.0.n4.n4_element_01', systemPath: 'shipper.city' },
    { jediPath: 'heading.n1_loop.1.n1.n1_element_02', systemPath: 'consignee.name' },
    { jediPath: 'summary.l3.l3_element_01', systemPath: 'totals.weight', transform: 'toNumber' },
    { jediPath: 'summary.l3.l3_element_05', systemPath: 'totals.charges', transform: 'toNumber' },
  ],
};

describe('Pipeline — 210 section prefix paths', () => {
  test('heading.b3 fields resolve correctly', () => {
    const tx = parseEDI(SAMPLE_210).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_210) as Record<string, Record<string, unknown>>;
    expect(result.invoice?.proNumber).toBe('INVOICE001');
    expect(result.invoice?.serviceCode).toBe('TL');
    expect(result.invoice?.totalCharges).toBe(1500);
    expect(typeof result.invoice?.totalCharges).toBe('number');
  });

  test('heading.n1_loop resolves payer and payee', () => {
    const tx = parseEDI(SAMPLE_210).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_210) as Record<string, Record<string, unknown>>;
    expect(result.payer?.entityCode).toBe('BT');
    expect(result.payer?.name).toBe('Payer Corp');
    expect(result.payee?.name).toBe('Payee LLC');
  });

  test('detail.lx_loop resolves line item fields', () => {
    const tx = parseEDI(SAMPLE_210).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_210) as Record<string, Record<string, unknown>[]>;
    expect(result.lineItems?.[0]?.description).toBe('Heavy Machinery');
    expect(result.lineItems?.[0]?.billedRating).toBe('1');
  });

  test('summary.l3 resolves totals as numbers', () => {
    const tx = parseEDI(SAMPLE_210).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_210) as Record<string, Record<string, unknown>>;
    expect(result.totals?.weight).toBe(1000);
    expect(result.totals?.charges).toBe(1500);
  });
});

describe('Pipeline — 214 section prefix paths', () => {
  test('heading.b10 fields resolve correctly', () => {
    const tx = parseEDI(SAMPLE_214).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_214) as Record<string, Record<string, unknown>>;
    expect(result.shipment?.referenceNumber).toBe('SHIPREF001');
    expect(result.shipment?.scac).toBe('FXNL');
    expect(result.shipment?.inquiryRequestNumber).toBe('12345');
  });

  test('detail.lx_loop.at7 resolves status fields', () => {
    const tx = parseEDI(SAMPLE_214).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_214) as Record<string, Record<string, unknown>[]>;
    expect(result.status?.[0]?.shipmentStatusCode).toBe('D1');
    expect(result.status?.[0]?.shipmentStatusReasonCode).toBe('NS');
    expect(result.status?.[0]?.statusDate).toBe('20231015');
  });

  test('detail.lx_loop.ms1 resolves city and state', () => {
    const tx = parseEDI(SAMPLE_214).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_214) as Record<string, Record<string, unknown>[]>;
    expect(result.status?.[0]?.city).toBe('Chicago');
    expect(result.status?.[0]?.state).toBe('IL');
  });
});

describe('Pipeline — 211 section prefix paths', () => {
  test('heading.ms3 fields resolve correctly', () => {
    const tx = parseEDI(SAMPLE_211).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_211) as Record<string, Record<string, unknown>>;
    expect(result.bill?.scac).toBe('FXNL');
    expect(result.bill?.city).toBe('Chicago');
    expect(result.bill?.stateCode).toBe('IL');
  });

  test('heading.n1_loop resolves shipper and consignee', () => {
    const tx = parseEDI(SAMPLE_211).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_211) as Record<string, Record<string, unknown>>;
    expect(result.shipper?.name).toBe('Shipper Inc');
    expect(result.shipper?.address).toBe('456 Oak Ave');
    expect(result.shipper?.city).toBe('Dallas');
    expect(result.consignee?.name).toBe('Consignee Co');
  });

  test('summary.l3 resolves totals as numbers', () => {
    const tx = parseEDI(SAMPLE_211).interchange.functional_groups[0].transactions[0];
    const result = jediToSystem(tx, TEST_MAP_211) as Record<string, Record<string, unknown>>;
    expect(result.totals?.weight).toBe(500);
    expect(result.totals?.charges).toBe(750);
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
