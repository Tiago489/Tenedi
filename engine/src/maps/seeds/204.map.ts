import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-204-inbound',
  transactionSet: '204',
  direction: 'inbound',
  dslSource: `# 204 Motor Carrier Load Tender — inbound`,
  mappings: [
    // Root level
    { jediPath: 'transaction_set_header_ST.transaction_set_identifier_code_01', systemPath: 'transactionSetIdentifierCode' },
    { jediPath: 'heading.b2a.b2a_element_01', systemPath: 'transactionSetPurposeCode' },
    { jediPath: 'heading.b2.b2_element_02', systemPath: 'standardCarrierAlphaCode' },

    // Order fields
    { jediPath: 'heading.b2.b2_element_04', systemPath: 'order.standardOrderFields.shipperBillOfLadingNumber' },
    { jediPath: 'heading.g62.g62_element_02', systemPath: 'order.deadlineDate' },
    { jediPath: 'heading.l11.0.l11_element_01', systemPath: 'order.mawb' },
    { jediPath: 'heading.l11.1.l11_element_01', systemPath: 'order.serviceLevel' },
    { jediPath: 'heading.l11.2.l11_element_01', systemPath: 'order.quaternaryRefNumber' },

    // Shipper — N1 loop nested inside S5 loop index 0
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n1.n1_element_02', systemPath: 'shipperInformation.name' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n3.n3_element_01', systemPath: 'shipperInformation.addressLine1' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n4.n4_element_01', systemPath: 'shipperInformation.city' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n4.n4_element_02', systemPath: 'shipperInformation.state' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n4.n4_element_03', systemPath: 'shipperInformation.zip' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.n4.n4_element_04', systemPath: 'shipperInformation.country' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.g61.g61_element_02', systemPath: 'shipperInformation.contactName' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.g61.g61_element_04', systemPath: 'shipperInformation.contactPhone' },

    // Consignee — N1 loop nested inside S5 loop index 1
    { jediPath: 'detail.s5_loop.1.n1_loop.0.n1.n1_element_02', systemPath: 'consigneeInformation.name' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.n3.n3_element_01', systemPath: 'consigneeInformation.addressLine1' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.n4.n4_element_01', systemPath: 'consigneeInformation.city' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.n4.n4_element_02', systemPath: 'consigneeInformation.state' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.n4.n4_element_03', systemPath: 'consigneeInformation.zip' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.n4.n4_element_04', systemPath: 'consigneeInformation.country' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.g61.g61_element_02', systemPath: 'consigneeInformation.contactName' },
    { jediPath: 'detail.s5_loop.1.n1_loop.0.g61.g61_element_04', systemPath: 'consigneeInformation.contactPhone' },

    // Packages — L5/AT8/L4 inside N1 loop (within S5)
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l5.l5_element_02', systemPath: 'packages.0.description' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l5.l5_element_05', systemPath: 'packages.0.packageType' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.at8.at8_element_03', systemPath: 'packages.0.weight', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.at8.at8_element_04', systemPath: 'packages.0.quantity', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l4.l4_element_01', systemPath: 'packages.0.length', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l4.l4_element_02', systemPath: 'packages.0.width', transform: 'toNumber' },
    { jediPath: 'detail.s5_loop.0.n1_loop.0.l4.l4_element_03', systemPath: 'packages.0.height', transform: 'toNumber' },
  ],
});
