import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-210-inbound',
  transactionSet: '210',
  direction: 'inbound',
  mappings: [
    { jediPath: 'b3.b3_element_02', systemPath: 'invoice.proNumber' },
    { jediPath: 'b3.b3_element_03', systemPath: 'invoice.referenceNumber' },
    { jediPath: 'b3.b3_element_04', systemPath: 'invoice.serviceCode' },
    { jediPath: 'b3.b3_element_05', systemPath: 'invoice.shipmentDate', transform: 'dateYYMMDD' },
    { jediPath: 'b3.b3_element_06', systemPath: 'invoice.totalCharges', transform: 'toNumber' },
    { jediPath: 'n1_loop.0.n1.n1_element_01', systemPath: 'payer.entityCode' },
    { jediPath: 'n1_loop.0.n1.n1_element_02', systemPath: 'payer.name' },
    { jediPath: 'n1_loop.1.n1.n1_element_01', systemPath: 'payee.entityCode' },
    { jediPath: 'n1_loop.1.n1.n1_element_02', systemPath: 'payee.name' },
    { jediPath: 'lx_loop.0.l5.l5_element_02', systemPath: 'lineItems.0.description' },
    { jediPath: 'lx_loop.0.l0.l0_element_01', systemPath: 'lineItems.0.billedRating' },
    { jediPath: 'l3.l3_element_01', systemPath: 'totals.weight' },
    { jediPath: 'l3.l3_element_05', systemPath: 'totals.charges', transform: 'toNumber' },
  ],
});
