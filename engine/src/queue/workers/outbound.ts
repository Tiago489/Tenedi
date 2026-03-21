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
import { getPartner } from '../../partners/partner-client';

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

    logger.info({ jobId: job.id, transactionSet, transport, partnerId }, 'Processing outbound job');

    // Look up trading partner for config
    const partner = partnerId ? await getPartner(partnerId) : null;
    if (partner) {
      logger.info({ jobId: job.id, partnerId, partnerName: partner.name }, 'Trading partner resolved');
    }

    let finalEdi: string;

    if (ediContent) {
      finalEdi = ediContent;
    } else if (systemJson && transactionSet) {
      const map = mapRegistry.get(transactionSet, 'outbound');
      const rawSegments = systemToJedi(systemJson, map);
      const partnerIds = partner
        ? { senderId: partner.partner_id, senderQualifier: partner.isa_qualifier }
        : undefined;
      const interchangeWrapper = buildInterchangeWrapper(transactionSet, partnerIds);
      interchangeWrapper.functional_groups[0].transactions.push(
        buildTransaction(transactionSet, rawSegments.length),
      );
      finalEdi = serializeEDI(interchangeWrapper, rawSegments);
    } else {
      throw new Error('Outbound job must have either ediContent or systemJson+transactionSet');
    }

    const filename = `${transactionSet ?? 'EDI'}_${Date.now()}.edi`;

    if (transport === 'sftp') {
      const partnerSftpConfigured = partner && partner.sftp_host;
      const globalSftpConfigured = config.sftp.host && config.sftp.host !== 'localhost';

      if (partnerSftpConfigured) {
        try {
          await sftpUpload(filename, finalEdi, {
            host: partner.sftp_host,
            port: partner.sftp_port ?? 22,
            user: partner.sftp_user,
            password: partner.sftp_password,
            outboundDir: partner.sftp_outbound_dir || undefined,
          });
        } catch (err: unknown) {
          logger.warn({ jobId: job.id, filename, err: (err as Error).message }, 'Partner SFTP upload failed — job completed without delivery');
          return;
        }
      } else if (globalSftpConfigured) {
        try {
          await sftpUpload(filename, finalEdi);
        } catch (err: unknown) {
          logger.warn({ jobId: job.id, filename, err: (err as Error).message }, 'SFTP upload failed — job completed without delivery');
          return;
        }
      } else {
        logger.warn({ jobId: job.id, filename }, 'SFTP not configured — job completed without delivery');
        return;
      }
    } else if (transport === 'as2') {
      if (partner && partner.as2_url) {
        try {
          await sendAS2(finalEdi, {
            partnerId: partner.partner_id,
            as2Id: partner.as2_id,
            url: partner.as2_url,
            cert: partner.as2_cert,
          });
        } catch (err: unknown) {
          logger.warn({ jobId: job.id, filename, err: (err as Error).message }, 'AS2 send failed — job completed without delivery');
          return;
        }
      } else if (!config.as2.certPath) {
        logger.warn({ jobId: job.id, filename }, 'AS2 not configured — job completed without delivery');
        return;
      } else {
        logger.warn({ jobId: job.id }, 'AS2 partner config missing — job completed without delivery');
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
