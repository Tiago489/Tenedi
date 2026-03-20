import SFTPClient from 'ssh2-sftp-client';
import crypto from 'crypto';
import pino from 'pino';
import { config } from '../config/index';
import { inboundQueue } from '../queue/queues';

const logger = pino({ name: 'sftp-connector' });

function fileKey(name: string, size: number, modifyTime: number): string {
  return crypto.createHash('sha1').update(`${name}:${size}:${modifyTime}`).digest('hex');
}

export class SFTPPoller {
  private client: SFTPClient;
  private connected = false;
  // TODO: In multi-instance deployments, back this with Redis to share state across replicas
  private seenFiles = new Set<string>();

  constructor() {
    this.client = new SFTPClient();
  }

  async connect(): Promise<void> {
    const { host, port, user, password, privateKey } = config.sftp;
    if (!host || !user) {
      logger.warn('SFTP not configured — skipping connect');
      return;
    }

    const connectConfig: Record<string, unknown> = { host, port, username: user };
    if (privateKey) {
      connectConfig['privateKey'] = privateKey;
    } else {
      connectConfig['password'] = password;
    }

    await this.client.connect(connectConfig as Parameters<SFTPClient['connect']>[0]);
    this.connected = true;
    logger.info({ host, port }, 'SFTP connected');
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
      logger.info('SFTP disconnected');
    }
  }

  async poll(): Promise<void> {
    if (!this.connected) {
      logger.debug('SFTP not connected, skipping poll');
      return;
    }

    const { inboundDir, archiveDir } = config.sftp;
    logger.debug({ inboundDir }, 'Polling SFTP');

    try {
      const files = await this.client.list(inboundDir);

      for (const file of files) {
        if (file.type !== '-') continue;

        const key = fileKey(file.name, file.size, file.modifyTime);
        if (this.seenFiles.has(key)) {
          logger.debug({ file: file.name }, 'Skipping already-seen file');
          continue;
        }

        const remotePath = `${inboundDir}/${file.name}`;
        const buffer = await this.client.get(remotePath) as Buffer;
        const content = buffer.toString('utf-8');

        const jId = `sftp-${key.slice(0, 16)}`;
        await inboundQueue.add(
          'sftp-inbound',
          { raw: content, source: 'sftp', filename: file.name },
          { jobId: jId },
        );

        this.seenFiles.add(key);
        logger.info({ file: file.name, jobId: jId }, 'Enqueued SFTP file');

        try {
          await this.client.rename(remotePath, `${archiveDir}/${file.name}`);
          logger.debug({ file: file.name }, 'Archived file');
        } catch (err: unknown) {
          logger.warn({ file: file.name, err: (err as Error).message }, 'Failed to archive file');
        }
      }
    } catch (err: unknown) {
      logger.error({ err: (err as Error).message }, 'SFTP poll error');
    }
  }

  async upload(filename: string, content: string): Promise<void> {
    if (!this.connected) throw new Error('SFTP not connected');
    const remotePath = `${config.sftp.outboundDir}/${filename}`;
    await this.client.put(Buffer.from(content, 'utf-8'), remotePath);
    logger.info({ filename, remotePath }, 'SFTP upload complete');
  }
}

export const sftpPoller = new SFTPPoller();

export async function sftpUpload(filename: string, content: string): Promise<void> {
  const client = new SFTPPoller();
  try {
    await client.connect();
    await client.upload(filename, content);
  } finally {
    await client.disconnect();
  }
}
