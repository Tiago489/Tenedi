import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-210-inbound',
  transactionSet: '210',
  direction: 'inbound',
  mappings: [
    // Heading — B3 invoice header (B3 is not a loop/detail-start tag → stays in heading)
    { jediPath: 'heading.b3.b3_element_02', systemPath: 'invoice.proNumber' },
    { jediPath: 'heading.b3.b3_element_03', systemPath: 'invoice.referenceNumber' },
    { jediPath: 'heading.b3.b3_element_04', systemPath: 'invoice.serviceCode' },
    { jediPath: 'heading.b3.b3_element_05', systemPath: 'invoice.shipmentDate', transform: 'dateYYMMDD' },
    { jediPath: 'heading.b3.b3_element_06', systemPath: 'invoice.totalCharges', transform: 'toNumber' },
    // Heading — N1 loop (N1 in heading before any LX → heading.n1_loop)
    { jediPath: 'heading.n1_loop.0.n1.n1_element_01', systemPath: 'payer.entityCode' },
    { jediPath: 'heading.n1_loop.0.n1.n1_element_02', systemPath: 'payer.name' },
    { jediPath: 'heading.n1_loop.1.n1.n1_element_01', systemPath: 'payee.entityCode' },
    { jediPath: 'heading.n1_loop.1.n1.n1_element_02', systemPath: 'payee.name' },
    // Detail — LX loop (LX is a DETAIL_START_TAG + LOOP_START_TAG → detail.lx_loop)
    { jediPath: 'detail.lx_loop.0.l5.l5_element_02', systemPath: 'lineItems.0.description' },
    { jediPath: 'detail.lx_loop.0.l0.l0_element_01', systemPath: 'lineItems.0.billedRating' },
    // Summary — L3 totals (L3 is a SUMMARY_START_TAG)
    { jediPath: 'summary.l3.l3_element_01', systemPath: 'totals.weight' },
    { jediPath: 'summary.l3.l3_element_05', systemPath: 'totals.charges', transform: 'toNumber' },
  ],
});
