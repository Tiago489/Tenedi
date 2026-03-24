import { parseEDI } from '../../src/transforms/edi-parser';
import { jediToSystem } from '../../src/transforms/jedi-to-system';
import { systemToJedi } from '../../src/transforms/system-to-jedi';
import type { TransformMap } from '../../src/types/maps';
import type { RawSegment } from '../../src/types/jedi';
import { MapRegistry } from '../../src/maps/registry';

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
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n1.n1_element_02', systemPath: 'shipperInformation.name' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l5.l5_element_02', systemPath: 'packages.0.description' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l5.l5_element_05', systemPath: 'packages.0.packageType' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.at8.at8_element_03', systemPath: 'packages.0.weight', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.at8.at8_element_04', systemPath: 'packages.0.quantity', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l4.l4_element_01', systemPath: 'packages.0.length', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l4.l4_element_02', systemPath: 'packages.0.width', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l4.l4_element_03', systemPath: 'packages.0.height', transform: 'toNumber' },
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

// ─── Outbound: systemToJedi ──────────────────────────────────────────────────
// These tests confirm that systemJson → systemToJedi → RawSegment[] produces
// the correct segment tags and element positions for each outbound seed schema.

const OUTBOUND_MAP_990: TransformMap = {
  id: 'test-990-outbound',
  transactionSet: '990',
  direction: 'outbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    // Matches the production seed exactly — heading-prefixed paths, order.* schema
    { jediPath: 'heading.b1.b1_element_01', systemPath: 'order.SCAC' },
    { jediPath: 'heading.b1.b1_element_02', systemPath: 'order.standardOrderFields.shipperBillOfLadingNumber' },
    { jediPath: 'heading.b1.b1_element_03', systemPath: 'order.date' },
    { jediPath: 'heading.b1.b1_element_04', systemPath: 'order.action', transform: 'reservationActionCode' },
    { jediPath: 'heading.n9.n9_element_01', systemPath: 'order.reference.qualifier', default: 'CN' },
    { jediPath: 'heading.n9.n9_element_02', systemPath: 'order.id' },
  ],
};

const OUTBOUND_MAP_214: TransformMap = {
  id: 'test-214-outbound',
  transactionSet: '214',
  direction: 'outbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'b10.b10_element_01', systemPath: 'shipment.referenceNumber' },
    { jediPath: 'b10.b10_element_02', systemPath: 'shipment.billOfLading' },
    { jediPath: 'b10.b10_element_03', systemPath: 'shipment.scac' },
    { jediPath: 'l11.l11_element_01', systemPath: 'reference.number' },
    { jediPath: 'l11.l11_element_02', systemPath: 'reference.qualifier' },
    { jediPath: 'at7.at7_element_01', systemPath: 'status.code' },
    { jediPath: 'at7.at7_element_02', systemPath: 'status.reasonCode' },
    { jediPath: 'at7.at7_element_05', systemPath: 'status.date' },
    { jediPath: 'at7.at7_element_06', systemPath: 'status.time' },
    { jediPath: 'ms1.ms1_element_01', systemPath: 'status.city' },
    { jediPath: 'ms1.ms1_element_02', systemPath: 'status.state' },
    { jediPath: 'at8.at8_element_01', systemPath: 'weight.qualifier' },
    { jediPath: 'at8.at8_element_02', systemPath: 'weight.unit' },
    { jediPath: 'at8.at8_element_03', systemPath: 'weight.value' },
    { jediPath: 'at8.at8_element_04', systemPath: 'weight.pieces' },
  ],
};

const OUTBOUND_MAP_210: TransformMap = {
  id: 'test-210-outbound',
  transactionSet: '210',
  direction: 'outbound',
  version: 1,
  publishedAt: new Date(),
  mappings: [
    { jediPath: 'b3.b3_element_02', systemPath: 'invoice.invoiceNumber' },
    { jediPath: 'b3.b3_element_03', systemPath: 'invoice.shipmentId' },
    { jediPath: 'b3.b3_element_04', systemPath: 'invoice.paymentMethod' },
    { jediPath: 'b3.b3_element_06', systemPath: 'invoice.invoiceDate' },
    { jediPath: 'b3.b3_element_07', systemPath: 'invoice.totalCharges' },
    { jediPath: 'b3.b3_element_09', systemPath: 'invoice.deliveryDate' },
    { jediPath: 'b3.b3_element_11', systemPath: 'invoice.scac' },
    { jediPath: 'c3.c3_element_01', systemPath: 'currency' },
    { jediPath: 'n9.n9_element_01', systemPath: 'reference.qualifier' },
    { jediPath: 'n9.n9_element_02', systemPath: 'reference.number' },
    { jediPath: 'l3.l3_element_01', systemPath: 'totals.weight' },
    { jediPath: 'l3.l3_element_02', systemPath: 'totals.weightQualifier' },
    { jediPath: 'l3.l3_element_05', systemPath: 'totals.charges' },
  ],
};

describe('Outbound Pipeline — 990 systemToJedi', () => {
  // Sample order payload matching the order.* systemPath schema.
  // action is passed as the human-readable label; reservationActionCode
  // transform must map it to the X12 code before it reaches the segment.
  const orderPayload = {
    order: {
      SCAC: 'PAAF',
      standardOrderFields: { shipperBillOfLadingNumber: '401783612' },
      date: '20260321',
      action: 'ACCEPTED',   // transform: 'reservationActionCode' → 'A'
      id: '401783612',
      // reference.qualifier omitted — default 'CN' should fill it
    },
  };

  let segments: RawSegment[];
  beforeAll(() => { segments = systemToJedi(orderPayload, OUTBOUND_MAP_990); });

  test('emits B1 with SCAC, BOL number, date, action code', () => {
    const b1 = segments.find(s => s.tag === 'B1');
    expect(b1).toBeDefined();
    expect(b1!.elements[0]).toBe('PAAF');        // B1_01 SCAC
    expect(b1!.elements[1]).toBe('401783612');   // B1_02 BOL number
    expect(b1!.elements[2]).toBe('20260321');    // B1_03 date
    expect(b1!.elements[3]).toBe('A');           // B1_04 action code
  });

  test('emits N9 with default CN qualifier and order id', () => {
    const n9 = segments.find(s => s.tag === 'N9');
    expect(n9).toBeDefined();
    expect(n9!.elements[0]).toBe('CN');          // N9_01 qualifier (default)
    expect(n9!.elements[1]).toBe('401783612');   // N9_02 order id
  });

  test('N9 qualifier uses explicit value when provided, not the default', () => {
    const withQualifier = {
      order: { ...orderPayload.order, reference: { qualifier: 'BM' } },
    };
    const result = systemToJedi(withQualifier, OUTBOUND_MAP_990);
    const n9 = result.find(s => s.tag === 'N9');
    expect(n9!.elements[0]).toBe('BM');
  });

  test('segment order is B1 then N9', () => {
    const tags = segments.map(s => s.tag);
    expect(tags.indexOf('B1')).toBeLessThan(tags.indexOf('N9'));
  });

  test('heading-prefixed jediPaths produce correct uppercase tags (not HEADING)', () => {
    const tags = segments.map(s => s.tag);
    expect(tags).not.toContain('HEADING');
    expect(tags).toContain('B1');
    expect(tags).toContain('N9');
  });
});

describe('Outbound Pipeline — 214 systemToJedi', () => {
  const systemJson = {
    shipment: { referenceNumber: '4655745', billOfLading: 'S2601374963', scac: 'MPXE' },
    reference: { qualifier: 'TN', number: 'S2601374963' },
    status: { code: 'P1', reasonCode: 'NS', date: '20260321', time: '0814', city: 'LOS ANGELES', state: 'CA' },
    weight: { qualifier: 'G', unit: 'L', value: '18', pieces: '1' },
  };

  let segments: RawSegment[];
  beforeAll(() => { segments = systemToJedi(systemJson, OUTBOUND_MAP_214); });

  test('emits B10 with referenceNumber, billOfLading, scac', () => {
    const b10 = segments.find(s => s.tag === 'B10');
    expect(b10).toBeDefined();
    expect(b10!.elements[0]).toBe('4655745');
    expect(b10!.elements[1]).toBe('S2601374963');
    expect(b10!.elements[2]).toBe('MPXE');
  });

  test('emits L11 with number at element_01 and qualifier at element_02', () => {
    const l11 = segments.find(s => s.tag === 'L11');
    expect(l11).toBeDefined();
    expect(l11!.elements[0]).toBe('S2601374963');
    expect(l11!.elements[1]).toBe('TN');
  });

  test('emits AT7 with status code, reasonCode, date, time at correct positions', () => {
    const at7 = segments.find(s => s.tag === 'AT7');
    expect(at7).toBeDefined();
    expect(at7!.elements[0]).toBe('P1');   // element_01
    expect(at7!.elements[1]).toBe('NS');   // element_02
    expect(at7!.elements[2]).toBe('');     // element_03 (empty)
    expect(at7!.elements[3]).toBe('');     // element_04 (empty)
    expect(at7!.elements[4]).toBe('20260321'); // element_05
    expect(at7!.elements[5]).toBe('0814');     // element_06
  });

  test('emits MS1 with city and state', () => {
    const ms1 = segments.find(s => s.tag === 'MS1');
    expect(ms1).toBeDefined();
    expect(ms1!.elements[0]).toBe('LOS ANGELES');
    expect(ms1!.elements[1]).toBe('CA');
  });

  test('emits AT8 with weight qualifier, unit, value, pieces', () => {
    const at8 = segments.find(s => s.tag === 'AT8');
    expect(at8).toBeDefined();
    expect(at8!.elements[0]).toBe('G');
    expect(at8!.elements[1]).toBe('L');
    expect(at8!.elements[2]).toBe('18');
    expect(at8!.elements[3]).toBe('1');
  });
});

describe('Outbound Pipeline — 210 systemToJedi', () => {
  const systemJson = {
    invoice: {
      invoiceNumber: 'BTX001INV7',
      shipmentId: 'GSO20008906',
      paymentMethod: 'PP',
      invoiceDate: '20260320',
      totalCharges: '10990',
      deliveryDate: '20260320',
      scac: 'GVTT',
    },
    currency: 'USD',
    reference: { qualifier: 'BM', number: 'GSO20008906' },
    totals: { weight: '849', weightQualifier: 'G', charges: '10990' },
  };

  let segments: RawSegment[];
  beforeAll(() => { segments = systemToJedi(systemJson, OUTBOUND_MAP_210); });

  test('emits B3 with correct element positions (02–11)', () => {
    const b3 = segments.find(s => s.tag === 'B3');
    expect(b3).toBeDefined();
    expect(b3!.elements[0]).toBe('');              // element_01 empty
    expect(b3!.elements[1]).toBe('BTX001INV7');    // element_02 invoiceNumber
    expect(b3!.elements[2]).toBe('GSO20008906');   // element_03 shipmentId
    expect(b3!.elements[3]).toBe('PP');            // element_04 paymentMethod
    expect(b3!.elements[4]).toBe('');              // element_05 empty
    expect(b3!.elements[5]).toBe('20260320');      // element_06 invoiceDate
    expect(b3!.elements[6]).toBe('10990');         // element_07 totalCharges
    expect(b3!.elements[7]).toBe('');              // element_08 empty
    expect(b3!.elements[8]).toBe('20260320');      // element_09 deliveryDate
    expect(b3!.elements[9]).toBe('');              // element_10 empty
    expect(b3!.elements[10]).toBe('GVTT');         // element_11 scac
  });

  test('emits C3 with currency code', () => {
    const c3 = segments.find(s => s.tag === 'C3');
    expect(c3).toBeDefined();
    expect(c3!.elements[0]).toBe('USD');
  });

  test('emits N9 with BM qualifier and bill of lading number', () => {
    const n9 = segments.find(s => s.tag === 'N9');
    expect(n9).toBeDefined();
    expect(n9!.elements[0]).toBe('BM');
    expect(n9!.elements[1]).toBe('GSO20008906');
  });

  test('emits L3 with weight at element_01, qualifier at element_02, charges at element_05', () => {
    const l3 = segments.find(s => s.tag === 'L3');
    expect(l3).toBeDefined();
    expect(l3!.elements[0]).toBe('849');           // element_01 weight
    expect(l3!.elements[1]).toBe('G');             // element_02 weightQualifier
    expect(l3!.elements[2]).toBe('');              // element_03 empty
    expect(l3!.elements[3]).toBe('');              // element_04 empty
    expect(l3!.elements[4]).toBe('10990');         // element_05 charges
  });

  test('segment insertion order: B3, C3, N9, L3', () => {
    const tags = segments.map(s => s.tag);
    expect(tags.indexOf('B3')).toBeLessThan(tags.indexOf('C3'));
    expect(tags.indexOf('C3')).toBeLessThan(tags.indexOf('N9'));
    expect(tags.indexOf('N9')).toBeLessThan(tags.indexOf('L3'));
  });
});

// ── Partner-specific map lookup ──────────────────────────────────────────────

describe('Partner-specific map lookup', () => {
  const registry = new MapRegistry();

  beforeAll(() => {
    // Publish default 204 inbound map
    registry.publish({
      id: 'seed-204-inbound',
      transactionSet: '204',
      direction: 'inbound',
      dslSource: '# default 204',
      mappings: [{ jediPath: 'heading.b2.b2_element_02', systemPath: 'standardCarrierAlphaCode' }],
    });

    // Publish CEVAPD partner-specific 204 inbound map
    registry.publish({
      id: 'cevapd-204-inbound',
      transactionSet: '204',
      direction: 'inbound',
      dslSource: '# cevapd 204',
      mappings: [{ jediPath: 'detail.s5_loop.0.n1_loop.0.n1.n1_element_02', systemPath: 'shipperInformation.name' }],
    });
  });

  test('getForPartner returns cevapd-204-inbound map for CEVAPD', () => {
    const map = registry.getForPartner('204', 'inbound', 'CEVAPD');
    expect(map.id).toBe('cevapd-204-inbound');
  });

  test('getForPartner returns default 204 map for EFWW', () => {
    const map = registry.getForPartner('204', 'inbound', 'EFWW');
    expect(map.id).toBe('seed-204-inbound');
  });

  test('getForPartner falls back to default when partnerId is empty', () => {
    const map = registry.getForPartner('204', 'inbound', '');
    expect(map.id).toBe('seed-204-inbound');
  });

  test('getForPartner falls back to default for UNKNOWN partner', () => {
    const map = registry.getForPartner('204', 'inbound', 'UNKNOWN');
    expect(map.id).toBe('seed-204-inbound');
  });
});
