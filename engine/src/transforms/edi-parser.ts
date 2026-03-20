import pino from 'pino';
import type { JediInterchange, JediFunctionalGroup, JediTransaction, RawSegment, ParsedEDI } from '../types/jedi';

const logger = pino({ name: 'edi-parser' });

const DETAIL_START_TAGS = new Set(['OID', 'S5', 'LX', 'HL', 'IT1', 'PO1']);
const SUMMARY_START_TAGS = new Set(['L3', 'CTT', 'SE']);
const LOOP_START_TAGS = new Set(['N1', 'S5', 'OID', 'LX', 'HL']);

const ISA_FIELD_NAMES = [
  'authorization_information_qualifier_01',
  'authorization_information_02',
  'security_information_qualifier_03',
  'security_information_04',
  'interchange_id_qualifier_05',
  'interchange_sender_id_06',
  'interchange_id_qualifier_07',
  'interchange_receiver_id_08',
  'interchange_date_09',
  'interchange_time_10',
  'interchange_control_standards_identifier_11',
  'interchange_control_version_number_12',
  'interchange_control_number_13',
  'acknowledgment_requested_14',
  'usage_indicator_15',
  'component_element_separator_16',
];

const GS_FIELD_NAMES = [
  'functional_identifier_code_01',
  'application_senders_code_02',
  'application_receivers_code_03',
  'date_04',
  'time_05',
  'group_control_number_06',
  'responsible_agency_code_07',
  'version_release_industry_identifier_code_08',
];

export function parseEDI(raw: string): ParsedEDI {
  // Strip UTF-8 BOM if present
  raw = raw.replace(/^\uFEFF/, '');
  raw = raw.replace(/\r/g, '');

  if (!raw.trim().startsWith('ISA')) {
    throw new Error('Invalid EDI: document must start with ISA segment');
  }

  const elementSep = raw[3];
  const segmentTerminator = raw[105] ?? '~'; // ISA is exactly 106 chars

  const segments = raw
    .split(segmentTerminator)
    .map(s => s.replace(/\r?\n/g, '').trim())
    .filter(s => s.length > 0);

  const interchange = buildJediInterchange(segments, elementSep);
  const transactionSets = interchange.functional_groups
    .flatMap(fg => fg.transactions)
    .map(tx => tx.transaction_set_header_ST.transaction_set_identifier_code_01);

  logger.debug({ transactionSets }, 'Parsed EDI interchange');
  return { raw, interchange, transactionSets };
}

function buildJediInterchange(segments: string[], sep: string): JediInterchange {
  const isaParts = segments[0].split(sep);
  const interchangeHeader: Record<string, string> = {};
  ISA_FIELD_NAMES.forEach((name, idx) => {
    interchangeHeader[name] = isaParts[idx + 1] ?? '';
  });

  const functionalGroups: JediFunctionalGroup[] = [];
  let i = 1;

  while (i < segments.length) {
    const tag = getTag(segments[i], sep);
    if (tag === 'GS') {
      const { group, consumed } = buildFunctionalGroup(segments, i, sep);
      functionalGroups.push(group);
      i += consumed;
    } else if (tag === 'IEA') {
      break;
    } else {
      i++;
    }
  }

  const ieaSeg = segments.find(s => getTag(s, sep) === 'IEA');
  const ieaFields: Record<string, string> = {};
  if (ieaSeg) {
    const parts = ieaSeg.split(sep);
    ieaFields['number_of_included_functional_groups_01'] = parts[1] ?? '';
    ieaFields['interchange_control_number_02'] = parts[2] ?? '';
  }

  return {
    interchange_control_header_ISA: interchangeHeader,
    functional_groups: functionalGroups,
    interchange_control_trailer_IEA: ieaFields,
  };
}

function buildFunctionalGroup(segments: string[], startIdx: number, sep: string): { group: JediFunctionalGroup; consumed: number } {
  const gsParts = segments[startIdx].split(sep);
  const gsHeader: Record<string, string> = {};
  GS_FIELD_NAMES.forEach((name, idx) => {
    gsHeader[name] = gsParts[idx + 1] ?? '';
  });

  const transactions: JediTransaction[] = [];
  let i = startIdx + 1;

  while (i < segments.length) {
    const tag = getTag(segments[i], sep);
    if (tag === 'ST') {
      const { tx, consumed } = buildTransaction(segments, i, sep);
      transactions.push(tx);
      i += consumed;
    } else if (tag === 'GE') {
      i++;
      break;
    } else {
      i++;
    }
  }

  const geParts = (segments[i - 1] ?? '').split(sep);
  const geFields: Record<string, string> = {
    number_of_transaction_sets_included_01: geParts[1] ?? '',
    group_control_number_02: geParts[2] ?? '',
  };

  return {
    group: {
      functional_group_header_GS: gsHeader,
      transactions,
      functional_group_trailer_GE: geFields,
    },
    consumed: i - startIdx,
  };
}

function buildTransaction(segments: string[], startIdx: number, sep: string): { tx: JediTransaction; consumed: number } {
  const stParts = segments[startIdx].split(sep);
  const stHeader = {
    transaction_set_identifier_code_01: stParts[1] ?? '',
    transaction_set_control_number_02: stParts[2] ?? '',
  };

  const rawSegments: RawSegment[] = [];
  const heading: Record<string, unknown> = {};
  const detail: Record<string, unknown> = {};
  const summary: Record<string, unknown> = {};

  let section: 'heading' | 'detail' | 'summary' = 'heading';
  let seTrailer: Record<string, string> = {};
  let i = startIdx + 1;
  let currentLoopId: string | undefined;

  while (i < segments.length) {
    const segStr = segments[i];
    const tag = getTag(segStr, sep);

    if (tag === 'SE') {
      const parts = segStr.split(sep);
      seTrailer = {
        number_of_included_segments_01: parts[1] ?? '',
        transaction_set_control_number_02: parts[2] ?? '',
      };
      i++;
      break;
    }

    if (SUMMARY_START_TAGS.has(tag)) {
      if (section !== 'summary') { section = 'summary'; currentLoopId = undefined; }
    } else if (DETAIL_START_TAGS.has(tag) && section === 'heading') {
      section = 'detail';
      currentLoopId = undefined;
    }

    if (LOOP_START_TAGS.has(tag)) {
      currentLoopId = tag;
    }

    const parts = segStr.split(sep);
    const elements = parts.slice(1);
    const raw: RawSegment = { tag, elements, loopId: currentLoopId };
    rawSegments.push(raw);

    const target = section === 'heading' ? heading : section === 'detail' ? detail : summary;
    addSegmentToSection(target, raw);

    i++;
  }

  const tx: JediTransaction = {
    transaction_set_header_ST: stHeader,
    transaction_set_trailer_SE: seTrailer,
    _raw: rawSegments,
  };

  tx.heading = heading;
  if (Object.keys(detail).length > 0) tx.detail = detail;
  if (Object.keys(summary).length > 0) tx.summary = summary;

  return { tx, consumed: i - startIdx };
}

function addSegmentToSection(section: Record<string, unknown>, raw: RawSegment): void {
  const { tag, elements, loopId } = raw;
  const tagLower = tag.toLowerCase();
  const segData: Record<string, string> = {};
  elements.forEach((el, idx) => {
    segData[`${tagLower}_element_${String(idx + 1).padStart(2, '0')}`] = el;
  });

  if (loopId && LOOP_START_TAGS.has(loopId)) {
    const loopKey = `${loopId.toLowerCase()}_loop`;
    if (!Array.isArray(section[loopKey])) {
      section[loopKey] = [];
    }
    const loopArr = section[loopKey] as Record<string, unknown>[];

    if (tag === loopId) {
      // Start of new loop entry
      loopArr.push({ [tagLower]: segData });
    } else {
      // Append to most recent loop entry
      if (loopArr.length > 0) {
        const last = loopArr[loopArr.length - 1] as Record<string, unknown>;
        const existing = last[tagLower];
        if (existing === undefined) {
          last[tagLower] = segData;
        } else if (Array.isArray(existing)) {
          (existing as Record<string, unknown>[]).push(segData);
        } else {
          last[tagLower] = [existing, segData];
        }
      }
    }
  } else {
    // Flat segment (no loop context, or loop-start tag is itself)
    const existing = section[tagLower];
    if (existing === undefined) {
      section[tagLower] = segData;
    } else if (Array.isArray(existing)) {
      (existing as Record<string, unknown>[]).push(segData);
    } else {
      section[tagLower] = [existing, segData];
    }
  }
}

function getTag(segStr: string, sep: string): string {
  return segStr.split(sep)[0];
}
