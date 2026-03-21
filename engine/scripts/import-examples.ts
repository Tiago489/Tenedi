/**
 * Batch import EDI files into the MappingExample flywheel.
 *
 * Direction is auto-detected from the transaction set found in each file:
 *   204, 211        → inbound  → POST /edi/debug/transform (systemJson populated)
 *   990, 214, 210   → outbound → POST /edi/debug/parse    (systemJson = {})
 *   997, unknown    → inbound  → POST /edi/debug/parse    (systemJson = {}, no map needed)
 *
 * Files already imported (same SHA-1 content hash) are silently skipped.
 *
 * Usage:
 *   npm run import-examples -- <dir>
 *   ENGINE_URL=http://localhost:3000  (default)
 *   OPS_URL=http://localhost:8000     (default)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import FormData from 'form-data';

const ENGINE_URL = process.env.ENGINE_URL ?? 'http://localhost:3000';
const OPS_URL    = process.env.OPS_URL    ?? 'http://localhost:8000';

interface TransformResult {
  jedi: Record<string, unknown>;
  systemJson: Record<string, unknown>;
  warning?: string;
}

interface ParseResult {
  jedi: Record<string, unknown>;
  transactionSet: string;
}

// Inbound-only tx sets — use /debug/transform so systemJson gets populated.
const INBOUND_TX_SETS = new Set(['204', '211']);
// Outbound-only tx sets — use /debug/parse, no map lookup.
const OUTBOUND_TX_SETS = new Set(['990', '214', '210']);

function peekTxSet(raw: string): string {
  // Extract the transaction set code from the ST segment without an HTTP call.
  // ISA is exactly 106 chars; element separator is raw[3], segment terminator is raw[105].
  try {
    const clean = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
    const elementSep = clean[3];
    const segTerm = clean[105];
    const stSeg = clean.split(segTerm).find(s => s.trimStart().startsWith('ST'));
    if (!stSeg) return 'unknown';
    return stSeg.trimStart().split(elementSep)[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function detectDirection(txSet: string): 'inbound' | 'outbound' {
  if (OUTBOUND_TX_SETS.has(txSet)) return 'outbound';
  return 'inbound'; // 204, 211, 997, and unknown → inbound
}

interface ImportSummary {
  file: string;
  status: 'imported' | 'skipped' | 'error';
  txSet?: string;
  error?: string;
}

function responseBody(err: unknown): string {
  if (axios.isAxiosError(err) && err.response !== undefined) {
    const body = err.response.data;
    return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  }
  return '';
}

async function transformEDI(filePath: string, raw: string): Promise<TransformResult> {
  const form = new FormData();
  form.append('file', Buffer.from(raw), {
    filename: path.basename(filePath),
    contentType: 'text/plain',
  });
  try {
    const response = await axios.post<TransformResult>(
      `${ENGINE_URL}/edi/debug/transform`,
      form,
      { headers: form.getHeaders(), timeout: 30_000 },
    );
    return response.data;
  } catch (err: unknown) {
    const body = responseBody(err);
    if (body) console.error(`\n  [engine /debug/transform] response body:\n${body}`);
    throw err;
  }
}

async function parseOnly(filePath: string, raw: string): Promise<TransformResult> {
  // Used for outbound files (990, 210, 214) and 997: parse to JEDI only, no map lookup.
  const form = new FormData();
  form.append('file', Buffer.from(raw), {
    filename: path.basename(filePath),
    contentType: 'text/plain',
  });
  try {
    const response = await axios.post<ParseResult>(
      `${ENGINE_URL}/edi/debug/parse`,
      form,
      { headers: form.getHeaders(), timeout: 30_000 },
    );
    return { jedi: response.data.jedi, systemJson: {} };
  } catch (err: unknown) {
    const body = responseBody(err);
    if (body) console.error(`\n  [engine /debug/parse] response body:\n${body}`);
    throw err;
  }
}

async function saveToOps(
  txSet: string,
  direction: 'inbound' | 'outbound',
  raw: string,
  jedi: Record<string, unknown>,
  systemJson: Record<string, unknown>,
  contentHash: string,
): Promise<'imported' | 'skipped'> {
  try {
    const response = await axios.post(
      `${OPS_URL}/api/maps/mapping-examples/`,
      {
        transaction_set: txSet,
        direction,
        raw_edi: raw,
        jedi_output: jedi,
        system_json_output: systemJson,
        dsl_source: '',
        content_hash: contentHash,
        is_validated: false,
      },
      { timeout: 10_000 },
    );
    return response.status === 201 ? 'imported' : 'skipped';
  } catch (err: unknown) {
    const body = responseBody(err);
    if (body) console.error(`\n  [django /api/maps/mapping-examples/] response body:\n${body}`);
    throw err;
  }
}


async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: import-examples.ts <directory>');
    process.exit(1);
  }

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.edi') || f.toLowerCase().endsWith('.txt') || f.toLowerCase().endsWith('.x12'))
    .map(f => path.join(dir, f));

  if (files.length === 0) {
    console.log('No EDI files found in directory.');
    return;
  }

  console.log(`Found ${files.length} EDI file(s). Importing…\n`);

  const summary: ImportSummary[] = [];
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    const filename = path.basename(filePath);
    process.stdout.write(`  ${filename} … `);

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const cleaned = raw.replace(/^\uFEFF/, '').trimStart();
      if (!cleaned.startsWith('ISA')) {
        console.log('–  skipped [not a complete EDI interchange — no ISA envelope]');
        skipped++;
        summary.push({ file: filename, status: 'skipped' });
        continue;
      }

      const contentHash = crypto.createHash('sha1').update(raw).digest('hex');

      const txSet = peekTxSet(raw);
      const direction = detectDirection(txSet);
      // 204 and 211 get full transform (systemJson populated); everything else parse-only.
      const useTransform = INBOUND_TX_SETS.has(txSet);
      const result = useTransform
        ? await transformEDI(filePath, raw)
        : await parseOnly(filePath, raw);
      const status = await saveToOps(txSet, direction, raw, result.jedi, result.systemJson, contentHash);

      if (status === 'imported') {
        const note = result.warning
          ? `  ⚠  ${result.warning}`
          : !useTransform ? '  [parse-only]' : '';
        console.log(`✓  imported  [${txSet}/${direction}]${note}`);
        imported++;
      } else {
        console.log(`–  skipped (already exists)`);
        skipped++;
      }

      summary.push({ file: filename, status, txSet });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗  error: ${msg}`);
      summary.push({ file: filename, status: 'error', error: msg });
      errors++;
    }
  }

  console.log(`\nDone. ${imported} imported, ${skipped} skipped, ${errors} errors.`);
  if (errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
