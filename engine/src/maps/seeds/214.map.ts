import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-214-inbound',
  transactionSet: '214',
  direction: 'inbound',
  mappings: [
    { jediPath: 'b10.b10_element_01', systemPath: 'shipment.referenceNumber' },
    { jediPath: 'b10.b10_element_02', systemPath: 'shipment.scac' },
    { jediPath: 'b10.b10_element_03', systemPath: 'shipment.standardCarrierAlphaCode' },
    { jediPath: 'lx_loop.0.at7.at7_element_01', systemPath: 'status.0.shipmentStatusCode' },
    { jediPath: 'lx_loop.0.at7.at7_element_02', systemPath: 'status.0.shipmentStatusReasonCode' },
    { jediPath: 'lx_loop.0.at7.at7_element_04', systemPath: 'status.0.statusDate', transform: 'dateYYMMDD' },
    { jediPath: 'lx_loop.0.at7.at7_element_05', systemPath: 'status.0.statusTime' },
    { jediPath: 'lx_loop.0.ms1.ms1_element_01', systemPath: 'status.0.city' },
    { jediPath: 'lx_loop.0.ms1.ms1_element_02', systemPath: 'status.0.state' },
  ],
});
