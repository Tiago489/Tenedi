import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import axios from 'axios';
import pino from 'pino';
import { config } from '../../config/index';
import { parseEDI } from '../../transforms/edi-parser';
import { jediToSystem } from '../../transforms/jedi-to-system';
import { generate997 } from '../../transforms/997-generator';
import { mapRegistry } from '../../maps/registry';
import { outboundQueue } from '../queues';
import { deliverToAPI } from '../../routing/router';

const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

export async function recordJobInOps(job: Job, txSet: string): Promise<void> {
  try {
    await axios.post(`${OPS_URL}/api/jobs/`, {
      job_id: job.id,
      queue: 'edi-inbound',
      source: (job.data as { source: string }).source,
      transaction_set: txSet,
      status: 'completed',
      payload_preview: String((job.data as { raw: string }).raw).substring(0, 500),
      received_at: new Date(job.timestamp).toISOString(),
      processed_at: new Date().toISOString(),
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

const worker = new Worker(
  'edi-inbound',
  async (job: Job) => {
    const { raw, source, partnerId } = job.data as { raw: string; source: string; partnerId?: string };
    logger.info({ jobId: job.id, source, partnerId }, 'Processing inbound job');

    const parsed = parseEDI(raw);

    for (const fg of parsed.interchange.functional_groups) {
      for (const tx of fg.transactions) {
        const txSet = tx.transaction_set_header_ST.transaction_set_identifier_code_01;
        try {
          const map = mapRegistry.get(txSet, 'inbound');
          const systemJson = jediToSystem(tx, map);
          await deliverToAPI(txSet, systemJson);
          await recordJobInOps(job, txSet);
          logger.info({ jobId: job.id, txSet }, 'Transaction delivered');
        } catch (err: unknown) {
          logger.error({ jobId: job.id, txSet, err: (err as Error).message }, 'Failed to process transaction');
          throw err;
        }
      }
    }

    try {
      const ack997 = generate997(parsed);
      await outboundQueue.add(
        '997-ack',
        { ediContent: ack997, transport: 'sftp', source: 'auto-997' },
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
