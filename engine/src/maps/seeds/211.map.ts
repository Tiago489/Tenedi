import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-211-inbound',
  transactionSet: '211',
  direction: 'inbound',
  mappings: [
    // Heading — MS3 routing segment (not a loop/detail-start tag → stays in heading)
    { jediPath: 'heading.ms3.ms3_element_01', systemPath: 'bill.scac' },
    { jediPath: 'heading.ms3.ms3_element_02', systemPath: 'bill.serviceCode' },
    { jediPath: 'heading.ms3.ms3_element_03', systemPath: 'bill.standardPointLocationCode' },
    { jediPath: 'heading.ms3.ms3_element_04', systemPath: 'bill.city' },
    { jediPath: 'heading.ms3.ms3_element_05', systemPath: 'bill.stateCode' },
    // Heading — N1 loop (N1 without a preceding OID/LX/S5 → heading.n1_loop)
    { jediPath: 'heading.n1_loop.0.n1.n1_element_02', systemPath: 'shipper.name' },
    { jediPath: 'heading.n1_loop.0.n3.n3_element_01', systemPath: 'shipper.address' },
    { jediPath: 'heading.n1_loop.0.n4.n4_element_01', systemPath: 'shipper.city' },
    { jediPath: 'heading.n1_loop.1.n1.n1_element_02', systemPath: 'consignee.name' },
    // Summary — L3 totals (L3 is a SUMMARY_START_TAG)
    { jediPath: 'summary.l3.l3_element_01', systemPath: 'totals.weight' },
    { jediPath: 'summary.l3.l3_element_05', systemPath: 'totals.charges', transform: 'toNumber' },
  ],
});
