import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-990-outbound',
  transactionSet: '990',
  direction: 'outbound',
  mappings: [
    { jediPath: 'b1.b1_element_01', systemPath: 'response.scac' },
    { jediPath: 'b1.b1_element_02', systemPath: 'response.shipmentIdentificationNumber' },
    { jediPath: 'b1.b1_element_03', systemPath: 'response.shipmentMethodOfPayment' },
    { jediPath: 'b1.b1_element_04', systemPath: 'response.tenderActionCode' },
    { jediPath: 'n1_loop.0.n1.n1_element_01', systemPath: 'shipper.entityCode' },
    { jediPath: 'n1_loop.0.n1.n1_element_02', systemPath: 'shipper.name' },
    { jediPath: 'n1_loop.1.n1.n1_element_01', systemPath: 'consignee.entityCode' },
    { jediPath: 'n1_loop.1.n1.n1_element_02', systemPath: 'consignee.name' },
  ],
});
