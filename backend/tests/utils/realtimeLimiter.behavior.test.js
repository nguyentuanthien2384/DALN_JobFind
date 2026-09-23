const limiter = require('../../src/utils/realtimeLimiter');

const originalPrefix = process.env.SOCKET_REDIS_PREFIX;
beforeEach(() => {
    limiter.reset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-01T00:00:00Z'));
    delete process.env.SOCKET_REDIS_PREFIX;
});
afterEach(() => {
    limiter.reset();
    jest.useRealTimers();
    if (originalPrefix === undefined) delete process.env.SOCKET_REDIS_PREFIX;
    else process.env.SOCKET_REDIS_PREFIX = originalPrefix;
});

describe('local fixed-window rate limits', () => {
    test('counts the exact limit, reports remaining delay, and resets at expiry', async () => {
        expect(await limiter.consume('user:7', 2, 1000)).toEqual({ allowed: true, retryAfterMs: 1000 });
        await jest.advanceTimersByTimeAsync(250);
        expect(await limiter.consume('user:7', 2, 1000)).toEqual({ allowed: true, retryAfterMs: 750 });
        expect(await limiter.consume('user:7', 2, 1000)).toEqual({ allowed: false, retryAfterMs: 750 });
        await jest.advanceTimersByTimeAsync(750);
        expect(await limiter.consume('user:7', 2, 1000)).toEqual({ allowed: true, retryAfterMs: 1000 });
    });

    test('keeps each user and action key in a separate bucket', async () => {
        expect((await limiter.consume('chat:7', 1, 1000)).allowed).toBe(true);
        expect((await limiter.consume('chat:7', 1, 1000)).allowed).toBe(false);
        expect((await limiter.consume('chat:8', 1, 1000)).allowed).toBe(true);
        expect((await limiter.consume('upload:7', 1, 1000)).allowed).toBe(true);
    });

    test('reset discards previous buckets and returns to local mode', async () => {
        await limiter.consume('chat:7', 1, 1000);
        limiter.setRedis({ isReady: false });
        await expect(limiter.consume('chat:7', 1, 1000)).rejects.toThrow('REALTIME_LIMITER_UNAVAILABLE');
        limiter.reset();
        expect((await limiter.consume('chat:7', 1, 1000)).allowed).toBe(true);
    });
});

describe('local connection leases', () => {
    test('allows ten tabs per user, isolates users and releases a closed tab', async () => {
        for (let i = 0; i < 10; i++) expect(await limiter.slot(7, `lease-${i}`)).toBe(true);
        expect(await limiter.slot(7, 'overflow')).toBe(false);
        expect(await limiter.slot(8, 'different-user')).toBe(true);
        await limiter.release(7, 'lease-1');
        expect(await limiter.slot(7, 'replacement')).toBe(true);
    });

    test('renewal extends one lease without consuming a new slot', async () => {
        expect(await limiter.slot(7, 'lease-0')).toBe(true);
        for (let i = 1; i < 10; i++) expect(await limiter.slot(7, `lease-${i}`)).toBe(true);
        await jest.advanceTimersByTimeAsync(30000);
        expect(await limiter.slot(7, 'lease-0', true)).toBe(true);
        expect(await limiter.slot(7, 'overflow')).toBe(false);
        await jest.advanceTimersByTimeAsync(30001);
        expect(await limiter.slot(7, 'lease-1', true)).toBe(false);
        expect(await limiter.slot(7, 'lease-0', true)).toBe(true);
        expect(await limiter.slot(7, 'new')).toBe(true);
    });

    test('another user cannot renew, take over or release a lease', async () => {
        expect(await limiter.slot(7, 'private-lease')).toBe(true);
        expect(await limiter.slot(8, 'private-lease', true)).toBe(false);
        expect(await limiter.slot(8, 'private-lease')).toBe(false);
        await limiter.release(8, 'private-lease');
        expect(await limiter.slot(7, 'private-lease', true)).toBe(true);
    });

    test('release is idempotent and a missing lease cannot be renewed', async () => {
        await limiter.release(7, 'missing');
        expect(await limiter.slot(7, 'missing', true)).toBe(false);
        expect(await limiter.slot(7, 'new')).toBe(true);
        await limiter.release(7, 'new');
        await limiter.release(7, 'new');
        expect(await limiter.slot(7, 'new', true)).toBe(false);
    });
});

describe('Redis shared limits', () => {
    test('uses configured namespace and returns atomic count and TTL', async () => {
        process.env.SOCKET_REDIS_PREFIX = 'tenant_1';
        const redis = { isReady: true, eval: jest.fn().mockResolvedValueOnce([1, 800]).mockResolvedValueOnce([2, -1]) };
        limiter.setRedis(redis);
        expect(await limiter.consume('chat:7', 1, 1000)).toEqual({ allowed: true, retryAfterMs: 800 });
        expect(await limiter.consume('chat:7', 1, 1000)).toEqual({ allowed: false, retryAfterMs: 1 });
        expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR',KEYS[1])"), {
            keys: ['tenant_1:realtime:limit:chat:7'], arguments: ['1000'],
        });
    });

    test.each(['spaces are bad', 'x'.repeat(65), '../tenant'])('rejects unsafe namespace %j', async value => {
        process.env.SOCKET_REDIS_PREFIX = value;
        const redis = { isReady: true, eval: jest.fn() };
        limiter.setRedis(redis);
        await expect(limiter.consume('chat:7', 1, 1000)).rejects.toThrow('Invalid SOCKET_REDIS_PREFIX');
        expect(redis.eval).not.toHaveBeenCalled();
    });

    test('uses default namespace when variable is empty', () => {
        process.env.SOCKET_REDIS_PREFIX = '';
        expect(limiter.prefix()).toBe('jobfind');
    });

    test('fails closed when Redis is unavailable or rejects a command', async () => {
        limiter.setRedis({ isReady: false });
        await expect(limiter.consume('chat:7', 1, 1000)).rejects.toThrow('REALTIME_LIMITER_UNAVAILABLE');
        await expect(limiter.slot(7, 'lease')).rejects.toThrow('REALTIME_LIMITER_UNAVAILABLE');
        const redis = { isReady: true, eval: jest.fn().mockRejectedValue(new Error('Redis down')) };
        limiter.setRedis(redis);
        await expect(limiter.consume('chat:7', 1, 1000)).rejects.toThrow('Redis down');
        await expect(limiter.slot(7, 'lease')).rejects.toThrow('Redis down');
    });

    test('connection acquisition and renewal are scoped to user and lease', async () => {
        const redis = { isReady: true, eval: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0) };
        limiter.setRedis(redis);
        expect(await limiter.slot(7, 'socket-a')).toBe(true);
        expect(await limiter.slot(7, 'socket-a', true)).toBe(false);
        expect(redis.eval.mock.calls[0][0]).toContain('ZCARD');
        expect(redis.eval.mock.calls[1][0]).toContain('ZSCORE');
        expect(redis.eval.mock.calls[0][1]).toMatchObject({
            keys: ['jobfind:realtime:connections:7'],
            arguments: [expect.any(String), expect.any(String), 'socket-a'],
        });
    });

    test('release removes lease only when shared Redis connection is ready', async () => {
        const redis = { isReady: true, zRem: jest.fn().mockResolvedValue(1) };
        limiter.setRedis(redis);
        await limiter.release(7, 'socket-a');
        expect(redis.zRem).toHaveBeenCalledWith('jobfind:realtime:connections:7', 'socket-a');
        redis.isReady = false;
        await limiter.release(7, 'socket-b');
        expect(redis.zRem).toHaveBeenCalledTimes(1);
    });
});
