import 'dotenv/config';

function envOptional(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue;
}

export interface RoutingRule {
  transactionSet: string;
  endpoint: string;
  apiKey: string;
  retries: number;
}

export const config = {
  server: {
    host: envOptional('HOST', '0.0.0.0'),
    port: parseInt(envOptional('PORT', '3000'), 10),
    as2Port: parseInt(envOptional('AS2_PORT', '4080'), 10),
  },
  redis: {
    url: envOptional('REDIS_URL', 'redis://localhost:6379'),
  },
  sftp: {
    host: envOptional('SFTP_HOST'),
    port: parseInt(envOptional('SFTP_PORT', '22'), 10),
    user: envOptional('SFTP_USER'),
    password: envOptional('SFTP_PASSWORD'),
    privateKey: envOptional('SFTP_PRIVATE_KEY'),
    inboundDir: envOptional('SFTP_INBOUND_DIR', '/inbound'),
    outboundDir: envOptional('SFTP_OUTBOUND_DIR', '/outbound'),
    archiveDir: envOptional('SFTP_ARCHIVE_DIR', '/archive'),
    pollIntervalMs: parseInt(envOptional('SFTP_POLL_INTERVAL_MS', '300000'), 10),
  },
  as2: {
    senderId: envOptional('AS2_SENDER_ID'),
    certPath: envOptional('AS2_CERT_PATH'),
    keyPath: envOptional('AS2_KEY_PATH'),
  },
  routing: {
    rules: JSON.parse(process.env.ROUTING_RULES ?? JSON.stringify([
      {
        transactionSet: '204',
        endpoint: 'https://webhook.site/4091a1e9-b93d-4182-bbaa-41d8c5e34bd4',
        apiKey: '',
        retries: 3,
      },
    ])) as RoutingRule[],
  },
  maps: {
    dbPath: envOptional('MAPS_DB_PATH', './maps/db'),
  },
};
