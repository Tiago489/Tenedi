import axios from 'axios';
import pino from 'pino';
import { config, type RoutingRule } from '../config/index';

const logger = pino({ name: 'router' });

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function deliverToAPI(transactionSet: string, payload: unknown): Promise<void> {
  const rule: RoutingRule | undefined = config.routing.rules.find(
    r => r.transactionSet === transactionSet,
  );

  if (!rule) {
    logger.warn({ transactionSet }, 'No routing rule found — payload dropped');
    return;
  }

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= rule.retries + 1; attempt++) {
    try {
      await axios.post(rule.endpoint, payload, {
        headers: {
          Authorization: `Bearer ${rule.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      });
      logger.info({ transactionSet, endpoint: rule.endpoint, attempt }, 'Delivered to API');
      return;
    } catch (err: unknown) {
      lastError = err as Error;
      logger.warn({ transactionSet, attempt, err: lastError.message }, 'Delivery attempt failed');
      if (attempt <= rule.retries) {
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }
  }

  throw new Error(`Failed to deliver ${transactionSet} after ${rule.retries + 1} attempts: ${lastError?.message}`);
}
