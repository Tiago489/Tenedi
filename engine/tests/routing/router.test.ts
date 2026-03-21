import axios from 'axios';
import { config } from '../../src/config/index';
import { deliverToAPI } from '../../src/routing/router';

jest.mock('axios');

const mockPost = axios.post as jest.Mock;

const TEST_RULE = {
  transactionSet: '204',
  endpoint: 'http://test-endpoint/api',
  apiKey: 'test-key',
  retries: 0,
};

// Save original rules so each test starts clean
const originalRules = config.routing.rules;

beforeEach(() => {
  jest.clearAllMocks();
  config.routing.rules = [TEST_RULE];
});

afterAll(() => {
  config.routing.rules = originalRules;
});

describe('deliverToAPI', () => {
  test('POSTs payload to matching endpoint with correct headers', async () => {
    mockPost.mockResolvedValue({ status: 200 });

    await deliverToAPI('204', { foo: 'bar' });

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      'http://test-endpoint/api',
      { foo: 'bar' },
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });

  test('returns without calling axios when no rule matches the transaction set', async () => {
    mockPost.mockResolvedValue({ status: 200 });

    await deliverToAPI('999', { foo: 'bar' });

    expect(mockPost).not.toHaveBeenCalled();
  });

  test('throws after exhausting all retries', async () => {
    // Make sleep() resolve immediately so the test does not take real seconds
    const timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(
      ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout,
    );

    config.routing.rules = [{ ...TEST_RULE, retries: 2 }];
    mockPost.mockRejectedValue(new Error('network error'));

    await expect(deliverToAPI('204', {})).rejects.toThrow('after 3 attempts');
    expect(mockPost).toHaveBeenCalledTimes(3);

    timeoutSpy.mockRestore();
  });

  test('succeeds on first attempt without retry sleep when retries: 0', async () => {
    mockPost.mockRejectedValue(new Error('fail'));

    await expect(deliverToAPI('204', {})).rejects.toThrow('after 1 attempts');
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test('succeeds immediately and does not retry on first success', async () => {
    config.routing.rules = [{ ...TEST_RULE, retries: 3 }];
    mockPost.mockResolvedValue({ status: 200 });

    await deliverToAPI('204', {});

    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
