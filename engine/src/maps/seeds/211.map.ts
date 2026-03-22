import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'seed-211-inbound',
  transactionSet: '211',
  direction: 'inbound',
  dslSource: `# 211 Motor Carrier Bill of Lading — inbound`,
  mappings: [
    // Root level
    { jediPath: 'transaction_set_header_ST.transaction_set_identifier_code_01', systemPath: 'transactionSetIdentifierCode' },
    { jediPath: 'heading.b2a.b2a_element_01', systemPath: 'transactionSetPurposeCode' },
    { jediPath: 'heading.bol.bol_element_01', systemPath: 'standardCarrierAlphaCode' },

    // Order fields — BOL segment
    { jediPath: 'heading.bol.bol_element_03', systemPath: 'order.standardOrderFields.shipperBillOfLadingNumber' },
    { jediPath: 'heading.g62.g62_element_02', systemPath: 'order.deadlineDate' },
    { jediPath: 'heading.l11.0.l11_element_01', systemPath: 'order.mawb' },             // qualifier MB — master BOL
    { jediPath: 'heading.l11.2.l11_element_01', systemPath: 'order.quaternaryRefNumber' }, // qualifier 55 — route/sequence
    { jediPath: 'heading.at5.at5_element_03', systemPath: 'order.serviceLevel' },        // THRESHOLD, WHITE GLOVE, etc.
    { jediPath: 'heading.k1.k1_element_01', systemPath: 'order.deliveryInstructions' },

    // Carrier / agent — N1 loop index 0 (qualifier CA)
    { jediPath: 'heading.n1_loop.0.n1.n1_element_02', systemPath: 'shipperInformation.name' },

    // Consignee — N1 loop index 1 (qualifier CN)
    { jediPath: 'heading.n1_loop.1.n1.n1_element_02', systemPath: 'consigneeInformation.name' },
    { jediPath: 'heading.n1_loop.1.n3.n3_element_01', systemPath: 'consigneeInformation.addressLine1' },
    { jediPath: 'heading.n1_loop.1.n4.n4_element_01', systemPath: 'consigneeInformation.city' },
    { jediPath: 'heading.n1_loop.1.n4.n4_element_02', systemPath: 'consigneeInformation.state' },
    { jediPath: 'heading.n1_loop.1.n4.n4_element_03', systemPath: 'consigneeInformation.zip' },
    { jediPath: 'heading.n1_loop.1.n4.n4_element_04', systemPath: 'consigneeInformation.country' },
    { jediPath: 'heading.n1_loop.1.g61.g61_element_02', systemPath: 'consigneeInformation.contactName' },
    { jediPath: 'heading.n1_loop.1.g61.g61_element_04', systemPath: 'consigneeInformation.contactPhone' },

    // Packages — AT4/AT2 are children of n1_loop.1 (appended after G61 in the same N1 loop entry)
    { jediPath: 'heading.n1_loop.1.at4.at4_element_01', systemPath: 'packages.0.description' },
    { jediPath: 'heading.n1_loop.1.at2.at2_element_02', systemPath: 'packages.0.packageType' },
    { jediPath: 'heading.n1_loop.1.at2.at2_element_05', systemPath: 'packages.0.weight', transform: 'toNumber' },
    { jediPath: 'heading.n1_loop.1.at2.at2_element_01', systemPath: 'packages.0.quantity', transform: 'toNumber' },
  ],
});
