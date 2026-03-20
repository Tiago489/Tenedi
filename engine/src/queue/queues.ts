import { Queue } from 'bullmq';
import pino from 'pino';
import { config } from '../config/index';

const logger = pino({ name: 'queues' });

export const redisConnection = { url: config.redis.url };

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 500 },
};

export const inboundQueue = new Queue('edi-inbound', {
  connection: redisConnection,
  defaultJobOptions,
});

export const outboundQueue = new Queue('edi-outbound', {
  connection: redisConnection,
  defaultJobOptions,
});

logger.info('BullMQ queues initialised');
