import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { mapRegistry } from '../../maps/registry';
import { compiler } from '../../dsl/keywords/index';
import type { FieldMapping } from '../../types/maps';

const logger = pino({ name: 'route:maps' });

export async function mapsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /maps — list all active maps
  fastify.get('/', async (_req, reply) => {
    return reply.send(mapRegistry.list());
  });

  // GET /maps/vocabulary — AI-generatable keyword tokens
  fastify.get('/vocabulary', async (_req, reply) => {
    return reply.send({ keywords: compiler.aiVocabulary() });
  });

  // POST /maps — publish new map (goes live immediately via atomic swap)
  fastify.post('/', async (req, reply) => {
    const body = req.body as {
      id: string;
      transactionSet: string;
      direction: 'inbound' | 'outbound';
      mappings: FieldMapping[];
      dslSource?: string;
    };

    if (!body.transactionSet || !body.direction || !body.mappings) {
      return reply.code(400).send({ error: 'transactionSet, direction, and mappings are required' });
    }

    const map = mapRegistry.publish({
      id: body.id ?? `map-${Date.now()}`,
      transactionSet: body.transactionSet,
      direction: body.direction,
      mappings: body.mappings,
      dslSource: body.dslSource,
    });

    logger.info({ transactionSet: body.transactionSet, direction: body.direction, version: map.version }, 'Map published via API');
    return reply.code(201).send(map);
  });

  // POST /maps/rollback
  fastify.post('/rollback', async (req, reply) => {
    const { transactionSet, direction, version } = req.body as {
      transactionSet: string;
      direction: 'inbound' | 'outbound';
      version: number;
    };

    try {
      const map = mapRegistry.rollback(transactionSet, direction, version);
      return reply.send(map);
    } catch (err: unknown) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  // POST /maps/compile — compile DSL + validate against sample JEDI fixture
  fastify.post('/compile', async (req, reply) => {
    const { dsl, transactionSet, sampleJedi } = req.body as {
      dsl: string;
      transactionSet: string;
      sampleJedi?: Record<string, unknown>;
    };

    if (!dsl) return reply.code(400).send({ error: 'dsl is required' });

    const result = await compiler.validate(dsl, sampleJedi ?? {});
    logger.info({ transactionSet, ok: result.ok }, 'DSL compile+validate');
    return reply.send(result);
  });
}
