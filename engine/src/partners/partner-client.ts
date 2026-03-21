import axios from 'axios';
import pino from 'pino';

const logger = pino({ name: 'partner-client' });
const OPS_URL = process.env.OPS_PLATFORM_URL ?? 'http://localhost:8000';

export interface TradingPartner {
  id: number;
  name: string;
  partner_id: string;
  isa_qualifier: string;
  transport: 'sftp' | 'as2' | 'rest';
  sftp_host: string;
  sftp_port: number;
  sftp_user: string;
  sftp_password: string;
  sftp_inbound_dir: string;
  sftp_outbound_dir: string;
  as2_id: string;
  as2_url: string;
  as2_cert: string;
  downstream_api_url: string;
  downstream_api_key: string;
  is_active: boolean;
}

// Simple TTL cache — avoids hammering Django on every message
const cache = new Map<string, { partner: TradingPartner; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getPartner(partnerId: string): Promise<TradingPartner | null> {
  const trimmed = partnerId.trim();

  const cached = cache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.partner;
  }

  try {
    const res = await axios.get<TradingPartner>(
      `${OPS_URL}/api/partners/${encodeURIComponent(trimmed)}/`,
      { timeout: 5_000 },
    );
    cache.set(trimmed, { partner: res.data, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      logger.warn({ partnerId: trimmed }, 'Trading partner not found');
    } else {
      logger.warn({ partnerId: trimmed, err: (err as Error).message }, 'Partner lookup failed — falling back to static config');
    }
    return null;
  }
}
