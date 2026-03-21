import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import pino from 'pino';
import { inboundQueue } from '../../queue/queues';
import { parseEDI } from '../../transforms/edi-parser';
import { jediToSystem } from '../../transforms/jedi-to-system';
import { mapRegistry } from '../../maps/registry';

const logger = pino({ name: 'route:inbound' });

export async function inboundRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /edi/inbound — raw EDI body
  fastify.post('/inbound', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const raw = (req.body as Buffer | string).toString();

    if (!raw.trim().startsWith('ISA')) {
      return reply.code(400).send({ error: 'Invalid EDI: must start with ISA segment' });
    }

    const jobId = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
    await inboundQueue.add('rest-inbound', { raw, source: 'rest' }, { jobId });

    logger.info({ jobId }, 'Inbound EDI enqueued via REST');
    return reply.code(202).send({ jobId, status: 'queued' });
  });

  // POST /edi/inbound/file — multipart upload
  fastify.post('/inbound/file', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');

    if (!raw.trim().startsWith('ISA')) {
      return reply.code(400).send({ error: 'Invalid EDI: must start with ISA segment' });
    }

    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
    const jobId = process.env.NODE_ENV === 'production' ? hash : `${hash}-${Date.now()}`;
    await inboundQueue.add('file-inbound', { raw, source: 'file-upload', filename: data.filename }, { jobId });

    logger.info({ jobId, filename: data.filename }, 'Inbound EDI enqueued via file upload');
    return reply.code(202).send({ jobId, status: 'queued' });
  });

  // DEBUG ONLY — parse EDI and return first transaction as JEDI; no map lookup; do not use in production
  fastify.post('/debug/parse', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');

    try {
      const parsed = parseEDI(raw);
      const tx = parsed.interchange.functional_groups[0]?.transactions[0];
      if (!tx) return reply.code(400).send({ error: 'No transaction found in EDI' });
      const transactionSet = tx.transaction_set_header_ST.transaction_set_identifier_code_01;
      return reply.send({ jedi: tx, transactionSet });
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // DEBUG ONLY — parse EDI, apply active map, return JEDI + system JSON side by side; do not use in production
  fastify.post('/debug/transform', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'No file provided' });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');

    try {
      const parsed = parseEDI(raw);
      const tx = parsed.interchange.functional_groups[0]?.transactions[0];
      if (!tx) return reply.code(400).send({ error: 'No transaction found in EDI' });

      const txSet = tx.transaction_set_header_ST.transaction_set_identifier_code_01;

      let systemJson: Record<string, unknown> = {};
      let warning: string | undefined;
      try {
        const map = mapRegistry.get(txSet, 'inbound');
        systemJson = jediToSystem(tx, map);
      } catch {
        warning = `No inbound map found for ${txSet} — JEDI returned without transformation`;
      }

      const responseBody: Record<string, unknown> = { jedi: tx, systemJson };
      if (warning) responseBody.warning = warning;
      return reply.send(responseBody);
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // GET /edi/inbound/status/:jobId
  fastify.get('/inbound/status/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = await inboundQueue.getJob(jobId);

    if (!job) return reply.code(404).send({ error: 'Job not found' });

    const state = await job.getState();
    return reply.send({ jobId, state, progress: job.progress, failedReason: job.failedReason });
  });
}
