import axios from '../axios';
import { createJobRequestOptions, createJob, repostJob } from './jobPostingService';

jest.mock('../axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto, configurable: true }); });
beforeEach(() => axios.post.mockReset().mockResolvedValue({ errCode: 0, data: { id: 12, statusCode: 'PS3' } }));

test.each([
    [createJob, [{ name: 'Developer' }], '/api/jobs', { name: 'Developer' }],
    [repostJob, [7, '2000000000000'], '/api/jobs/7/repost', { timeEnd: '2000000000000' }]
])('retains an explicit action key on overlapping requests and retry', async (handler, args, path, body) => {
    const options = createJobRequestOptions();
    const responses = await Promise.all([handler(...args, options), handler(...args, options)]);
    responses.push(await handler(...args, options));
    expect(axios.post).toHaveBeenCalledTimes(3);
    for (const call of axios.post.mock.calls) expect(call).toEqual([path, body, { headers: { 'Idempotency-Key': options.idempotencyKey }, timeout: 15000 }]);
    for (const result of responses) expect(result).toMatchObject({ idempotencyKey: options.idempotencyKey, data: { id: 12 } });
});

test.each([undefined, {}, { idempotencyKey: '' }, { idempotencyKey: 'bad key' }, { idempotencyKey: 'x'.repeat(129) }])('requires a key prepared before network I/O: %j', async options => {
    await expect(createJob({}, options)).rejects.toThrow('mã thao tác');
    await expect(repostJob(7, '2000000000000', options)).rejects.toThrow('mã thao tác');
    expect(axios.post).not.toHaveBeenCalled();
});

test.each([0, -1, '1/../../internal', '1?x=y', Number.MAX_SAFE_INTEGER + 1])('rejects invalid source IDs: %s', async id => {
    await expect(repostJob(id, '2000000000000', createJobRequestOptions())).rejects.toThrow('tin nguồn');
    expect(axios.post).not.toHaveBeenCalled();
});

test.each(['network', 'cancelled', 'timeout', 'server', 'conflict'])('keeps key on normalized %s errors without auto retry/fallback', async errorType => {
    const controller = new AbortController();
    const options = { ...createJobRequestOptions(), signal: controller.signal };
    axios.post.mockResolvedValueOnce({ errCode: -1, errorType });
    const result = await createJob({}, options);
    expect(result).toMatchObject({ errorType, idempotencyKey: options.idempotencyKey });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][2].signal).toBe(controller.signal);
});

test('retains key on rejected calls, and new user actions receive distinct immutable keys', async () => {
    const options = createJobRequestOptions();
    expect(Object.isFrozen(options)).toBe(true);
    expect(options.idempotencyKey).toMatch(/^[a-f0-9]{32}$/);
    expect(createJobRequestOptions().idempotencyKey).not.toBe(options.idempotencyKey);
    axios.post.mockRejectedValueOnce(new Error('connection lost'));
    await expect(createJob({}, options)).rejects.toMatchObject({ idempotencyKey: options.idempotencyKey });
    expect(axios.post).toHaveBeenCalledTimes(1);
});
