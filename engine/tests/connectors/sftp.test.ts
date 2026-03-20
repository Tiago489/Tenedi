const mockConnect = jest.fn();
const mockList = jest.fn();
const mockGet = jest.fn();
const mockRename = jest.fn();
const mockPut = jest.fn();
const mockEnd = jest.fn();

jest.mock('ssh2-sftp-client', () => {
  return jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    list: mockList,
    get: mockGet,
    rename: mockRename,
    put: mockPut,
    end: mockEnd,
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
      pollIntervalMs: 30000,
    },
    redis: { url: 'redis://localhost:6379' },
  },
}));

import { SFTPPoller } from '../../src/connectors/sftp';
import { inboundQueue } from '../../src/queue/queues';

describe('SFTPPoller', () => {
  let poller: SFTPPoller;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    poller = new SFTPPoller();
  });

  test('connect() calls sftp.connect with correct host and username', async () => {
    await poller.connect();
    expect(mockConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'sftp.test', username: 'testuser' })
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
});
