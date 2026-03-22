import SFTPClient from 'ssh2-sftp-client';
import crypto from 'crypto';
import axios from 'axios';
import pino from 'pino';
import { config } from '../config/index';
import { inboundQueue } from '../queue/queues';
import type { TradingPartner } from '../partners/partner-client';

const logger = pino({ name: 'sftp-connector' });
const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

function fileKey(namespace: string, name: string, size: number, modifyTime: number): string {
  return crypto.createHash('sha1').update(`${namespace}:${name}:${size}:${modifyTime}`).digest('hex');
}

export interface SFTPConnConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  privateKey?: string;
  inboundDir: string;
  outboundDir: string;
  archiveDir: string;
  pollIntervalMs?: number;
  afterPull?: 'MOVE_TO_ARCHIVE' | 'DELETE';
  /** Used to namespace file dedup keys; defaults to host */
  namespace?: string;
}

export interface PollResult {
  filesFound: number;
  filesProcessed: number;
  errors: string[];
}

export interface SFTPLogPayload {
  partner_id?: string;
  action: 'POLL' | 'PULL' | 'MOVE' | 'DELETE' | 'UPLOAD' | 'CONNECT' | 'ERROR';
  filename?: string;
  status: 'SUCCESS' | 'FAILURE';
  error_message?: string;
  file_size?: number;
}

export async function postSFTPLog(payload: SFTPLogPayload): Promise<void> {
  try {
    await axios.post(`${OPS_URL}/api/partners/sftp-logs/`, payload);
  } catch (err: unknown) {
    logger.warn({ err: (err as Error).message }, 'Failed to post SFTP log — continuing');
  }
}

function globalSFTPConfig(): SFTPConnConfig {
  return {
    host: config.sftp.host,
    port: config.sftp.port,
    user: config.sftp.user,
    password: config.sftp.password,
    privateKey: config.sftp.privateKey,
    inboundDir: config.sftp.inboundDir,
    outboundDir: config.sftp.outboundDir,
    archiveDir: config.sftp.archiveDir,
    pollIntervalMs: config.sftp.pollIntervalMs,
    namespace: config.sftp.host,
  };
}

function partnerSFTPConfig(partner: TradingPartner): SFTPConnConfig {
  return {
    host: partner.sftp_host,
    port: partner.sftp_port ?? 22,
    user: partner.sftp_user,
    password: partner.sftp_password,
    inboundDir: partner.sftp_inbound_dir || '/inbound',
    outboundDir: partner.sftp_outbound_dir || '/outbound',
    archiveDir: partner.sftp_outbound_dir ? partner.sftp_outbound_dir.replace('outbound', 'archive') : '/archive',
    pollIntervalMs: partner.sftp_poll_interval_ms ?? 300000,
    afterPull: partner.sftp_after_pull ?? 'MOVE_TO_ARCHIVE',
    namespace: partner.partner_id,
  };
}

export { partnerSFTPConfig };

export class SFTPPoller {
  private client: SFTPClient;
  private connected = false;
  // TODO: In multi-instance deployments, back this with Redis to share state across replicas
  private seenFiles = new Set<string>();
  private cfg: SFTPConnConfig;
  private partnerId?: string;

  constructor(cfg?: SFTPConnConfig, partnerId?: string) {
    this.client = new SFTPClient();
    this.cfg = cfg ?? globalSFTPConfig();
    this.partnerId = partnerId;
  }

  async connect(): Promise<void> {
    const { host, port, user, password, privateKey } = this.cfg;
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

    await postSFTPLog({ partner_id: this.partnerId, action: 'CONNECT', status: 'SUCCESS' });
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.end();
      this.connected = false;
      logger.info('SFTP disconnected');
    }
  }

  async poll(): Promise<PollResult> {
    const result: PollResult = { filesFound: 0, filesProcessed: 0, errors: [] };

    if (!this.connected) {
      logger.debug('SFTP not connected, skipping poll');
      return result;
    }

    const { inboundDir, archiveDir, namespace, afterPull } = this.cfg;
    const ns = namespace ?? this.cfg.host;
    logger.debug({ inboundDir, partnerId: this.partnerId }, 'Polling SFTP');

    try {
      const files = await this.client.list(inboundDir);

      await postSFTPLog({ partner_id: this.partnerId, action: 'POLL', status: 'SUCCESS' });

      for (const file of files) {
        if (file.type !== '-') continue;

        result.filesFound++;

        // Skip files that are still being written (younger than 5 seconds)
        const ageMs = Date.now() - file.modifyTime;
        if (ageMs < 5000) {
          logger.debug({ filename: file.name, ageMs }, 'Skipping file — still being written');
          continue;
        }

        const key = fileKey(ns, file.name, file.size, file.modifyTime);
        if (this.seenFiles.has(key)) {
          logger.debug({ file: file.name }, 'Skipping already-seen file');
          continue;
        }

        const remotePath = `${inboundDir}/${file.name}`;
        const buffer = await this.client.get(remotePath) as Buffer;
        const content = buffer.toString('utf-8');

        await postSFTPLog({
          partner_id: this.partnerId,
          action: 'PULL',
          filename: file.name,
          status: 'SUCCESS',
          file_size: file.size,
        });

        const jId = `sftp-${key.slice(0, 16)}`;
        await inboundQueue.add(
          'sftp-inbound',
          { raw: content, source: 'sftp', filename: file.name, partnerId: this.partnerId },
          { jobId: jId },
        );

        this.seenFiles.add(key);
        result.filesProcessed++;
        logger.info({ file: file.name, jobId: jId, partnerId: this.partnerId }, 'Enqueued SFTP file');

        if (afterPull === 'DELETE') {
          try {
            await this.client.delete(remotePath);
            logger.debug({ file: file.name }, 'Deleted file after pull');
            await postSFTPLog({ partner_id: this.partnerId, action: 'DELETE', filename: file.name, status: 'SUCCESS' });
          } catch (err: unknown) {
            const message = (err as Error).message;
            logger.warn({ file: file.name, err: message }, 'Failed to delete file');
            result.errors.push(`DELETE ${file.name}: ${message}`);
            await postSFTPLog({
              partner_id: this.partnerId, action: 'DELETE', filename: file.name,
              status: 'FAILURE', error_message: message,
            });
          }
        } else {
          try {
            await this.client.rename(remotePath, `${archiveDir}/${file.name}`);
            logger.debug({ file: file.name }, 'Archived file');
            await postSFTPLog({ partner_id: this.partnerId, action: 'MOVE', filename: file.name, status: 'SUCCESS' });
          } catch (err: unknown) {
            const message = (err as Error).message;
            logger.warn({ file: file.name, err: message }, 'Failed to archive file');
            result.errors.push(`MOVE ${file.name}: ${message}`);
            await postSFTPLog({
              partner_id: this.partnerId, action: 'MOVE', filename: file.name,
              status: 'FAILURE', error_message: message,
            });
          }
        }
      }
    } catch (err: unknown) {
      const message = (err as Error).message;
      logger.error({ err: message }, 'SFTP poll error');
      result.errors.push(message);
      await postSFTPLog({ partner_id: this.partnerId, action: 'ERROR', status: 'FAILURE', error_message: message });
    }

    return result;
  }

  async upload(filename: string, content: string): Promise<void> {
    if (!this.connected) throw new Error('SFTP not connected');
    const remotePath = `${this.cfg.outboundDir}/${filename}`;
    await this.client.put(Buffer.from(content, 'utf-8'), remotePath);
    logger.info({ filename, remotePath }, 'SFTP upload complete');
    await postSFTPLog({ partner_id: this.partnerId, action: 'UPLOAD', filename, status: 'SUCCESS' });
  }
}

// Default global poller (used by legacy global-config path)
export const sftpPoller = new SFTPPoller();

/**
 * Start a per-partner SFTP poller. Connects, schedules polling, and returns
 * the poller instance so the caller can disconnect on shutdown.
 */
export async function startPartnerPoller(
  partner: TradingPartner,
  schedule: (fn: () => void) => void,
): Promise<SFTPPoller> {
  const cfg = partnerSFTPConfig(partner);
  const poller = new SFTPPoller(cfg, partner.partner_id);
  await poller.connect();
  schedule(() => {
    poller.poll().catch(err =>
      logger.error({ partnerId: partner.partner_id, err: err.message }, 'Partner SFTP poll error'),
    );
  });
  logger.info({ partnerId: partner.partner_id, host: cfg.host, port: cfg.port }, 'Partner SFTP poller started');
  return poller;
}

/**
 * Test SFTP connectivity for a partner — connects, lists inbound dir, disconnects.
 * Returns a result object; never throws.
 */
export async function testSFTPConnection(partner: TradingPartner): Promise<{
  success: boolean;
  message: string;
  filesFound?: number;
  error?: string;
}> {
  const cfg = partnerSFTPConfig(partner);
  const client = new SFTPClient();

  const connectConfig: Record<string, unknown> = {
    host: cfg.host,
    port: cfg.port,
    username: cfg.user,
    readyTimeout: 10000,
  };
  if (cfg.privateKey) {
    connectConfig['privateKey'] = cfg.privateKey;
  } else {
    connectConfig['password'] = cfg.password ?? '';
  }

  try {
    await client.connect(connectConfig as Parameters<SFTPClient['connect']>[0]);
    const files = await client.list(cfg.inboundDir);
    const filesFound = files.filter(f => f.type === '-').length;
    await client.end();
    return { success: true, message: 'Connected successfully', filesFound };
  } catch (err: unknown) {
    try { await client.end(); } catch { /* ignore */ }
    return { success: false, message: 'Connection failed', error: (err as Error).message };
  }
}

export interface SFTPOverride {
  host: string;
  port?: number;
  user: string;
  password?: string;
  privateKey?: string;
  outboundDir?: string;
}

export async function sftpUpload(filename: string, content: string, override?: SFTPOverride): Promise<void> {
  if (override) {
    const client = new SFTPClient();
    const connectConfig: Record<string, unknown> = {
      host: override.host,
      port: override.port ?? 22,
      username: override.user,
    };
    if (override.privateKey) {
      connectConfig['privateKey'] = override.privateKey;
    } else {
      connectConfig['password'] = override.password ?? '';
    }
    await client.connect(connectConfig as Parameters<SFTPClient['connect']>[0]);
    const remotePath = `${override.outboundDir ?? config.sftp.outboundDir}/${filename}`;
    try {
      await client.put(Buffer.from(content, 'utf-8'), remotePath);
      logger.info({ filename, remotePath, host: override.host }, 'SFTP upload complete (partner config)');
    } finally {
      await client.end();
    }
    return;
  }

  const poller = new SFTPPoller();
  try {
    await poller.connect();
    await poller.upload(filename, content);
  } finally {
    await poller.disconnect();
  }
}
