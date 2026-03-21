import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import pino from 'pino';
import { outboundQueue } from '../../queue/queues';
import { mapRegistry } from '../../maps/registry';
import { systemToJedi } from '../../transforms/system-to-jedi';
import { serializeEDI } from '../../transforms/edi-serializer';
import { buildInterchangeWrapper, buildTransaction } from '../../transforms/interchange-builder';

const logger = pino({ name: 'route:outbound' });

const SUPPORTED_TX_SETS = ['990', '214', '210'] as const;

export async function outboundRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/outbound/:txSet', async (req, reply) => {
    const { txSet } = req.params as { txSet: string };

    if (!SUPPORTED_TX_SETS.includes(txSet as (typeof SUPPORTED_TX_SETS)[number])) {
      return reply.code(400).send({
        error: `Unsupported transaction set: ${txSet}. Supported: ${SUPPORTED_TX_SETS.join(', ')}`,
      });
    }

    const systemJson = req.body as Record<string, unknown>;

    // Validate against map schema if present
    try {
      const map = mapRegistry.get(txSet, 'outbound');
      if (map.validationSchema) {
        const schema = z.object(JSON.parse(map.validationSchema));
        schema.parse(systemJson);
      }
    } catch (err: unknown) {
      if ((err as Error).name === 'ZodError') {
        return reply.code(400).send({ error: 'Validation failed', details: (err as Error).message });
      }
      // Map not found — proceed without validation
    }

    const jobId = `outbound-${txSet}-${Date.now()}`;
    await outboundQueue.add(
      `outbound-${txSet}`,
      { systemJson, transactionSet: txSet, transport: 'sftp' },
      { jobId },
    );

    logger.info({ jobId, txSet }, 'Outbound job enqueued');
    return reply.code(202).send({ jobId, status: 'queued' });
  });

  // DEBUG ONLY — serialize systemJson → EDI and return; no queuing, no delivery
  fastify.post('/debug/serialize', async (req, reply) => {
    const { transactionSet, systemJson } = req.body as {
      transactionSet?: string;
      systemJson?: Record<string, unknown>;
    };

    if (!transactionSet) {
      return reply.code(400).send({ error: 'transactionSet is required' });
    }
    if (!systemJson || typeof systemJson !== 'object') {
      return reply.code(400).send({ error: 'systemJson is required and must be an object' });
    }

    try {
      const map = mapRegistry.get(transactionSet, 'outbound');
      const segments = systemToJedi(systemJson, map);
      const interchange = buildInterchangeWrapper(transactionSet);
      interchange.functional_groups[0].transactions.push(
        buildTransaction(transactionSet, segments.length),
      );
      const edi = serializeEDI(interchange, segments);
      return reply.send({ edi, segments });
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
