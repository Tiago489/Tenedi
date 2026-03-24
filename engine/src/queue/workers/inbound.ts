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
import { applyProfile, type ClientProfile } from '../../transforms/profile';
import { customTransforms } from '../../maps/transforms/index';
import fs from 'fs';
import path from 'path';

const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

export interface RecordJobOptions {
  job: Job;
  txSet: string;
  partnerId?: string;
  status?: string;
  error_message?: string;
  validation_errors?: ValidationError[];
  validation_warnings?: ValidationWarning[];
  downstream_status_code?: number;
  downstream_response?: string;
  downstream_delivered_at?: string;
  downstream_error?: string;
}

export async function recordJobInOps(opts: RecordJobOptions): Promise<void> {
  const {
    job, txSet, partnerId, status = 'completed',
    error_message, validation_errors, validation_warnings,
    downstream_status_code, downstream_response, downstream_delivered_at, downstream_error,
  } = opts;
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
      ...(downstream_status_code !== undefined ? { downstream_status_code } : {}),
      ...(downstream_response !== undefined ? { downstream_response } : {}),
      ...(downstream_delivered_at !== undefined ? { downstream_delivered_at } : {}),
      ...(downstream_error !== undefined ? { downstream_error } : {}),
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
import '../../maps/seeds/cevapd-204.map';

mapRegistry.loadFromDisk();

const logger = pino({ name: 'worker:inbound' });

const PROFILES_DIR = path.join(__dirname, '../../maps/profiles');

function loadProfile(clientId: string): ClientProfile | null {
  try {
    const filePath = path.join(PROFILES_DIR, `${clientId}.profile.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ClientProfile;
  } catch {
    return null;
  }
}
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
          const map = mapRegistry.getForPartner(txSet, 'inbound', job.data.partnerId ?? '');
          let systemJson: Record<string, unknown>;
          if (map.customTransformId && customTransforms[map.customTransformId]) {
            systemJson = customTransforms[map.customTransformId](parsed);
          } else {
            systemJson = jediToSystem(tx, map);
          }

          // Apply client profile if one exists for this partner
          const clientId = (job.data as { clientId?: string }).clientId ?? partner?.partner_id;
          if (clientId) {
            const profile = loadProfile(clientId);
            if (profile) {
              systemJson = applyProfile(systemJson, profile);
              logger.info({ jobId: job.id, txSet, client: profile.client }, 'Client profile applied');
            } else {
              logger.debug({ jobId: job.id, txSet, clientId }, 'No profile found — passing systemJson through');
            }
          }

          let downstreamStatusCode: number | undefined;
          let downstreamResponse: string | undefined;
          let downstreamError: string | undefined;
          const deliveredAt = new Date().toISOString();

          try {
            if (partner?.downstream_api_url) {
              const resp = await axios.post(partner.downstream_api_url, systemJson, {
                headers: {
                  Authorization: `Bearer ${partner.downstream_api_key}`,
                  'Content-Type': 'application/json',
                },
                timeout: 30_000,
              });
              downstreamStatusCode = resp.status;
              downstreamResponse = String(resp.data ?? '').substring(0, 10_000);
              logger.info({ jobId: job.id, txSet, endpoint: partner.downstream_api_url, status: resp.status }, 'Delivered via partner routing');
            } else {
              await deliverToAPI(txSet, systemJson);
            }
          } catch (deliveryErr: unknown) {
            const axErr = deliveryErr as { response?: { status?: number; data?: unknown }; message?: string };
            downstreamStatusCode = axErr.response?.status;
            downstreamResponse = axErr.response?.data ? String(axErr.response.data).substring(0, 10_000) : undefined;
            downstreamError = axErr.message ?? String(deliveryErr);
            logger.error({ jobId: job.id, txSet, err: downstreamError, status: downstreamStatusCode }, 'Downstream delivery failed');
          }

          await recordJobInOps({
            job,
            txSet,
            partnerId: partner?.partner_id,
            status: downstreamError ? 'failed' : 'completed',
            error_message: downstreamError,
            validation_warnings: validationResult.warnings.length > 0 ? validationResult.warnings : undefined,
            downstream_status_code: downstreamStatusCode,
            downstream_response: downstreamResponse,
            downstream_delivered_at: deliveredAt,
            downstream_error: downstreamError,
          });

          if (downstreamError) {
            throw new Error(downstreamError);
          }

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
