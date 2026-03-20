import 'dotenv/config';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import schedule from 'node-schedule';
import pino from 'pino';
import { config } from '../config/index';
import { inboundRoutes } from './routes/inbound';
import { outboundRoutes } from './routes/outbound';
import { mapsRoutes } from './routes/maps';
import { handleAS2Receive } from '../connectors/as2';
import { sftpPoller } from '../connectors/sftp';
import { mapRegistry } from '../maps/registry';

// Load seed maps
import '../maps/seeds/204.map';
import '../maps/seeds/210.map';
import '../maps/seeds/211.map';
import '../maps/seeds/214.map';
import '../maps/seeds/990.map';
import '../maps/seeds/997.map';

const logger = pino({ name: 'server' });

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

  fastify.post('/as2/receive', handleAS2Receive);
  fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  return fastify;
}

async function main() {
  mapRegistry.loadFromDisk();

  const app = await buildServer();
  await app.listen({ host: config.server.host, port: config.server.port });
  logger.info({ port: config.server.port }, 'EDI transform engine started');

  if (config.sftp.host) {
    try {
      await sftpPoller.connect();
      const intervalMins = Math.max(1, Math.round(config.sftp.pollIntervalMs / 60000));
      schedule.scheduleJob(`*/${intervalMins} * * * *`, () => {
        sftpPoller.poll().catch(err => logger.error({ err: err.message }, 'SFTP poll error'));
      });
      logger.info({ intervalMs: config.sftp.pollIntervalMs }, 'SFTP poller scheduled');
    } catch (err: unknown) {
      logger.warn({ err: (err as Error).message }, 'SFTP connect failed — poller disabled');
    }
  }

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down');
    await sftpPoller.disconnect();
    await app.close();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error({ err: err.message }, 'Fatal startup error');
  process.exit(1);
});
