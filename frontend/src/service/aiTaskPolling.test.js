import { pollAiTask } from './aiTaskPolling';

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const advance = async (ms) => { jest.advanceTimersByTime(ms); await flush(); };
const success = { errCode: 0, data: { status: 'done', result: { score: 80 } } };
beforeEach(() => { jest.useFakeTimers('modern'); jest.setSystemTime(new Date('2026-09-05T00:00:00Z')); });
afterEach(() => { expect(jest.getTimerCount()).toBe(0); jest.useRealTimers(); });

test('polls only reads and returns success after pending', async () => {
    const get = jest.fn().mockResolvedValueOnce({ errCode: 0, data: { status: 'pending' } }).mockResolvedValueOnce(success);
    const result = pollAiTask(get, 'task-1');
    await flush();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('task-1', expect.objectContaining({ timeout: 15000, signal: expect.anything() }));
    await advance(1999);
    expect(get).toHaveBeenCalledTimes(1);
    await advance(1);
    await expect(result).resolves.toEqual({ score: 80 });
});
test.each([401, 403, 404, 409, 400, 413])('stops immediately for permanent HTTP %s and keeps the task ID', async (status) => {
    const get = jest.fn().mockResolvedValue({ errCode: -1, httpStatus: status, errMessage: 'Synthetic refusal' });
    await expect(pollAiTask(get, 'same-task')).rejects.toMatchObject({ code: 'AI_POLL_REJECTED', taskId: 'same-task', httpStatus: status });
    expect(get).toHaveBeenCalledTimes(1);
});
test('respects Retry-After before trying a read again', async () => {
    const get = jest.fn().mockResolvedValueOnce({ errCode: 429, httpStatus: 429, retryAfterSeconds: 10 }).mockResolvedValueOnce(success);
    const result = pollAiTask(get, 'task-1');
    await flush();
    await advance(9999);
    expect(get).toHaveBeenCalledTimes(1);
    await advance(1);
    await expect(result).resolves.toEqual({ score: 80 });
});
test('backs off transient reads without treating them as model failures', async () => {
    const get = jest.fn().mockResolvedValueOnce({ errCode: -1, httpStatus: 503 })
        .mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(success);
    const result = pollAiTask(get, 'task-1', { intervalMs: 1000 });
    await flush();
    await advance(1000);
    expect(get).toHaveBeenCalledTimes(2);
    await advance(1999);
    expect(get).toHaveBeenCalledTimes(2);
    await advance(1);
    await expect(result).resolves.toEqual({ score: 80 });
});
test('does not poll again before Retry-After when it exceeds the total deadline', async () => {
    const get = jest.fn().mockResolvedValue({ errCode: 429, httpStatus: 429, retryAfterSeconds: 90 });
    const result = pollAiTask(get, 'task-1', { timeoutMs: 5000 }).catch((error) => error);
    await flush();
    await advance(5000);
    expect(await result).toMatchObject({ code: 'AI_POLL_TIMEOUT', taskId: 'task-1' });
    expect(get).toHaveBeenCalledTimes(1);
});
test('aborts an in-flight HTTP read at the total deadline', async () => {
    let requestSignal;
    const get = jest.fn((_, { signal }) => new Promise((resolve, reject) => {
        requestSignal = signal;
        signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED' }), { once: true });
    }));
    const result = pollAiTask(get, 'task-1', { timeoutMs: 800 }).catch((error) => error);
    await advance(800);
    expect(await result).toMatchObject({ code: 'AI_POLL_TIMEOUT', taskId: 'task-1' });
    expect(requestSignal.aborted).toBe(true);
});
test.each([false, true])('cancels waiting without cancelling/recreating server work (pre-aborted=%s)', async (preAborted) => {
    const controller = new AbortController();
    const get = jest.fn().mockResolvedValue({ errCode: 0, data: { status: 'pending' } });
    if (preAborted) controller.abort();
    const result = pollAiTask(get, 'task-1', { signal: controller.signal }).catch((error) => error);
    await flush();
    controller.abort();
    await flush();
    expect(await result).toMatchObject({ code: 'AI_POLL_CANCELLED', taskId: 'task-1' });
    expect(get).toHaveBeenCalledTimes(preAborted ? 0 : 1);
});
test.each([null, {}, { status: 'done' }, { status: 'surprise' }])('rejects malformed success data without looping: %j', async (data) => {
    const get = jest.fn().mockResolvedValue({ errCode: 0, data });
    await expect(pollAiTask(get, 'task-1')).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
    expect(get).toHaveBeenCalledTimes(1);
});
test('a durable model failure is terminal, not a network retry', async () => {
    const get = jest.fn().mockResolvedValue({ errCode: 0, data: { status: 'failed', error: 'EVENT_PAYLOAD_INVALID' } });
    await expect(pollAiTask(get, 'task-1')).rejects.toMatchObject({ code: 'AI_TASK_FAILED', message: 'EVENT_PAYLOAD_INVALID', taskId: 'task-1' });
    expect(get).toHaveBeenCalledTimes(1);
});
test.each([{ timeoutMs: 0 }, { timeoutMs: Infinity }, { intervalMs: -1 }, { intervalMs: NaN }])('rejects invalid polling bounds: %j', async (options) => {
    const get = jest.fn();
    await expect(pollAiTask(get, 'task-1', options)).rejects.toMatchObject({ code: 'AI_POLL_OPTIONS_INVALID' });
    expect(get).not.toHaveBeenCalled();
});
