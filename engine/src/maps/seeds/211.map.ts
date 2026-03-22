import { mapRegistry } from '../registry';

// TODO: The following fields require the $expr DSL keyword or new transform primitives
// and are intentionally left unmapped in this seed:
//
// packages.0.length / .width / .height
//   Source: heading.l11 entries with qualifier ZZ contain a dimension string like "P40L15W15H2".
//   Extracting individual dimensions requires regex capture ($extract transform or $expr).
//
// order.endStop.specialInstructions
//   Source: multiple heading.l11 entries with qualifier SI (e.g. L11[3], L11[4], …).
//   Combining them requires a $concat-where keyword or $expr over the l11 array.

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

    // Order fields
    { jediPath: 'heading.bol.bol_element_03', systemPath: 'order.standardOrderFields.shipperBillOfLadingNumber' },

    // MAWB — L11 with qualifier MB (index varies by file)
    // Use index 1 as most common position for MB qualifier
    { jediPath: 'heading.l11.1.l11_element_01', systemPath: 'order.mawb' },

    // Payment method
    { jediPath: 'heading.bol.bol_element_02', systemPath: 'order.paymentMethod', transform: 'paymentMethodCode' },

    // Service level from AT5
    { jediPath: 'heading.at5.at5_element_01', systemPath: 'order.pickupOrDelivery', transform: 'serviceLevel211' },

    // Shipper — N1 loop index 0 (SH qualifier)
    { jediPath: 'heading.n1_loop.0.n1.n1_element_02', systemPath: 'shipperInformation.name' },
    { jediPath: 'heading.n1_loop.0.n3.n3_element_01', systemPath: 'shipperInformation.addressLine1' },
    { jediPath: 'heading.n1_loop.0.n3.n3_element_02', systemPath: 'shipperInformation.addressLine2' },
    { jediPath: 'heading.n1_loop.0.n4.n4_element_01', systemPath: 'shipperInformation.city' },
    { jediPath: 'heading.n1_loop.0.n4.n4_element_02', systemPath: 'shipperInformation.state' },
    { jediPath: 'heading.n1_loop.0.n4.n4_element_03', systemPath: 'shipperInformation.zip' },
    { jediPath: 'heading.n1_loop.0.n4.n4_element_04', systemPath: 'shipperInformation.country' },
    { jediPath: 'heading.n1_loop.0.g61.0.g61_element_02', systemPath: 'shipperInformation.contactName' },
    { jediPath: 'heading.n1_loop.0.g61.0.g61_element_04', systemPath: 'shipperInformation.contactPhone' },

    // Consignee — N1 loop index 2 (actual consignee; index 1 is Forward Air intermediate carrier)
    { jediPath: 'heading.n1_loop.2.n1.n1_element_02', systemPath: 'consigneeInformation.name' },
    { jediPath: 'heading.n1_loop.2.n3.n3_element_01', systemPath: 'consigneeInformation.addressLine1' },
    { jediPath: 'heading.n1_loop.2.n3.n3_element_02', systemPath: 'consigneeInformation.addressLine2' },
    { jediPath: 'heading.n1_loop.2.n4.n4_element_01', systemPath: 'consigneeInformation.city' },
    { jediPath: 'heading.n1_loop.2.n4.n4_element_02', systemPath: 'consigneeInformation.state' },
    { jediPath: 'heading.n1_loop.2.n4.n4_element_03', systemPath: 'consigneeInformation.zip' },
    { jediPath: 'heading.n1_loop.2.n4.n4_element_04', systemPath: 'consigneeInformation.country' },
    { jediPath: 'heading.n1_loop.2.g61.0.g61_element_02', systemPath: 'consigneeInformation.contactName' },
    { jediPath: 'heading.n1_loop.2.g61.0.g61_element_04', systemPath: 'consigneeInformation.contactPhone' },

    // Packages from detail AT1 loop
    { jediPath: 'detail.at1_loop.0.at4.0.at4_element_01', systemPath: 'packages.0.description' },
    { jediPath: 'detail.at1_loop.0.at2_loop.0.at2.at2_element_05', systemPath: 'packages.0.weight', transform: 'toNumber' },
    { jediPath: 'detail.at1_loop.0.at2_loop.0.at2.at2_element_01', systemPath: 'packages.0.quantity', transform: 'toNumber' },
    { jediPath: 'detail.at1_loop.0.at2_loop.0.at2.at2_element_02', systemPath: 'packages.0.packageType' },
  ],
});
