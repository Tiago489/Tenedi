import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import axios from 'axios';
import pino from 'pino';
import { config } from '../../config/index';
import { parseEDI } from '../../transforms/edi-parser';
import { jediToSystem } from '../../transforms/jedi-to-system';
import { generate997 } from '../../transforms/997-generator';
import { mapRegistry } from '../../maps/registry';
import { outboundQueue } from '../queues';
import { deliverToAPI } from '../../routing/router';
import { getPartner } from '../../partners/partner-client';
import { validateFull, markProcessed, type ValidationError, type ValidationWarning } from '../../validation/validator';

const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

export interface RecordJobOptions {
  job: Job;
  txSet: string;
  partnerId?: string;
  status?: string;
  error_message?: string;
  validation_errors?: ValidationError[];
  validation_warnings?: ValidationWarning[];
}

export async function recordJobInOps(opts: RecordJobOptions): Promise<void> {
  const { job, txSet, partnerId, status = 'completed', error_message, validation_errors, validation_warnings } = opts;
  try {
    await axios.post(`${OPS_URL}/api/jobs/`, {
      job_id: job.id,
      queue: 'edi-inbound',
      source: (job.data as { source: string }).source,
      transaction_set: txSet,
      status,
      payload_preview: String((job.data as { raw: string }).raw).substring(0, 500),
      raw_edi: (job.data as { raw: string }).raw,
      received_at: new Date(job.timestamp).toISOString(),
      processed_at: new Date().toISOString(),
      partner_id: partnerId,
      ...(error_message !== undefined ? { error_message } : {}),
      ...(validation_errors !== undefined ? { validation_errors } : {}),
      ...(validation_warnings !== undefined ? { validation_warnings } : {}),
    }, { timeout: 5_000 });
  } catch (err: unknown) {
    logger.warn({ jobId: job.id, txSet, err: (err as Error).message }, 'Failed to record job in ops platform — continuing');
  }
}

// Load seed maps
import '../../maps/seeds/204.map';
import '../../maps/seeds/210.map';
import '../../maps/seeds/211.map';
import '../../maps/seeds/214.map';
import '../../maps/seeds/990.map';
import '../../maps/seeds/997.map';

mapRegistry.loadFromDisk();

const logger = pino({ name: 'worker:inbound' });
const connection = { url: config.redis.url };

const redisClient = new Redis(config.redis.url, { maxRetriesPerRequest: null, lazyConnect: true });

const worker = new Worker(
  'edi-inbound',
  async (job: Job) => {
    const { raw, source } = job.data as { raw: string; source: string; partnerId?: string };
    logger.info({ jobId: job.id, source }, 'Processing inbound job');

    const parsed = parseEDI(raw);

    // Validation pipeline — runs before mapping; failures write a structured error and stop processing
    const validationResult = await validateFull(parsed, redisClient);
    if (!validationResult.valid) {
      const firstTxSet = parsed.transactionSets[0] ?? 'UNKNOWN';
      await recordJobInOps({
        job,
        txSet: firstTxSet,
        status: 'failed',
        error_message: validationResult.errors.map(e => `[${e.code}] ${e.message}`).join('\n'),
        validation_errors: validationResult.errors,
        validation_warnings: validationResult.warnings,
      });
      logger.warn({ jobId: job.id, errors: validationResult.errors }, 'EDI validation failed — stopping processing');
      return;
    }
    if (validationResult.warnings.length > 0) {
      logger.warn({ jobId: job.id, warnings: validationResult.warnings }, 'EDI validation warnings');
    }

    // Extract ISA sender ID to identify trading partner
    const isaSenderId = parsed.interchange.interchange_control_header_ISA.interchange_sender_id_06?.trim();
    const partner = isaSenderId ? await getPartner(isaSenderId) : null;

    if (partner) {
      logger.info({ jobId: job.id, partnerId: partner.partner_id, partnerName: partner.name }, 'Trading partner identified');
    } else {
      logger.info({ jobId: job.id, isaSenderId }, 'No trading partner found — using static routing');
    }

    for (const fg of parsed.interchange.functional_groups) {
      for (const tx of fg.transactions) {
        const txSet = tx.transaction_set_header_ST.transaction_set_identifier_code_01;
        try {
          const map = mapRegistry.get(txSet, 'inbound');
          const systemJson = jediToSystem(tx, map);

          if (partner?.downstream_api_url) {
            // Use partner-specific routing
            await axios.post(partner.downstream_api_url, systemJson, {
              headers: {
                Authorization: `Bearer ${partner.downstream_api_key}`,
                'Content-Type': 'application/json',
              },
              timeout: 30_000,
            });
            logger.info({ jobId: job.id, txSet, endpoint: partner.downstream_api_url }, 'Delivered via partner routing');
          } else {
            // Fall back to static routing rules
            await deliverToAPI(txSet, systemJson);
          }

          await recordJobInOps({
            job,
            txSet,
            partnerId: partner?.partner_id,
            validation_warnings: validationResult.warnings.length > 0 ? validationResult.warnings : undefined,
          });
          logger.info({ jobId: job.id, txSet }, 'Transaction delivered');
        } catch (err: unknown) {
          logger.error({ jobId: job.id, txSet, err: (err as Error).message }, 'Failed to process transaction');
          throw err;
        }
      }
    }

    // Mark interchange as processed in Redis for duplicate detection
    const isa = parsed.interchange.interchange_control_header_ISA;
    const senderId = isa['interchange_sender_id_06']?.trim() ?? '';
    const controlNumber = isa['interchange_control_number_13']?.trim() ?? '';
    if (senderId && controlNumber) {
      await markProcessed(senderId, controlNumber, redisClient);
    }

    try {
      const ack997 = generate997(parsed);
      await outboundQueue.add(
        '997-ack',
        { ediContent: ack997, transactionSet: '997', transport: 'sftp', source: 'auto-997', partnerId: partner?.partner_id },
        { priority: 1 },
      );
      logger.info({ jobId: job.id }, '997 ACK enqueued');
    } catch (err: unknown) {
      logger.error({ jobId: job.id, err: (err as Error).message }, 'Failed to generate 997');
    }
  },
  {
    connection,
    concurrency: 10,
    limiter: { max: 100, duration: 1000 },
  },
);

worker.on('completed', (job: Job) => logger.info({ jobId: job.id }, 'Job completed'));
worker.on('failed', (job: Job | undefined, err: Error) =>
  logger.error({ jobId: job?.id, err: err.message }, 'Job failed'));

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing inbound worker');
  await worker.close();
  process.exit(0);
});

logger.info('Inbound worker started');
