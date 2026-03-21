import { mapRegistry } from '../registry';

// systemJson schema for outbound 214 (shipment status update we send):
// {
//   shipment:  { referenceNumber, billOfLading, scac }  — B10
//   reference: { qualifier, number }                    — L11
//   status:    { code, reasonCode, date, time,          — AT7 + MS1
//                city, state }
//   weight:    { qualifier, unit, value, pieces }       — AT8
// }
//
// NOTE: All paths are flat seg.seg_element_NN.
// The current systemToJedi transform only supports flat segments.
// N1 party loops (consignee/shipper) are deferred until systemToJedi is extended.
// LX sequence segment is also deferred — AT7/AT8/MS1 are emitted without an LX wrapper.

mapRegistry.publish({
  id: 'seed-214-outbound',
  transactionSet: '214',
  direction: 'outbound',
  mappings: [
    // B10 — shipment identification
    { jediPath: 'b10.b10_element_01', systemPath: 'shipment.referenceNumber' },
    { jediPath: 'b10.b10_element_02', systemPath: 'shipment.billOfLading' },
    { jediPath: 'b10.b10_element_03', systemPath: 'shipment.scac' },
    // L11 — reference number (bill of lading cross-reference)
    { jediPath: 'l11.l11_element_01', systemPath: 'reference.number' },
    { jediPath: 'l11.l11_element_02', systemPath: 'reference.qualifier' },
    // AT7 — shipment status details
    { jediPath: 'at7.at7_element_01', systemPath: 'status.code' },
    { jediPath: 'at7.at7_element_02', systemPath: 'status.reasonCode' },
    { jediPath: 'at7.at7_element_05', systemPath: 'status.date' },
    { jediPath: 'at7.at7_element_06', systemPath: 'status.time' },
    // MS1 — city/state of shipment event
    { jediPath: 'ms1.ms1_element_01', systemPath: 'status.city' },
    { jediPath: 'ms1.ms1_element_02', systemPath: 'status.state' },
    // AT8 — weight and piece count
    { jediPath: 'at8.at8_element_01', systemPath: 'weight.qualifier' },
    { jediPath: 'at8.at8_element_02', systemPath: 'weight.unit' },
    { jediPath: 'at8.at8_element_03', systemPath: 'weight.value' },
    { jediPath: 'at8.at8_element_04', systemPath: 'weight.pieces' },
  ],
});
