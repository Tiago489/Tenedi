import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-211-inbound',
  transactionSet: '211',
  direction: 'inbound',
  mappings: [
    { jediPath: 'ms3.ms3_element_01', systemPath: 'bill.scac' },
    { jediPath: 'ms3.ms3_element_02', systemPath: 'bill.serviceCode' },
    { jediPath: 'ms3.ms3_element_03', systemPath: 'bill.standardPointLocationCode' },
    { jediPath: 'ms3.ms3_element_04', systemPath: 'bill.city' },
    { jediPath: 'ms3.ms3_element_05', systemPath: 'bill.stateCode' },
    { jediPath: 'n1_loop.0.n1.n1_element_02', systemPath: 'shipper.name' },
    { jediPath: 'n1_loop.0.n3.n3_element_01', systemPath: 'shipper.address' },
    { jediPath: 'n1_loop.0.n4.n4_element_01', systemPath: 'shipper.city' },
    { jediPath: 'n1_loop.1.n1.n1_element_02', systemPath: 'consignee.name' },
    { jediPath: 'l3.l3_element_01', systemPath: 'totals.weight' },
    { jediPath: 'l3.l3_element_05', systemPath: 'totals.charges', transform: 'toNumber' },
  ],
});
