import { mapRegistry } from '../registry';

mapRegistry.publish({
  id: 'cevapd-204-inbound',
  transactionSet: '204',
  direction: 'inbound',
  customTransformId: 'cevapd-204',
  dslSource: `# CEVAPD 204 Motor Carrier Load Tender — inbound (partner-specific)
# Uses custom transform: cevapd-204 (CEVA-IBM for Sierra Airfreight)
# Implements SCAC-conditional logic, qualifier filtering, CFM_ exclusion`,
  mappings: [], // mappings handled entirely by custom transform
});
