import { mapRegistry } from '../registry';

// systemJson schema for outbound 990 (tender response we send):
// {
//   response: { scac, shipmentId, date, actionCode }  — B1 header
//   reference: { qualifier, number }                  — N9 reference
// }
//
// NOTE: All paths are flat seg.seg_element_NN.
// The current systemToJedi transform only supports flat segments.
// N1 party loops are deferred until systemToJedi is extended.

mapRegistry.publish({
  id: 'seed-990-outbound',
  transactionSet: '990',
  direction: 'outbound',
  mappings: [
    // B1 — tender response header
    { jediPath: 'b1.b1_element_01', systemPath: 'response.scac' },
    { jediPath: 'b1.b1_element_02', systemPath: 'response.shipmentId' },
    { jediPath: 'b1.b1_element_03', systemPath: 'response.date' },
    { jediPath: 'b1.b1_element_04', systemPath: 'response.actionCode' },
    // N9 — reference identification
    { jediPath: 'n9.n9_element_01', systemPath: 'reference.qualifier' },
    { jediPath: 'n9.n9_element_02', systemPath: 'reference.number' },
  ],
});
