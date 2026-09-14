const limiter = require('../../src/utils/realtimeLimiter');
beforeEach(() => { limiter.reset(); jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());
test('limits all tabs of a user, releases closed sockets and expires crashed leases', async () => {
    for (let i = 0; i < 10; i++) expect(await limiter.slot(7, `lease-${i}`)).toBe(true);
    expect(await limiter.slot(7, 'overflow')).toBe(false);
    expect(await limiter.slot(8, 'different-user')).toBe(true);
    await limiter.release(7, 'lease-1'); expect(await limiter.slot(7, 'replacement')).toBe(true);
    await jest.advanceTimersByTimeAsync(30000); expect(await limiter.slot(7, 'replacement', true)).toBe(true);
    await jest.advanceTimersByTimeAsync(30001);
    expect(await limiter.slot(7, 'lease-0', true)).toBe(false);
    expect(await limiter.slot(7, 'fresh')).toBe(true);
});
test('rate-limit windows expire and Redis outage never silently switches to local enforcement', async () => {
    expect((await limiter.consume('user:7', 1, 1000)).allowed).toBe(true);
    expect((await limiter.consume('user:7', 1, 1000)).allowed).toBe(false);
    await jest.advanceTimersByTimeAsync(1001); expect((await limiter.consume('user:7', 1, 1000)).allowed).toBe(true);
    limiter.setRedis({ isReady: false });
    await expect(limiter.consume('user:7', 1, 1000)).rejects.toThrow('UNAVAILABLE');
    await expect(limiter.slot(7, 'lease')).rejects.toThrow('UNAVAILABLE');
});
