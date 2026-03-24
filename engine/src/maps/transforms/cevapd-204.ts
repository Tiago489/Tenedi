import { get } from 'lodash';
import type { ParsedEDI } from '../../types/jedi';

/**
 * CEVA-IBM for Sierra Airfreight — 204 Inbound custom transform.
 *
 * This transform implements the full business logic from the real Stedi mapping
 * including conditional branching (FBTC vs non-FBTC), qualifier-based segment
 * filtering (L11 by "2I", G62 by "69"/"70"), S5 stop-reason lookups, and
 * the CFM_ shipper exclusion rule.
 */
export function transformCevapd204(parsed: ParsedEDI): Record<string, unknown> {
  const isa = parsed.interchange.interchange_control_header_ISA;
  const gs = parsed.interchange.functional_groups[0].functional_group_header_GS;
  const tx = parsed.interchange.functional_groups[0].transactions[0];

  const heading = tx.heading ?? {};
  const detail = tx.detail ?? {};
  const summary = tx.summary ?? {};

  const scac = str(get(heading, 'b2.b2_element_02'));
  const envelopeSenderId = (isa.interchange_sender_id_06 ?? '').trim();
  const receiverId = (isa.interchange_receiver_id_08 ?? '').trim();

  // Find S5 stops by stop_reason_code (element 02)
  const s5Loop = asArray(get(detail, 's5_loop'));
  const ldStop = s5Loop.find(s => str(get(s, 's5.s5_element_02')) === 'LD') as Rec | undefined;
  const ulStop = s5Loop.find(s => str(get(s, 's5.s5_element_02')) === 'UL') as Rec | undefined;

  // --- Rule 1: senderId conditional ---
  const consigneeState = ulStop ? str(get(getN1(ulStop), 'n4.n4_element_02')) : '';
  const senderId = (scac === 'FBTC' && ['NY', 'MA'].includes(consigneeState))
    ? 'CEVAPDNY'
    : envelopeSenderId;

  // --- Rule 6/8: SCAC-based mawb and shipperBOL ---
  const oidElement02 = str(get(ldStop, 'oid_loop.0.oid.oid_element_02'));
  const ladElement13 = str(get(ldStop, 'lad.lad_element_13'));
  const mawb = scac === 'FBTC' ? ladElement13 : oidElement02;
  const shipperBOL = scac === 'FBTC' ? oidElement02 : ladElement13;

  // --- Rule 7: quinaryRefNumber = OID element 03 ---
  const quinaryRefNumber = str(get(ldStop, 'oid_loop.0.oid.oid_element_03'));

  // --- Rule 9/10: L11 qualifier "2I" filtering ---
  const tertiaryRefNumber = findByQualifier(ldStop, 'l11', 'l11_element_02', '2I', 'l11_element_01');
  const quaternaryRefNumber = findByQualifier(ulStop, 'l11', 'l11_element_02', '2I', 'l11_element_01');

  // --- Rule 11: G62 qualifier "69" → ISO date ---
  const deadlineDate = isoDate(findByQualifier(ldStop, 'g62', 'g62_element_01', '69', 'g62_element_02'));

  // --- Rule 14: consignee deadlineDate from G62 qualifier "70" → ISO date ---
  const consigneeDeadline = isoDate(findByQualifier(ulStop, 'g62', 'g62_element_01', '70', 'g62_element_02'));

  // --- Rule 13: shipperInformation — omit if N1 identification_code starts with CFM_ ---
  const ldN1 = getN1(ldStop);
  const includeShipper = ldN1 !== undefined && !str(get(ldN1, 'n1.n1_element_04')).startsWith('CFM_');

  // --- Rule 14: consigneeInformation ---
  const ulN1 = getN1(ulStop);
  const includeConsignee = ulN1 !== undefined && !str(get(ulN1, 'n1.n1_element_04')).startsWith('CFM_');

  // Build result
  const result: Record<string, unknown> = {
    senderId,
    receiverId,
    applicationSenderCode: gs.application_senders_code_02 ?? '',
    receiverSenderCode: gs.application_receivers_code_03 ?? '',
    usageIndicatorCode: 'P',
    transactionSetIdentifierCode: tx.transaction_set_header_ST.transaction_set_identifier_code_01,
    transactionSetPurposeCode: 'ORIGINAL',
    senderContactCode: scac,
    standardCarrierAlphaCode: scac,
    order: {
      mawb: mawb || undefined,
      isLineHaul: false,
      secondaryRefNumber: str(get(heading, 'b2.b2_element_04')) || undefined,
      tertiaryRefNumber: tertiaryRefNumber || undefined,
      quaternaryRefNumber: quaternaryRefNumber || undefined,
      quinaryRefNumber: quinaryRefNumber || undefined,
      paymentMethod: 'PREPAID_BY_SELLER',
      pickupOrDelivery: 'PICKUP_AND_DELIVERY',
      endStop: {},
      deadlineDate: deadlineDate || undefined,
      standardOrderFields: {
        shipperBillOfLadingNumber: shipperBOL || undefined,
      },
    },
  };

  if (includeShipper && ldN1) {
    result.shipperInformation = buildPartyInfo(ldN1, ldStop);
  }

  if (includeConsignee && ulN1) {
    result.consigneeInformation = {
      ...buildPartyInfo(ulN1, ulStop),
      deadlineDate: consigneeDeadline || undefined,
    };
  }

  result.packages = [{
    weight: num(get(summary, 'l3.l3_element_01')),
    quantity: num(get(summary, 'l3.l3_element_11')),
    packageType: 'PCS',
  }];

  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number {
  return parseFloat(String(v ?? '0')) || 0;
}

/** Normalize a value that may be a single object or an array into an array. */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v !== undefined && v !== null) return [v];
  return [];
}

/** Format YYYYMMDD → YYYY-MM-DD. Returns undefined for invalid input. */
function isoDate(d: string | undefined): string | undefined {
  if (!d || d.length < 8) return undefined;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

/** Get the first N1 loop entry from an S5 stop. */
function getN1(stop: Rec | undefined): Rec | undefined {
  if (!stop) return undefined;
  const n1Loop = get(stop, 'n1_loop') as Rec[] | undefined;
  return n1Loop?.[0];
}

/**
 * Find a segment in a stop by qualifier value.
 * E.g. findByQualifier(stop, 'l11', 'l11_element_02', '2I', 'l11_element_01')
 * searches stop.l11 (single or array) for the entry where element_02 = '2I'
 * and returns element_01.
 */
function findByQualifier(
  stop: Rec | undefined,
  segKey: string,
  qualifierField: string,
  qualifierValue: string,
  valueField: string,
): string | undefined {
  if (!stop) return undefined;
  const entries = asArray(stop[segKey]) as Rec[];
  const match = entries.find(e => e[qualifierField] === qualifierValue);
  return match ? str(match[valueField]) : undefined;
}

/** Build party info (shipper or consignee) from N1 loop data. */
function buildPartyInfo(n1Entry: Rec, stop: Rec | undefined): Rec {
  // deadlineDate from first G62 inside OID loop
  const oidG62s = asArray(get(stop, 'oid_loop.0.g62'));
  const deadlineRaw = oidG62s[0] ? str((oidG62s[0] as Rec).g62_element_02) : undefined;

  return {
    name: str(get(n1Entry, 'n1.n1_element_02')) || undefined,
    addressLine1: str(get(n1Entry, 'n3.n3_element_01')) || undefined,
    city: str(get(n1Entry, 'n4.n4_element_01')) || undefined,
    state: str(get(n1Entry, 'n4.n4_element_02')) || undefined,
    zip: str(get(n1Entry, 'n4.n4_element_03')) || undefined,
    country: str(get(n1Entry, 'n4.n4_element_04')) || undefined,
    contactName: str(get(n1Entry, 'g61.g61_element_02')) || undefined,
    contactPhone: str(get(n1Entry, 'g61.g61_element_04')) || undefined,
    deadlineDate: isoDate(deadlineRaw),
  };
}
