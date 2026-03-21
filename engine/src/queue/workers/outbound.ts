import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { config } from '../../config/index';
import { mapRegistry } from '../../maps/registry';
import { systemToJedi } from '../../transforms/system-to-jedi';
import { serializeEDI } from '../../transforms/edi-serializer';
import { buildInterchangeWrapper, buildTransaction } from '../../transforms/interchange-builder';
import { sftpUpload } from '../../connectors/sftp';
import { sendAS2 } from '../../connectors/as2';

import '../../maps/seeds/204.map';
import '../../maps/seeds/210.map';
import '../../maps/seeds/211.map';
import '../../maps/seeds/214.map';
import '../../maps/seeds/990.map';
import '../../maps/seeds/997.map';

mapRegistry.loadFromDisk();

const logger = pino({ name: 'worker:outbound' });


const connection = { url: config.redis.url };

const worker = new Worker(
  'edi-outbound',
  async (job: Job) => {
    const { ediContent, systemJson, transactionSet, transport, partnerId } = job.data as {
      ediContent?: string;
      systemJson?: Record<string, unknown>;
      transactionSet?: string;
      transport: 'sftp' | 'as2';
      partnerId?: string;
    };

    logger.info({ jobId: job.id, transactionSet, transport }, 'Processing outbound job');

    let finalEdi: string;

    if (ediContent) {
      finalEdi = ediContent;
    } else if (systemJson && transactionSet) {
      const map = mapRegistry.get(transactionSet, 'outbound');
      const rawSegments = systemToJedi(systemJson, map);
      const interchangeWrapper = buildInterchangeWrapper(transactionSet);
      interchangeWrapper.functional_groups[0].transactions.push(
        buildTransaction(transactionSet, rawSegments.length),
      );
      finalEdi = serializeEDI(interchangeWrapper, rawSegments);
    } else {
      throw new Error('Outbound job must have either ediContent or systemJson+transactionSet');
    }

    const filename = `${transactionSet ?? 'EDI'}_${Date.now()}.edi`;

    const sftpConfigured = config.sftp.host && config.sftp.host !== 'localhost';
    const as2Configured = Boolean(config.as2.certPath);

    if (transport === 'sftp') {
      if (!sftpConfigured) {
        logger.warn({ jobId: job.id, filename }, 'SFTP not configured — job completed without delivery');
        return;
      }
      try {
        await sftpUpload(filename, finalEdi);
      } catch (err: unknown) {
        logger.warn({ jobId: job.id, filename, err: (err as Error).message }, 'SFTP upload failed — job completed without delivery');
        return;
      }
    } else if (transport === 'as2') {
      if (!as2Configured) {
        logger.warn({ jobId: job.id, filename }, 'AS2 not configured — job completed without delivery');
        return;
      }
      // TODO: look up partner AS2 config from partner registry
      try {
        await sendAS2(finalEdi, { partnerId: partnerId ?? 'unknown', as2Id: '', url: '', cert: '' });
      } catch (err: unknown) {
        logger.warn({ jobId: job.id, filename, err: (err as Error).message }, 'AS2 send failed — job completed without delivery');
        return;
      }
    }

    logger.info({ jobId: job.id, filename }, 'Outbound job complete');
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job: Job) => logger.info({ jobId: job.id }, 'Outbound job completed'));
worker.on('failed', (job: Job | undefined, err: Error) =>
  logger.error({ jobId: job?.id, err: err.message }, 'Outbound job failed'));

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing outbound worker');
  await worker.close();
  process.exit(0);
});

logger.info('Outbound worker started');
