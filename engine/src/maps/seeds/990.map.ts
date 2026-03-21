import { mapRegistry } from '../registry';

// systemJson schema for outbound 990 (tender response we send):
// {
//   order: {
//     SCAC:   string,                                    — B1_01
//     standardOrderFields: { shipperBillOfLadingNumber } — B1_02
//     date:   string (YYYYMMDD),                         — B1_03
//     action: string (raw code — 'A'|'D'|'R'),           — B1_04
//     id:     string,                                    — N9_02
//     reference: { qualifier: 'CN' }                    — N9_01 (default CN)
//   }
// }
//
// Action code lookup ($lookup RESERVATION_ACTION_CODES) will be applied by
// the DSL compiler at runtime once the DSL authoring interface is built.
// The RESERVATION_ACTION_CODES reference table is seeded in Django (migration 0005).

mapRegistry.publish({
  id: 'seed-990-outbound',
  transactionSet: '990',
  direction: 'outbound',
  mappings: [
    // B1 — Beginning segment
    { jediPath: 'heading.b1.b1_element_01', systemPath: 'order.SCAC' },
    { jediPath: 'heading.b1.b1_element_02', systemPath: 'order.standardOrderFields.shipperBillOfLadingNumber' },
    { jediPath: 'heading.b1.b1_element_03', systemPath: 'order.date' },
    { jediPath: 'heading.b1.b1_element_04', systemPath: 'order.action' },
    // N9 — Reference identification (order ID with CN qualifier)
    { jediPath: 'heading.n9.n9_element_01', systemPath: 'order.reference.qualifier', default: 'CN' },
    { jediPath: 'heading.n9.n9_element_02', systemPath: 'order.id' },
  ],
});
