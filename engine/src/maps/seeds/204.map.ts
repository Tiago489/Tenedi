import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-204-inbound',
  transactionSet: '204',
  direction: 'inbound',
  dslSource: `# 204 Motor Carrier Load Tender — inbound`,
  mappings: [
    // Shipment header (B2)
    { jediPath: 'heading.b2.b2_element_02', systemPath: 'shipment.scac' },
    { jediPath: 'heading.b2.b2_element_04', systemPath: 'shipment.proNumber' },
    { jediPath: 'heading.b2.b2_element_06', systemPath: 'shipment.serviceCode' },

    // Pickup date (G62 in heading — date qualifier 64)
    { jediPath: 'heading.g62.g62_element_02', systemPath: 'shipment.pickupDate', transform: 'dateYYMMDD' },
    { jediPath: 'heading.g62.g62_element_04', systemPath: 'shipment.pickupTime' },

    // Reference numbers (L11)
    { jediPath: 'heading.l11.0.l11_element_01', systemPath: 'references.0.value' },
    { jediPath: 'heading.l11.0.l11_element_02', systemPath: 'references.0.qualifier' },

    // Stop 1 — pickup (S5 loop index 0)
    { jediPath: 'detail.s5_loop.0.s5.s5_element_01', systemPath: 'stops.0.stopSequence' },
    { jediPath: 'detail.s5_loop.0.s5.s5_element_02', systemPath: 'stops.0.stopReason' },
    { jediPath: 'detail.s5_loop.0.g62.0.g62_element_02', systemPath: 'stops.0.date', transform: 'dateYYMMDD' },
    { jediPath: 'detail.s5_loop.0.g62.0.g62_element_04', systemPath: 'stops.0.time' },

    // Stop 2 — delivery (S5 loop index 1)
    { jediPath: 'detail.s5_loop.1.s5.s5_element_01', systemPath: 'stops.1.stopSequence' },
    { jediPath: 'detail.s5_loop.1.s5.s5_element_02', systemPath: 'stops.1.stopReason' },

    // Shipper (N1 loop index 0, qualifier SH)
    { jediPath: 'detail.n1_loop.0.n1.n1_element_02', systemPath: 'shipper.name' },
    { jediPath: 'detail.n1_loop.0.n3.n3_element_01', systemPath: 'shipper.address' },
    { jediPath: 'detail.n1_loop.0.n4.n4_element_01', systemPath: 'shipper.city' },
    { jediPath: 'detail.n1_loop.0.n4.n4_element_02', systemPath: 'shipper.state' },
    { jediPath: 'detail.n1_loop.0.n4.n4_element_03', systemPath: 'shipper.zip' },
    { jediPath: 'detail.n1_loop.0.n4.n4_element_04', systemPath: 'shipper.country' },
    { jediPath: 'detail.n1_loop.0.g61.g61_element_04', systemPath: 'shipper.phone' },

    // Consignee (N1 loop index 1, qualifier CN)
    { jediPath: 'detail.n1_loop.1.n1.n1_element_02', systemPath: 'consignee.name' },
    { jediPath: 'detail.n1_loop.1.n3.n3_element_01', systemPath: 'consignee.address' },
    { jediPath: 'detail.n1_loop.1.n4.n4_element_01', systemPath: 'consignee.city' },
    { jediPath: 'detail.n1_loop.1.n4.n4_element_02', systemPath: 'consignee.state' },
    { jediPath: 'detail.n1_loop.1.n4.n4_element_03', systemPath: 'consignee.zip' },
    { jediPath: 'detail.n1_loop.1.n4.n4_element_04', systemPath: 'consignee.country' },
    { jediPath: 'detail.n1_loop.1.g61.g61_element_04', systemPath: 'consignee.phone' },

    // Commodity lines (L5 loop under first N1)
    { jediPath: 'detail.n1_loop.0.l5.0.l5_element_02', systemPath: 'lineItems.0.description' },
    { jediPath: 'detail.n1_loop.0.l5.1.l5_element_02', systemPath: 'lineItems.1.description' },

    // Weights (AT8 under first N1)
    { jediPath: 'detail.n1_loop.0.at8.0.at8_element_03', systemPath: 'lineItems.0.weight', transform: 'toNumber' },
    { jediPath: 'detail.n1_loop.0.at8.1.at8_element_03', systemPath: 'lineItems.1.weight', transform: 'toNumber' },

    // Totals (L3 in summary)
    { jediPath: 'summary.l3.l3_element_01', systemPath: 'totals.weight', transform: 'toNumber' },
    { jediPath: 'summary.l3.l3_element_11', systemPath: 'totals.pieces', transform: 'toNumber' },
  ],
});
