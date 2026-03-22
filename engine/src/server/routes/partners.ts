import type { FastifyInstance } from 'fastify';
import { getPartner } from '../../partners/partner-client';
import { SFTPPoller, testSFTPConnection, partnerSFTPConfig } from '../../connectors/sftp';

export async function partnersRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/partners/:partnerId/test-sftp — attempt SFTP connection and list inbound dir
  fastify.post('/:partnerId/test-sftp', async (req, reply) => {
    const { partnerId } = req.params as { partnerId: string };

    const partner = await getPartner(partnerId);
    if (!partner) {
      return reply.code(404).send({ success: false, error: 'Partner not found' });
    }
    if (partner.transport !== 'sftp') {
      return reply.code(400).send({ success: false, error: `Partner transport is ${partner.transport}, not sftp` });
    }

    const result = await testSFTPConnection(partner);
    return reply.code(result.success ? 200 : 400).send(result);
  });

  // POST /api/partners/:partnerId/poll-now — run a single SFTP poll cycle immediately
  fastify.post('/:partnerId/poll-now', async (req, reply) => {
    const { partnerId } = req.params as { partnerId: string };

    const partner = await getPartner(partnerId);
    if (!partner) {
      return reply.code(404).send({ success: false, error: 'Partner not found' });
    }
    if (partner.transport !== 'sftp') {
      return reply.code(400).send({ success: false, error: `Partner transport is ${partner.transport}, not sftp` });
    }

    const cfg = partnerSFTPConfig(partner);
    const poller = new SFTPPoller(cfg, partner.partner_id);

    const TIMEOUT_MS = 30_000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Poll timed out after 30s')), TIMEOUT_MS),
    );

    try {
      await Promise.race([poller.connect(), timeout]);
      const pollResult = await Promise.race([poller.poll(), timeout]);
      return reply.send({
        filesFound: pollResult.filesFound,
        filesProcessed: pollResult.filesProcessed,
        errors: pollResult.errors,
      });
    } catch (err: unknown) {
      return reply.code(500).send({ success: false, error: (err as Error).message });
    } finally {
      await poller.disconnect().catch(() => { /* ignore disconnect errors */ });
    }
  });
}
