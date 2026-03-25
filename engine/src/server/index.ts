import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import schedule from 'node-schedule';
import axios from 'axios';
import pino from 'pino';
import { config } from '../config/index';
import { inboundRoutes } from './routes/inbound';
import { outboundRoutes } from './routes/outbound';
import { mapsRoutes } from './routes/maps';
import { partnersRoutes } from './routes/partners';
import { handleAS2Receive } from '../connectors/as2';
import { sftpPoller, startPartnerPoller, type SFTPPoller } from '../connectors/sftp';
import { mapRegistry } from '../maps/registry';
import type { TradingPartner } from '../partners/partner-client';

// Load seed maps
import '../maps/seeds/204.map';
import '../maps/seeds/210.map';
import '../maps/seeds/211.map';
import '../maps/seeds/214.map';
import '../maps/seeds/990.map';
import '../maps/seeds/997.map';
import '../maps/seeds/cevapd-204.map';

const logger = pino({ name: 'server' });
const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

async function buildServer() {
  const fastify = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });

  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  fastify.addContentTypeParser(
    ['application/edi-x12', 'text/plain'],
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  );

  await fastify.register(inboundRoutes, { prefix: '/edi' });
  await fastify.register(outboundRoutes, { prefix: '/edi' });
  await fastify.register(mapsRoutes, { prefix: '/maps' });
  await fastify.register(partnersRoutes, { prefix: '/api/partners' });

  fastify.post('/as2/receive', handleAS2Receive);
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  return fastify;
}

async function fetchSFTPPartners(): Promise<TradingPartner[]> {
  try {
    const res = await axios.get<{ partners: TradingPartner[] }>(
      `${OPS_URL}/api/partners/?transport=sftp`,
      { timeout: 5_000 },
    );
    return res.data.partners ?? [];
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Could not fetch SFTP partners from ops platform — skipping partner pollers');
    return [];
  }
}

async function syncMapsToOps(): Promise<void> {
  try {
    const registry = mapRegistry.registryDump();
    await axios.post(`${OPS_URL}/api/maps/sync/`, registry, { timeout: 5_000 });
    logger.info({ count: registry.length }, 'Map registry synced to ops platform');
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Could not sync maps to ops platform — continuing');
  }
}

async function loadDynamicMapsFromOps(): Promise<void> {
  try {
    const res = await axios.get<Array<{
      partner_key: string | null;
      transaction_set: string;
      direction: string;
      dsl_source: string;
      custom_transform_id: string;
      version: number;
    }>>(`${OPS_URL}/api/maps/published/`, { timeout: 5_000 });

    let loaded = 0;
    for (const entry of res.data) {
      if (!entry.transaction_set || !entry.direction) continue;
      if (!entry.dsl_source && !entry.custom_transform_id) continue;

      const mapId = entry.partner_key
        ? `${entry.partner_key}-${entry.transaction_set}-${entry.direction}`
        : `django-${entry.transaction_set}-${entry.direction}`;

      // Skip if a seed map already covers this key
      const storeKey = entry.partner_key
        ? `${entry.partner_key}-${entry.transaction_set}:${entry.direction}`
        : `${entry.transaction_set}:${entry.direction}`;

      try {
        mapRegistry.get(entry.transaction_set, entry.direction as 'inbound' | 'outbound');
        // If we got here without error, a default map exists. Only skip if it's
        // not a partner-specific map — partner maps use getForPartner which checks
        // a different key. We check the registryDump for exact key collision.
        const dump = mapRegistry.registryDump();
        if (dump.some(d => d.storeKey === storeKey)) {
          continue; // already registered by seed
        }
      } catch {
        // No existing map — safe to register
      }

      mapRegistry.publish({
        id: mapId,
        transactionSet: entry.transaction_set,
        direction: entry.direction as 'inbound' | 'outbound',
        mappings: [],
        dslSource: entry.dsl_source || undefined,
        customTransformId: entry.custom_transform_id || undefined,
      });
      loaded++;
    }

    if (loaded > 0) {
      logger.info({ loaded }, 'Dynamic maps loaded from ops platform');
    }
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Could not load dynamic maps from ops platform — continuing');
  }
}

async function main() {
  mapRegistry.loadFromDisk();

  const app = await buildServer();
  await app.listen({ host: config.server.host, port: config.server.port });
  logger.info({ port: config.server.port }, 'EDI transform engine started');

  // Sync seed maps to Django, then load any dynamic maps from Django
  await syncMapsToOps();
  await loadDynamicMapsFromOps();

  const partnerPollers: SFTPPoller[] = [];

  // Start per-partner SFTP pollers
  const sftpPartners = await fetchSFTPPartners();
  if (sftpPartners.length > 0) {
    for (const partner of sftpPartners) {
      try {
        const intervalMs = partner.sftp_poll_interval_ms ?? config.sftp.pollIntervalMs;
        const intervalMins = Math.max(1, Math.round(intervalMs / 60000));
        const poller = await startPartnerPoller(partner, fn => {
          schedule.scheduleJob(`*/${intervalMins} * * * *`, fn);
        });
        partnerPollers.push(poller);
      } catch (err: unknown) {
        logger.warn({ partnerId: partner.partner_id, err: (err as Error).message }, 'Partner SFTP connect failed — poller skipped');
      }
    }
    logger.info({ count: partnerPollers.length }, 'Partner SFTP pollers started');
  }

  // Legacy global SFTP poller (for non-partner-aware inbound)
  if (config.sftp.host) {
    try {
      await sftpPoller.connect();
      const intervalMins = Math.max(1, Math.round(config.sftp.pollIntervalMs / 60000));
      schedule.scheduleJob(`*/${intervalMins} * * * *`, () => {
        sftpPoller.poll().catch(err => logger.error({ err: err.message }, 'SFTP poll error'));
      });
      logger.info({ intervalMs: config.sftp.pollIntervalMs }, 'Global SFTP poller scheduled');
    } catch (err: unknown) {
      logger.warn({ err: (err as Error).message }, 'Global SFTP connect failed — poller disabled');
    }
  }

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down');
    for (const poller of partnerPollers) {
      await poller.disconnect();
    }
    await sftpPoller.disconnect();
    await app.close();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error({ err: err.message }, 'Fatal startup error');
  process.exit(1);
});
