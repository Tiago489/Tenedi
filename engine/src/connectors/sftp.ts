import SFTPClient from 'ssh2-sftp-client';
import crypto from 'crypto';
import pino from 'pino';
import { config } from '../config/index';
import { inboundQueue } from '../queue/queues';
import type { TradingPartner } from '../partners/partner-client';

const logger = pino({ name: 'sftp-connector' });

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
  /** Used to namespace file dedup keys; defaults to host */
  namespace?: string;
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
    namespace: partner.partner_id,
  };
}

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

    const { inboundDir, archiveDir, namespace } = this.cfg;
    const ns = namespace ?? this.cfg.host;
    logger.debug({ inboundDir, partnerId: this.partnerId }, 'Polling SFTP');

    try {
      const files = await this.client.list(inboundDir);

      for (const file of files) {
        if (file.type !== '-') continue;

        const key = fileKey(ns, file.name, file.size, file.modifyTime);
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
          { raw: content, source: 'sftp', filename: file.name, partnerId: this.partnerId },
          { jobId: jId },
        );

        this.seenFiles.add(key);
        logger.info({ file: file.name, jobId: jId, partnerId: this.partnerId }, 'Enqueued SFTP file');

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
    const remotePath = `${this.cfg.outboundDir}/${filename}`;
    await this.client.put(Buffer.from(content, 'utf-8'), remotePath);
    logger.info({ filename, remotePath }, 'SFTP upload complete');
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
