// Mock all module-level side effects before any imports
jest.mock('bullmq', () => ({
  Worker: jest.fn(() => ({ on: jest.fn(), close: jest.fn() })),
}));

jest.mock('../../../src/maps/registry', () => ({
  mapRegistry: { publish: jest.fn(), loadFromDisk: jest.fn(), get: jest.fn() },
}));

jest.mock('../../../src/maps/seeds/204.map', () => {});
jest.mock('../../../src/maps/seeds/210.map', () => {});
jest.mock('../../../src/maps/seeds/211.map', () => {});
jest.mock('../../../src/maps/seeds/214.map', () => {});
jest.mock('../../../src/maps/seeds/990.map', () => {});
jest.mock('../../../src/maps/seeds/997.map', () => {});

jest.mock('../../../src/queue/queues', () => ({
  outboundQueue: { add: jest.fn() },
}));

jest.mock('../../../src/routing/router', () => ({
  deliverToAPI: jest.fn(),
}));

jest.mock('axios');

import axios from 'axios';
import type { Job } from 'bullmq';
import { recordJobInOps } from '../../../src/queue/workers/inbound';

const mockPost = axios.post as jest.Mock;

const makeJob = (overrides: Partial<{ id: string; raw: string; source: string }> = {}): Job => ({
  id: overrides.id ?? 'job-abc123',
  timestamp: 1697356800000,
  data: {
    source: overrides.source ?? 'rest',
    raw: overrides.raw ?? 'ISA*00*          *...',
  },
} as unknown as Job);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recordJobInOps', () => {
  test('POSTs a correctly shaped job record to the ops platform', async () => {
    mockPost.mockResolvedValue({ status: 201 });
    const job = makeJob({ id: 'job-001', source: 'file-upload', raw: 'ISA*00*TEST' });

    await recordJobInOps(job, '204');

    expect(mockPost).toHaveBeenCalledTimes(1);

    const [url, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain('/api/jobs/');
    expect(body.job_id).toBe('job-001');
    expect(body.queue).toBe('edi-inbound');
    expect(body.source).toBe('file-upload');
    expect(body.transaction_set).toBe('204');
    expect(body.status).toBe('completed');
    expect(typeof body.received_at).toBe('string');
    expect(typeof body.processed_at).toBe('string');
    expect(typeof body.payload_preview).toBe('string');
  });

  test('payload_preview is capped at 500 characters', async () => {
    mockPost.mockResolvedValue({ status: 201 });
    const longRaw = 'X'.repeat(1000);
    const job = makeJob({ raw: longRaw });

    await recordJobInOps(job, '204');

    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect((body.payload_preview as string).length).toBeLessThanOrEqual(500);
  });

  test('does not throw when the ops platform is unreachable', async () => {
    mockPost.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(recordJobInOps(makeJob(), '204')).resolves.toBeUndefined();
  });

  test('does not throw when axios returns a 500 error', async () => {
    const err = Object.assign(new Error('Internal Server Error'), { response: { status: 500 } });
    mockPost.mockRejectedValue(err);

    await expect(recordJobInOps(makeJob(), '204')).resolves.toBeUndefined();
  });
});
