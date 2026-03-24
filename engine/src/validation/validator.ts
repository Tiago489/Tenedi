import axios from 'axios';
import pino from 'pino';
import type { ParsedEDI, JediTransaction } from '../types/jedi';

const logger = pino({ name: 'validator' });
const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

/**
 * Fetch active partner IDs from Django. Returns the list on success, or null
 * if Django is unreachable — callers should skip the sender check when null.
 */
export async function fetchKnownPartnerIds(): Promise<string[] | null> {
  try {
    const res = await axios.get<{ partners: { partner_id: string }[] }>(
      `${OPS_URL}/api/partners/`,
      { timeout: 5_000 },
    );
    const ids = (res.data.partners ?? []).map(p => p.partner_id);
    logger.debug({ partnerIds: ids }, 'Fetched known partner IDs from Django');
    return ids;
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Partner lookup failed — skipping UNKNOWN_SENDER_ID check');
    return null;
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  segment?: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
}

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, flag: 'EX', seconds: number): Promise<unknown>;
}

// ─── Level 1: Envelope ───────────────────────────────────────────────────────

export function validateEnvelope(parsed: ParsedEDI, knownPartnerIds?: string[] | null): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const isa = parsed.interchange.interchange_control_header_ISA;
  const iea = parsed.interchange.interchange_control_trailer_IEA;
  const fgs = parsed.interchange.functional_groups;

  // ISA/IEA functional group count
  const ieaGroupCount = parseInt(iea['number_of_included_functional_groups_01'] ?? '0', 10);
  if (fgs.length !== ieaGroupCount) {
    errors.push({
      code: 'ENVELOPE_GROUP_COUNT_MISMATCH',
      message: `IEA declares ${ieaGroupCount} functional group(s) but found ${fgs.length}`,
      segment: 'IEA',
      field: 'number_of_included_functional_groups_01',
    });
  }

  // ISA/IEA control number match
  const isaCtrl = isa['interchange_control_number_13'] ?? '';
  const ieaCtrl = iea['interchange_control_number_02'] ?? '';
  if (isaCtrl !== ieaCtrl) {
    errors.push({
      code: 'ENVELOPE_CONTROL_NUMBER_MISMATCH',
      message: `ISA control number (${isaCtrl}) does not match IEA (${ieaCtrl})`,
      segment: 'ISA/IEA',
      field: 'interchange_control_number',
    });
  }

  // Sender ID non-empty + known partner check
  const senderId = isa['interchange_sender_id_06']?.trim() ?? '';
  if (!senderId) {
    errors.push({
      code: 'ENVELOPE_EMPTY_SENDER_ID',
      message: 'ISA sender ID (ISA06) is empty',
      segment: 'ISA',
      field: 'interchange_sender_id_06',
    });
  } else if (
    knownPartnerIds != null &&
    !knownPartnerIds.some(id => id.trim().toLowerCase() === senderId.trim().toLowerCase())
  ) {
    warnings.push({
      code: 'UNKNOWN_SENDER_ID',
      message: `Sender ID "${senderId}" is not in the known partner list`,
    });
  }

  // GS/GE transaction count per functional group
  for (const fg of fgs) {
    const ge = fg.functional_group_trailer_GE;
    const geCount = parseInt(ge['number_of_transaction_sets_included_01'] ?? '0', 10);
    if (fg.transactions.length !== geCount) {
      errors.push({
        code: 'ENVELOPE_TX_COUNT_MISMATCH',
        message: `GE declares ${geCount} transaction set(s) but found ${fg.transactions.length}`,
        segment: 'GE',
        field: 'number_of_transaction_sets_included_01',
      });
    }

    // SE segment count per transaction
    for (const tx of fg.transactions) {
      const se = tx.transaction_set_trailer_SE;
      const seCount = parseInt(se['number_of_included_segments_01'] ?? '0', 10);
      const actualCount = (tx._raw?.length ?? 0) + 2; // +2 for ST and SE themselves
      if (seCount !== 0 && seCount !== actualCount) {
        errors.push({
          code: 'ENVELOPE_SEGMENT_COUNT_MISMATCH',
          message: `SE declares ${seCount} segment(s) but counted ${actualCount} (including ST/SE)`,
          segment: 'SE',
          field: 'number_of_included_segments_01',
        });
      }
    }
  }

  // Interchange date staleness warning (ISA09 = YYMMDD)
  const isaDate = isa['interchange_date_09'] ?? '';
  if (isaDate.length === 6) {
    const yy = parseInt(isaDate.slice(0, 2), 10);
    const mm = parseInt(isaDate.slice(2, 4), 10);
    const dd = parseInt(isaDate.slice(4, 6), 10);
    const interchangeDate = new Date(2000 + yy, mm - 1, dd);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (interchangeDate < thirtyDaysAgo) {
      warnings.push({
        code: 'STALE_INTERCHANGE_DATE',
        message: `Interchange date ${isaDate} is more than 30 days old`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Level 2: Schema ──────────────────────────────────────────────────────────

export function validateSchema(tx: JediTransaction, txSet: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const heading = (tx.heading ?? {}) as Record<string, unknown>;
  const detail = (tx.detail ?? {}) as Record<string, unknown>;

  switch (txSet) {
    case '204':
      if (!heading['b2']) {
        errors.push({ code: 'MISSING_REQUIRED_SEGMENT', message: '204 missing required B2 segment', segment: 'B2' });
      }
      if (!heading['b2a']) {
        errors.push({ code: 'MISSING_REQUIRED_SEGMENT', message: '204 missing required B2A segment', segment: 'B2A' });
      }
      if (!Array.isArray(detail['s5_loop']) || (detail['s5_loop'] as unknown[]).length === 0) {
        errors.push({ code: 'MISSING_REQUIRED_LOOP', message: '204 requires at least one S5 loop entry in detail', segment: 'S5' });
      }
      break;

    case '211':
      if (!heading['bol']) {
        errors.push({ code: 'MISSING_REQUIRED_SEGMENT', message: '211 missing required BOL segment', segment: 'BOL' });
      }
      if (!heading['b2a']) {
        errors.push({ code: 'MISSING_REQUIRED_SEGMENT', message: '211 missing required B2A segment', segment: 'B2A' });
      }
      if (!Array.isArray(heading['n1_loop']) || (heading['n1_loop'] as unknown[]).length === 0) {
        errors.push({ code: 'MISSING_REQUIRED_LOOP', message: '211 requires at least one N1 loop entry', segment: 'N1' });
      }
      break;

    case '997':
      // No required fields beyond envelope
      break;

    case '210':
    case '214':
    case '990':
      // Outbound-only — skip schema validation
      break;

    default:
      warnings.push({ code: 'UNKNOWN_TRANSACTION_SET', message: `Unknown transaction set ${txSet} — skipping schema validation` });
      break;
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Level 3: Business rules ──────────────────────────────────────────────────

export function validateBusinessRules(tx: JediTransaction, txSet: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const heading = (tx.heading ?? {}) as Record<string, unknown>;
  let scac: string | undefined;

  if (txSet === '204') {
    const b2 = heading['b2'] as Record<string, string> | undefined;
    scac = b2?.['b2_element_02']?.trim();
    if (!scac) {
      errors.push({ code: 'MISSING_SCAC', message: '204 B2 element_02 (SCAC) is missing or empty', segment: 'B2', field: 'b2_element_02' });
    }
  } else if (txSet === '211') {
    const bol = heading['bol'] as Record<string, string> | undefined;
    scac = bol?.['bol_element_01']?.trim();
    if (!scac) {
      errors.push({ code: 'MISSING_SCAC', message: '211 BOL element_01 (SCAC) is missing or empty', segment: 'BOL', field: 'bol_element_01' });
    }
  }

  if (scac && (scac.length < 2 || scac.length > 4)) {
    errors.push({
      code: 'INVALID_SCAC_LENGTH',
      message: `SCAC code "${scac}" must be between 2 and 4 characters`,
      segment: txSet === '204' ? 'B2' : 'BOL',
      field: txSet === '204' ? 'b2_element_02' : 'bol_element_01',
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

export async function checkDuplicate(
  senderId: string,
  controlNumber: string,
  redis: RedisClient,
): Promise<ValidationResult> {
  const key = `edi:processed:${senderId}:${controlNumber}`;
  try {
    const existing = await redis.get(key);
    if (existing !== null) {
      return {
        valid: false,
        errors: [{
          code: 'DUPLICATE_INTERCHANGE',
          message: `Interchange control number ${controlNumber} from sender ${senderId} was already processed`,
          segment: 'ISA',
          field: 'interchange_control_number_13',
        }],
        warnings: [],
      };
    }
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Redis duplicate check failed — skipping');
  }
  return { valid: true, errors: [], warnings: [] };
}

export async function markProcessed(
  senderId: string,
  controlNumber: string,
  redis: RedisClient,
): Promise<void> {
  const key = `edi:processed:${senderId}:${controlNumber}`;
  try {
    await redis.set(key, '1', 'EX', 30 * 24 * 60 * 60);
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Failed to mark interchange as processed in Redis');
  }
}

// ─── Full pipeline ────────────────────────────────────────────────────────────

export async function validateFull(parsed: ParsedEDI, redis?: RedisClient): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Fetch known partner IDs for sender validation (null = skip check)
  const knownPartnerIds = await fetchKnownPartnerIds();

  // Level 1: Envelope
  const envelopeResult = validateEnvelope(parsed, knownPartnerIds);
  errors.push(...envelopeResult.errors);
  warnings.push(...envelopeResult.warnings);

  // Duplicate check (skippable via env var for dev/testing)
  const skipDuplicateCheck = process.env.SKIP_DUPLICATE_CHECK === 'true';
  if (redis && !skipDuplicateCheck) {
    const isa = parsed.interchange.interchange_control_header_ISA;
    const senderId = isa['interchange_sender_id_06']?.trim() ?? '';
    const controlNumber = isa['interchange_control_number_13']?.trim() ?? '';
    if (senderId && controlNumber) {
      const dupResult = await checkDuplicate(senderId, controlNumber, redis);
      errors.push(...dupResult.errors);
      warnings.push(...dupResult.warnings);
    }
  }

  // Level 2 & 3: Per transaction
  for (const fg of parsed.interchange.functional_groups) {
    for (const tx of fg.transactions) {
      const txSet = tx.transaction_set_header_ST.transaction_set_identifier_code_01;

      const schemaResult = validateSchema(tx, txSet);
      errors.push(...schemaResult.errors);
      warnings.push(...schemaResult.warnings);

      const rulesResult = validateBusinessRules(tx, txSet);
      errors.push(...rulesResult.errors);
      warnings.push(...rulesResult.warnings);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
