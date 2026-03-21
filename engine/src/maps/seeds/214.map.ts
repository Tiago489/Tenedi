import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-214-inbound',
  transactionSet: '214',
  direction: 'inbound',
  mappings: [
    // Heading — B10 shipment begin segment
    { jediPath: 'heading.b10.b10_element_01', systemPath: 'shipment.referenceNumber' },
    { jediPath: 'heading.b10.b10_element_02', systemPath: 'shipment.scac' },
    { jediPath: 'heading.b10.b10_element_03', systemPath: 'shipment.inquiryRequestNumber' },
    // Detail — LX loop (LX is a DETAIL_START_TAG + LOOP_START_TAG → detail.lx_loop)
    { jediPath: 'detail.lx_loop.0.at7.at7_element_01', systemPath: 'status.0.shipmentStatusCode' },
    { jediPath: 'detail.lx_loop.0.at7.at7_element_02', systemPath: 'status.0.shipmentStatusReasonCode' },
    { jediPath: 'detail.lx_loop.0.at7.at7_element_04', systemPath: 'status.0.statusDate', transform: 'dateYYMMDD' },
    { jediPath: 'detail.lx_loop.0.at7.at7_element_05', systemPath: 'status.0.statusTime' },
    { jediPath: 'detail.lx_loop.0.ms1.ms1_element_01', systemPath: 'status.0.city' },
    { jediPath: 'detail.lx_loop.0.ms1.ms1_element_02', systemPath: 'status.0.state' },
  ],
});
