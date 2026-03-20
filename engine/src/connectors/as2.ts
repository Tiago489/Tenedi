import pino from 'pino';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { inboundQueue } from '../queue/queues';
import { config } from '../config/index';

const logger = pino({ name: 'as2-connector' });

export interface AS2Partner {
  partnerId: string;
  as2Id: string;
  url: string;
  cert: string;
}

export async function handleAS2Receive(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const rawBody = (req.body as Buffer | string).toString('utf-8');
    const headers = req.headers as Record<string, string>;

    if (!rawBody.trim().startsWith('ISA')) {
      throw new Error('AS2 payload does not contain valid EDI');
    }

    const messageId = headers['message-id'] ?? `as2-${Date.now()}`;
    const senderId = headers['as2-from'] ?? 'unknown';

    await inboundQueue.add(
      'as2-inbound',
      { raw: rawBody, source: 'as2', partnerId: senderId, messageId },
      { jobId: `as2-${messageId.replace(/[<>\s]/g, '').slice(0, 32)}` },
    );

    logger.info({ messageId, senderId }, 'AS2 message enqueued');

    reply
      .code(200)
      .header('Content-Type', 'text/plain')
      .send(`MDN for message ${messageId} accepted`);
  } catch (err: unknown) {
    logger.error({ err: (err as Error).message }, 'AS2 receive error');
    reply.code(400).send({ error: (err as Error).message });
  }
}

export async function sendAS2(ediContent: string, partner: AS2Partner): Promise<void> {
  try {
    const response = await fetch(partner.url, {
      method: 'POST',
      headers: {
        'AS2-Version': '1.2',
        'AS2-From': config.as2.senderId,
        'AS2-To': partner.as2Id,
        'Content-Type': 'application/edi-x12',
        'Message-ID': `<${Date.now()}@edi-transform>`,
      },
      body: ediContent,
    });

    if (!response.ok) {
      throw new Error(`AS2 send failed: HTTP ${response.status}`);
    }

    logger.info({ partner: partner.partnerId, status: response.status }, 'AS2 message sent');
  } catch (err: unknown) {
    logger.error({ partner: partner.partnerId, err: (err as Error).message }, 'AS2 send error');
    throw err;
  }
}
