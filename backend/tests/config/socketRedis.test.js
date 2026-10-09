describe('Socket.IO Redis adapter lifecycle', () => {
  const originalUrl = process.env.SOCKET_REDIS_URL;
  let client, createClient, createAdapter, limiter, metrics, runtime;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    process.env.SOCKET_REDIS_URL = 'redis://unit-test.invalid:6379';
    client = {
      isOpen: true,
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn().mockReturnValue({ reader: true }),
      publish: jest.fn().mockResolvedValue(2),
      sPublish: jest.fn().mockResolvedValue(3),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(function () { return this.isOpen; })
    };
    createClient = jest.fn(() => client);
    createAdapter = jest.fn(() => 'streams-adapter');
    limiter = { prefix: jest.fn(() => 'jobfind:test'), setRedis: jest.fn() };
    metrics = { increment: jest.fn() };
    jest.doMock('redis', () => ({ createClient }));
    jest.doMock('@socket.io/redis-streams-adapter', () => ({ createAdapter }));
    jest.doMock('../../src/utils/realtimeLimiter', () => limiter);
    jest.doMock('../../src/utils/realtimeMetrics', () => metrics);
    runtime = require('../../src/config/socketRedis');
  });

  afterEach(async () => {
    await runtime.closeSocketRedis();
    jest.useRealTimers();
    if (originalUrl === undefined) delete process.env.SOCKET_REDIS_URL;
    else process.env.SOCKET_REDIS_URL = originalUrl;
  });

  test('uses the local adapter without constructing Redis when no URL is configured', async () => {
    delete process.env.SOCKET_REDIS_URL;
    await expect(runtime.connectSocketRedis()).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(limiter.setRedis).not.toHaveBeenCalled();
  });

  test('connects before exposing the adapter and namespaces stream/session keys', async () => {
    let ready;
    client.connect.mockReturnValue(new Promise(resolve => { ready = resolve; }));
    const connecting = runtime.connectSocketRedis();
    expect(createAdapter).not.toHaveBeenCalled();
    expect(limiter.setRedis).not.toHaveBeenCalled();
    ready();
    await expect(connecting).resolves.toBe('streams-adapter');
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      url: 'redis://unit-test.invalid:6379', disableOfflineQueue: true,
      socket: expect.objectContaining({ connectTimeout: 5000 })
    }));
    const { reconnectStrategy } = createClient.mock.calls[0][0].socket;
    expect(reconnectStrategy(0)).toBe(250);
    expect(reconnectStrategy(19)).toBe(5000);
    expect(reconnectStrategy(100)).toBe(5000);
    expect(limiter.setRedis).toHaveBeenCalledWith(client);
    expect(createAdapter).toHaveBeenCalledWith(expect.any(Object), {
      streamName: 'jobfind:test:socket.io', channelPrefix: 'jobfind:test:socket.io',
      sessionKeyPrefix: 'jobfind:test:session:', maxLen: 10000
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('counts Redis errors without exposing credentials in metric labels', async () => {
    await runtime.connectSocketRedis();
    const errorHandler = client.on.mock.calls.find(([event]) => event === 'error')[1];
    errorHandler(new Error('private connection details'));
    expect(metrics.increment).toHaveBeenCalledWith('socket_redis_errors_total');
  });

  test('lets Streams readers queue during reconnection and binds ordinary SDK methods', async () => {
    await runtime.connectSocketRedis();
    const adapterClient = createAdapter.mock.calls[0][0];
    expect(adapterClient.duplicate()).toEqual({ reader: true });
    expect(client.duplicate).toHaveBeenCalledWith({
      disableOfflineQueue: false, commandsQueueMaxLength: 1000
    });
    expect(adapterClient.isOpen).toBe(true);
    expect(adapterClient.get('key')).toBe(true);
    expect(client.get).toHaveBeenCalledWith('key');
  });

  test.each([['publish', 2], ['sPublish', 3], ['set', 'OK']])(
    'preserves successful %s results but contains best-effort failures', async (method, expected) => {
      await runtime.connectSocketRedis();
      const adapterClient = createAdapter.mock.calls[0][0];
      await expect(adapterClient[method]('key', 'value')).resolves.toBe(expected);
      expect(client[method]).toHaveBeenCalledWith('key', 'value');
      expect(metrics.increment).not.toHaveBeenCalled();
      client[method].mockRejectedValueOnce(new Error('Redis unavailable'));
      await expect(adapterClient[method]('key', 'value')).resolves.toBeNull();
      expect(metrics.increment).toHaveBeenCalledWith('socket_publish_errors_total');
    }
  );

  test('propagates failed connection and destroys its client before traffic can start', async () => {
    const failure = new Error('connection refused');
    client.connect.mockRejectedValueOnce(failure);
    await expect(runtime.connectSocketRedis()).rejects.toBe(failure);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(createAdapter).not.toHaveBeenCalled();
    expect(limiter.setRedis).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await runtime.closeSocketRedis();
    expect(client.close).not.toHaveBeenCalled();
  });

  test('bounds startup at eight seconds even when Redis never settles', async () => {
    client.connect.mockReturnValue(new Promise(() => {}));
    const connecting = runtime.connectSocketRedis();
    const rejected = expect(connecting).rejects.toThrow('Socket Redis startup timeout');
    await jest.advanceTimersByTimeAsync(7999);
    expect(client.destroy).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(createAdapter).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('drains a connected publisher once and clears the limiter before closing', async () => {
    await runtime.connectSocketRedis();
    let closed;
    client.close.mockReturnValue(new Promise(resolve => { closed = resolve; }));
    const closing = runtime.closeSocketRedis();
    expect(limiter.setRedis).toHaveBeenLastCalledWith(null);
    expect(client.close).toHaveBeenCalledTimes(1);
    await runtime.closeSocketRedis();
    expect(client.close).toHaveBeenCalledTimes(1);
    closed();
    await closing;
    expect(client.destroy).not.toHaveBeenCalled();
  });

  test('does not close a publisher that is already disconnected', async () => {
    await runtime.connectSocketRedis();
    client.isOpen = false;
    await runtime.closeSocketRedis();
    expect(limiter.setRedis).toHaveBeenLastCalledWith(null);
    expect(client.close).not.toHaveBeenCalled();
  });
});
