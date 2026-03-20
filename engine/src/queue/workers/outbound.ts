import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { config } from '../../config/index';
import { mapRegistry } from '../../maps/registry';
import { systemToJedi } from '../../transforms/system-to-jedi';
import { serializeEDI } from '../../transforms/edi-serializer';
import { sftpUpload } from '../../connectors/sftp';
import { sendAS2 } from '../../connectors/as2';
import type { JediInterchange } from '../../types/jedi';

import '../../maps/seeds/204.map';
import '../../maps/seeds/210.map';
import '../../maps/seeds/211.map';
import '../../maps/seeds/214.map';
import '../../maps/seeds/990.map';
import '../../maps/seeds/997.map';

mapRegistry.loadFromDisk();

const logger = pino({ name: 'worker:outbound' });

const GS_FUNCTIONAL_CODES: Record<string, string> = {
  '204': 'SM', '210': 'IM', '211': 'SM',
  '214': 'QM', '990': 'SM', '997': 'FA',
};

/**
 * Build a minimal JEDI interchange envelope for outbound EDI.
 * TODO: Look up sender/receiver from partner registry by partnerId in production.
 */
function buildInterchangeWrapper(txSet: string): JediInterchange {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const ctrl = String(Date.now()).slice(-9).padStart(9, '0');

  return {
    interchange_control_header_ISA: {
      authorization_information_qualifier_01: '00',
      authorization_information_02: '          ',
      security_information_qualifier_03: '00',
      security_information_04: '          ',
      interchange_id_qualifier_05: 'ZZ',
      interchange_sender_id_06: 'SENDER         ',
      interchange_id_qualifier_07: 'ZZ',
      interchange_receiver_id_08: 'RECEIVER       ',
      interchange_date_09: date.slice(2),
      interchange_time_10: time,
      interchange_control_standards_identifier_11: 'U',
      interchange_control_version_number_12: '00401',
      interchange_control_number_13: ctrl,
      acknowledgment_requested_14: '0',
      usage_indicator_15: 'P',
      component_element_separator_16: '>',
    },
    functional_groups: [{
      functional_group_header_GS: {
        functional_identifier_code_01: GS_FUNCTIONAL_CODES[txSet] ?? 'XX',
        application_senders_code_02: 'SENDER',
        application_receivers_code_03: 'RECEIVER',
        date_04: date,
        time_05: time,
        group_control_number_06: ctrl,
        responsible_agency_code_07: 'X',
        version_release_industry_identifier_code_08: '004010',
      },
      transactions: [],
      functional_group_trailer_GE: {
        number_of_transaction_sets_included_01: '1',
        group_control_number_02: ctrl,
      },
    }],
    interchange_control_trailer_IEA: {
      number_of_included_functional_groups_01: '1',
      interchange_control_number_02: ctrl,
    },
  };
}

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
      finalEdi = serializeEDI(interchangeWrapper, rawSegments);
    } else {
      throw new Error('Outbound job must have either ediContent or systemJson+transactionSet');
    }

    const filename = `${transactionSet ?? 'EDI'}_${Date.now()}.edi`;

    if (transport === 'sftp') {
      if (!config.sftp.host) {
        logger.warn({ jobId: job.id, filename }, 'SFTP not configured — skipped, no transport');
        return;
      }
      await sftpUpload(filename, finalEdi);
    } else if (transport === 'as2') {
      // TODO: look up partner AS2 config from partner registry
      await sendAS2(finalEdi, { partnerId: partnerId ?? 'unknown', as2Id: '', url: '', cert: '' });
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
