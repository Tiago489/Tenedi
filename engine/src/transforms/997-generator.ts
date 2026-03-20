import pino from 'pino';
import type { ParsedEDI } from '../types/jedi';

const logger = pino({ name: '997-generator' });

export type AckCode = 'A' | 'E' | 'R' | 'P';

export interface AckResult {
  transactionSetControlNumber: string;
  code: AckCode;
  errors?: string[];
}

export function generate997(parsed: ParsedEDI, ackResults?: AckResult[]): string {
  const { interchange } = parsed;
  const isa = interchange.interchange_control_header_ISA;

  // Swap sender/receiver
  const senderId = (isa['interchange_receiver_id_08'] ?? '').trim();
  const senderQual = isa['interchange_id_qualifier_07'] ?? 'ZZ';
  const receiverId = (isa['interchange_sender_id_06'] ?? '').trim();
  const receiverQual = isa['interchange_id_qualifier_05'] ?? 'ZZ';

  const now = new Date();
  const date = formatDate(now);
  const dateShort = date.slice(2);
  const time = formatTime(now);
  const controlNumber = String(Date.now()).slice(-9).padStart(9, '0');
  const groupControlNumber = String(Date.now() + 1).slice(-9);
  const stControlNumber = '0001';

  const segs: string[] = [];

  // ISA — fixed-width
  segs.push([
    'ISA',
    '00', '          ',
    '00', '          ',
    senderQual.padEnd(2), senderId.padEnd(15),
    receiverQual.padEnd(2), receiverId.padEnd(15),
    dateShort, time,
    'U', '00401',
    controlNumber,
    '0', 'P', '>',
  ].join('*'));

  segs.push(`GS*FA*${senderId}*${receiverId}*${date}*${time}*${groupControlNumber}*X*004010`);
  segs.push(`ST*997*${stControlNumber}`);

  let segCount = 1; // ST

  for (const fg of interchange.functional_groups) {
    const gs = fg.functional_group_header_GS;
    const gsControlNumber = gs['group_control_number_06'] ?? '';
    const functionalIdCode = gs['functional_identifier_code_01'] ?? '';

    segs.push(`AK1*${functionalIdCode}*${gsControlNumber}`);
    segCount++;

    const fgAckResults: AckResult[] = [];

    for (const tx of fg.transactions) {
      const txControlNumber = tx.transaction_set_header_ST.transaction_set_control_number_02;
      const txIdCode = tx.transaction_set_header_ST.transaction_set_identifier_code_01;
      const result = ackResults?.find(r => r.transactionSetControlNumber === txControlNumber)
        ?? { transactionSetControlNumber: txControlNumber, code: 'A' as AckCode };

      fgAckResults.push(result);

      segs.push(`AK2*${txIdCode}*${txControlNumber}`);
      segCount++;

      if (result.errors?.length) {
        for (const errCode of result.errors) {
          segs.push(`AK3*${errCode}`);
          segCount++;
        }
      }

      segs.push(`AK5*${result.code}`);
      segCount++;
    }

    const groupCode = resolveGroupCode(fgAckResults.map(r => r.code));
    const acceptedCount = fgAckResults.filter(r => r.code === 'A' || r.code === 'E').length;

    segs.push(`AK9*${groupCode}*${fg.transactions.length}*${fg.transactions.length}*${acceptedCount}`);
    segCount++;
  }

  segCount++; // SE itself
  segs.push(`SE*${segCount}*${stControlNumber}`);
  segs.push(`GE*1*${groupControlNumber}`);
  segs.push(`IEA*1*${controlNumber}`);

  logger.debug({ controlNumber }, 'Generated 997');
  return segs.join('~\n') + '~\n';
}

function resolveGroupCode(codes: AckCode[]): AckCode {
  if (codes.every(c => c === 'A')) return 'A';
  if (codes.every(c => c === 'R')) return 'R';
  if (codes.every(c => c === 'E')) return 'E';
  return 'P';
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
