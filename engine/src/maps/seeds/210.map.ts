import { mapRegistry } from '../registry';

// systemJson schema for outbound 210 (freight invoice we send):
// {
//   invoice:   { invoiceNumber, shipmentId, paymentMethod, — B3
//                invoiceDate, totalCharges, deliveryDate, scac }
//   currency:  string (e.g. "USD")                        — C3
//   reference: { qualifier, number }                      — N9
//   totals:    { weight, weightQualifier, charges }       — L3
// }
//
// B3 element positions verified against real production files:
//   B3_01: empty   B3_02: invoiceNumber   B3_03: shipmentId
//   B3_04: paymentMethod (PP=prepaid)     B3_05: empty
//   B3_06: invoiceDate   B3_07: totalCharges   B3_08: empty
//   B3_09: deliveryDate  B3_10: (rate code)   B3_11: scac
//
// NOTE: All paths are flat seg.seg_element_NN.
// The current systemToJedi transform only supports flat segments.
// LX line-item loops (L5/L1 per charge line) are deferred until systemToJedi is extended.

mapRegistry.publish({
  id: 'seed-210-outbound',
  transactionSet: '210',
  direction: 'outbound',
  mappings: [
    // B3 — invoice header
    { jediPath: 'b3.b3_element_02', systemPath: 'invoice.invoiceNumber' },
    { jediPath: 'b3.b3_element_03', systemPath: 'invoice.shipmentId' },
    { jediPath: 'b3.b3_element_04', systemPath: 'invoice.paymentMethod' },
    { jediPath: 'b3.b3_element_06', systemPath: 'invoice.invoiceDate' },
    { jediPath: 'b3.b3_element_07', systemPath: 'invoice.totalCharges' },
    { jediPath: 'b3.b3_element_09', systemPath: 'invoice.deliveryDate' },
    { jediPath: 'b3.b3_element_11', systemPath: 'invoice.scac' },
    // C3 — currency
    { jediPath: 'c3.c3_element_01', systemPath: 'currency' },
    // N9 — reference number (bill of lading)
    { jediPath: 'n9.n9_element_01', systemPath: 'reference.qualifier' },
    { jediPath: 'n9.n9_element_02', systemPath: 'reference.number' },
    // L3 — totals
    { jediPath: 'l3.l3_element_01', systemPath: 'totals.weight' },
    { jediPath: 'l3.l3_element_02', systemPath: 'totals.weightQualifier' },
    { jediPath: 'l3.l3_element_05', systemPath: 'totals.charges' },
  ],
});
