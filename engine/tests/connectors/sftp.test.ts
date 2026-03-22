const mockConnect = jest.fn();
const mockList = jest.fn();
const mockGet = jest.fn();
const mockRename = jest.fn();
const mockPut = jest.fn();
const mockEnd = jest.fn();
const mockDelete = jest.fn();

jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    list: mockList,
    get: mockGet,
    rename: mockRename,
    put: mockPut,
    end: mockEnd,
    delete: mockDelete,
  }));
});

jest.mock('../../src/queue/queues', () => ({
  inboundQueue: { add: jest.fn().mockResolvedValue({ id: 'test-job-id' }) },
  redisConnection: {},
  outboundQueue: { add: jest.fn() },
}));

jest.mock('../../src/config/index', () => ({
  config: {
    sftp: {
      host: 'sftp.test',
      port: 22,
      user: 'testuser',
      password: 'testpass',
      privateKey: '',
      inboundDir: '/inbound',
      outboundDir: '/outbound',
      archiveDir: '/archive',
      pollIntervalMs: 300000,
    },
    redis: { url: 'redis://localhost:6379' },
  },
}));

jest.mock('axios');

import axios from 'axios';
import { SFTPPoller, postSFTPLog, testSFTPConnection } from '../../src/connectors/sftp';
import { inboundQueue } from '../../src/queue/queues';
import type { TradingPartner } from '../../src/partners/partner-client';

const mockAxiosPost = axios.post as jest.Mock;

function makePartner(overrides: Partial<TradingPartner> = {}): TradingPartner {
  return {
    id: 1,
    name: 'Test Partner',
    partner_id: 'TEST01',
    isa_qualifier: 'ZZ',
    transport: 'sftp',
    sftp_host: 'sftp.partner.test',
    sftp_port: 22,
    sftp_user: 'partner',
    sftp_password: 'secret',
    sftp_inbound_dir: '/in',
    sftp_outbound_dir: '/out',
    sftp_poll_interval_ms: 300000,
    sftp_after_pull: 'MOVE_TO_ARCHIVE',
    as2_id: '',
    as2_url: '',
    as2_cert: '',
    downstream_api_url: '',
    downstream_api_key: '',
    is_active: true,
    ...overrides,
  };
}

describe('SFTPPoller', () => {
  let poller: SFTPPoller;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockAxiosPost.mockResolvedValue({ status: 201 });
    poller = new SFTPPoller();
  });

  test('connect() calls sftp.connect with correct host and username', async () => {
    await poller.connect();
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'sftp.test', username: 'testuser' })
    );
  });

  test('connect() posts a CONNECT log on success', async () => {
    await poller.connect();
    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/partners/sftp-logs/'),
      expect.objectContaining({ action: 'CONNECT', status: 'SUCCESS' }),
    );
  });

  test('poll() enqueues new files and moves to archive', async () => {
    const fileContent = 'ISA*00*test EDI~';
    mockList.mockResolvedValue([
      { name: 'test.edi', size: 100, modifyTime: 1000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from(fileContent));
    mockRename.mockResolvedValue(undefined);

    await poller.connect();
    await poller.poll();

    expect(inboundQueue.add).toHaveBeenCalledWith(
      'sftp-inbound',
      expect.objectContaining({ raw: fileContent, source: 'sftp' }),
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(mockRename).toHaveBeenCalledWith('/inbound/test.edi', '/archive/test.edi');
  });

  test('poll() posts POLL and PULL and MOVE logs', async () => {
    mockList.mockResolvedValue([
      { name: 'test.edi', size: 100, modifyTime: 1000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*00~'));
    mockRename.mockResolvedValue(undefined);

    await poller.connect();
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 201 });
    await poller.poll();

    const actions = (mockAxiosPost.mock.calls as [string, { action: string }][]).map(
      ([, body]) => body.action,
    );
    expect(actions).toContain('POLL');
    expect(actions).toContain('PULL');
    expect(actions).toContain('MOVE');
  });

  test('poll() skips already-seen files (dedup)', async () => {
    mockList.mockResolvedValue([
      { name: 'test.edi', size: 100, modifyTime: 1000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*content~'));
    mockRename.mockResolvedValue(undefined);

    await poller.connect();
    await poller.poll();  // First poll — enqueues
    await poller.poll();  // Second poll — skips

    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
  });

  test('upload() writes to correct remote path', async () => {
    mockPut.mockResolvedValue(undefined);
    await poller.connect();
    await poller.upload('outbound.edi', 'ISA*content~');

    expect(mockPut).toHaveBeenCalledWith(
      expect.any(Buffer),
      '/outbound/outbound.edi',
    );
  });

  test('upload() posts an UPLOAD log', async () => {
    mockPut.mockResolvedValue(undefined);
    await poller.connect();
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 201 });
    await poller.upload('outbound.edi', 'ISA*content~');

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/partners/sftp-logs/'),
      expect.objectContaining({ action: 'UPLOAD', filename: 'outbound.edi', status: 'SUCCESS' }),
    );
  });

  test('poll() handles unconnected state gracefully', async () => {
    // Never called connect — should return silently
    await expect(poller.poll()).resolves.not.toThrow();
    expect(mockList).not.toHaveBeenCalled();
  });

  test('poll() skips directories', async () => {
    mockList.mockResolvedValue([
      { name: 'subdir', size: 0, modifyTime: 1000, type: 'd' },
    ]);
    await poller.connect();
    await poller.poll();
    expect(inboundQueue.add).not.toHaveBeenCalled();
  });

  test('poll() deletes file instead of archiving when afterPull=DELETE', async () => {
    const partner = makePartner({ sftp_after_pull: 'DELETE' });
    const cfg = {
      host: partner.sftp_host,
      port: partner.sftp_port,
      user: partner.sftp_user,
      password: partner.sftp_password,
      inboundDir: partner.sftp_inbound_dir,
      outboundDir: partner.sftp_outbound_dir,
      archiveDir: '/archive',
      afterPull: 'DELETE' as const,
      namespace: partner.partner_id,
    };
    const deletePoller = new SFTPPoller(cfg, partner.partner_id);
    mockList.mockResolvedValue([
      { name: 'file.edi', size: 50, modifyTime: 2000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*~'));
    mockDelete.mockResolvedValue(undefined);

    await deletePoller.connect();
    await deletePoller.poll();

    expect(mockDelete).toHaveBeenCalledWith('/in/file.edi');
    expect(mockRename).not.toHaveBeenCalled();
  });

  test('poll() posts DELETE log when afterPull=DELETE', async () => {
    const cfg = {
      host: 'sftp.partner.test',
      port: 22,
      user: 'p',
      password: 'pw',
      inboundDir: '/in',
      outboundDir: '/out',
      archiveDir: '/arc',
      afterPull: 'DELETE' as const,
      namespace: 'TESTPARTNER',
    };
    const deletePoller = new SFTPPoller(cfg, 'TESTPARTNER');
    mockList.mockResolvedValue([
      { name: 'x.edi', size: 10, modifyTime: 100, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*~'));
    mockDelete.mockResolvedValue(undefined);

    await deletePoller.connect();
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 201 });
    await deletePoller.poll();

    const actions = (mockAxiosPost.mock.calls as [string, { action: string }][]).map(
      ([, body]) => body.action,
    );
    expect(actions).toContain('DELETE');
    expect(actions).not.toContain('MOVE');
  });
});

describe('SFTPPoller — file age check', () => {
  let agePoller: SFTPPoller;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockAxiosPost.mockResolvedValue({ status: 201 });
    mockRename.mockResolvedValue(undefined);
    agePoller = new SFTPPoller();
  });

  test('files newer than 5 seconds are skipped', async () => {
    mockList.mockResolvedValue([
      { name: 'new.edi', size: 50, modifyTime: Date.now() - 1000, type: '-' },
    ]);

    await agePoller.connect();
    await agePoller.poll();

    expect(inboundQueue.add).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
  });

  test('skipped new files are NOT added to seenFiles — picked up on next cycle', async () => {
    // First poll — file is too new, gets skipped
    mockList.mockResolvedValue([
      { name: 'new.edi', size: 50, modifyTime: Date.now() - 1000, type: '-' },
    ]);
    await agePoller.connect();
    await agePoller.poll();
    expect(inboundQueue.add).not.toHaveBeenCalled();

    // Second poll — same file identity but now old enough; should be pulled
    mockList.mockResolvedValue([
      { name: 'new.edi', size: 50, modifyTime: Date.now() - 10000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*~'));
    await agePoller.poll();

    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
  });

  test('files exactly 5 seconds old ARE pulled', async () => {
    mockList.mockResolvedValue([
      { name: 'exact.edi', size: 50, modifyTime: Date.now() - 5000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*~'));

    await agePoller.connect();
    await agePoller.poll();

    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
  });

  test('files older than 5 seconds ARE pulled', async () => {
    mockList.mockResolvedValue([
      { name: 'old.edi', size: 50, modifyTime: Date.now() - 60000, type: '-' },
    ]);
    mockGet.mockResolvedValue(Buffer.from('ISA*~'));

    await agePoller.connect();
    await agePoller.poll();

    expect(inboundQueue.add).toHaveBeenCalledTimes(1);
  });
});

describe('postSFTPLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 201 });
  });

  test('POSTs to the sftp-logs endpoint with correct payload', async () => {
    await postSFTPLog({ partner_id: 'FOAA', action: 'PULL', filename: 'test.edi', status: 'SUCCESS', file_size: 512 });

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/partners/sftp-logs/'),
      { partner_id: 'FOAA', action: 'PULL', filename: 'test.edi', status: 'SUCCESS', file_size: 512 },
    );
  });

  test('does not throw when the ops platform is unreachable', async () => {
    mockAxiosPost.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(postSFTPLog({ action: 'ERROR', status: 'FAILURE' })).resolves.toBeUndefined();
  });
});

describe('testSFTPConnection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosPost.mockResolvedValue({ status: 201 });
  });

  test('returns success with file count when connection succeeds', async () => {
    mockConnect.mockResolvedValue(undefined);
    mockList.mockResolvedValue([
      { name: 'a.edi', type: '-', size: 100, modifyTime: 0 },
      { name: 'b.edi', type: '-', size: 200, modifyTime: 0 },
      { name: 'subdir', type: 'd', size: 0, modifyTime: 0 },
    ]);
    mockEnd.mockResolvedValue(undefined);

    const result = await testSFTPConnection(makePartner());
    expect(result.success).toBe(true);
    expect(result.filesFound).toBe(2);
    expect(result.message).toContain('Connected');
  });

  test('returns failure when connection is refused', async () => {
    mockConnect.mockRejectedValue(new Error('Connection refused'));

    const result = await testSFTPConnection(makePartner());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  test('never throws even on unexpected errors', async () => {
    mockConnect.mockRejectedValue(new Error('Unexpected failure'));
    mockEnd.mockRejectedValue(new Error('Cannot end'));

    await expect(testSFTPConnection(makePartner())).resolves.toMatchObject({ success: false });
  });
});
