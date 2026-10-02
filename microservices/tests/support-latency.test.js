import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { hedgeMiddleware } from '../support-chat-service/src/hedge.js';
import { answerKey, createAnswerCache } from '../support-chat-service/src/answerCache.js';
import { configuredProviders, createResponder } from '../support-chat-service/src/providers.js';
import { registerSupportRoutes } from '../support-chat-service/src/http.js';

const secret = 'support-service-test-secret-32-characters';
const servers = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }))); });
const later = (ms, value, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
});
// A fake provider: each call takes the next planned delay/outcome and records its signal.
const plannedModel = plan => {
    const calls = [];
    return { calls, doStream: vi.fn(params => {
        const step = plan[calls.length];
        calls.push(params.abortSignal);
        return step.error ? later(step.ms, null, params.abortSignal).then(() => { throw step.error; }) : later(step.ms, { stream: step.name }, params.abortSignal);
    }) };
};
const hedged = (model, options) => hedgeMiddleware({ delayMs: 30, ...options }).wrapStream({ doStream: () => model.doStream({}), params: {}, model });

describe('hedged gateway requests', () => {
    it('uses a single request when the first one answers in time', async () => {
        const model = plannedModel([{ ms: 5, name: 'first' }]), onHedge = vi.fn();
        expect(await hedged(model, { onHedge })).toEqual({ stream: 'first' });
        await later(50);
        expect(model.doStream).toHaveBeenCalledTimes(1);
        expect(onHedge).not.toHaveBeenCalled();
    });
    it('sends a second request when the first is slow and cancels the loser', async () => {
        const model = plannedModel([{ ms: 400, name: 'slow' }, { ms: 10, name: 'fast' }]), onHedge = vi.fn();
        expect(await hedged(model, { onHedge })).toEqual({ stream: 'fast' });
        expect(onHedge).toHaveBeenCalledWith('slow');
        expect(model.calls[0].aborted).toBe(true);
        expect(model.calls[1].aborted).toBe(false);
    });
    it('keeps the first request when it still answers first after the hedge started', async () => {
        const model = plannedModel([{ ms: 60, name: 'first' }, { ms: 500, name: 'second' }]);
        expect(await hedged(model)).toEqual({ stream: 'first' });
        expect(model.calls[1].aborted).toBe(true);
    });
    it('retries a fast server failure at once but not a rejected request', async () => {
        const retried = plannedModel([{ ms: 1, error: Object.assign(new Error('bad gateway'), { statusCode: 502 }) }, { ms: 5, name: 'retry' }]);
        expect(await hedged(retried, { delayMs: 10000 })).toEqual({ stream: 'retry' });
        const rejected = plannedModel([{ ms: 1, error: Object.assign(new Error('bad request'), { statusCode: 400 }) }]);
        await expect(hedged(rejected)).rejects.toThrow('bad request');
        expect(rejected.doStream).toHaveBeenCalledTimes(1);
    });
    it('fails only after every request failed and stops both when the caller aborts', async () => {
        const failing = plannedModel([{ ms: 50, error: new Error('first down') }, { ms: 60, error: new Error('second down') }]);
        await expect(hedged(failing)).rejects.toThrow('second down');
        const controller = new AbortController();
        const model = plannedModel([{ ms: 500, name: 'a' }, { ms: 500, name: 'b' }]);
        const pending = hedgeMiddleware({ delayMs: 10 }).wrapStream({ doStream: () => model.doStream({}), params: { abortSignal: controller.signal }, model });
        await later(30); controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(model.calls.every(signal => signal.aborted)).toBe(true);
    });
    it('passes straight through when hedging is off', async () => {
        const doStream = vi.fn(async () => ({ stream: 'direct' }));
        expect(await hedgeMiddleware({ delayMs: 0 }).wrapStream({ doStream, params: {}, model: {} })).toEqual({ stream: 'direct' });
    });
    it('is configured for Claude with a default, an override and an off switch', () => {
        expect(configuredProviders({ ANTHROPIC_API_KEY: 'test' })[0].hedgeMs).toBe(4000);
        expect(configuredProviders({ ANTHROPIC_API_KEY: 'test', SUPPORT_HEDGE_MS: '3500' })[0].hedgeMs).toBe(3500);
        expect(configuredProviders({ ANTHROPIC_API_KEY: 'test', SUPPORT_HEDGE_MS: '0' })[0].hedgeMs).toBe(0);
        expect(configuredProviders({ ANTHROPIC_API_KEY: 'test', SUPPORT_HEDGE_MS: 'abc' })[0].hedgeMs).toBe(4000);
    });
});

describe('opening answer cache', () => {
    it('normalizes keys and expires and evicts entries', () => {
        expect(answerKey('  Tôi muốn  tạo CV và ứng tuyển?? ')).toBe(answerKey('tôi muốn tạo cv và ứng tuyển'));
        expect(answerKey('Kế toán')).not.toBe(answerKey('Kế toàn'));
        let now = 0;
        const cache = createAnswerCache({ ttlMs: 100, max: 2, now: () => now });
        cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
        expect([cache.get('a'), cache.get('b'), cache.get('c')]).toEqual([1, null, 3]);
        now = 101;
        expect(cache.get('a')).toBeNull();
        const off = createAnswerCache({ ttlMs: 0 }); off.set('a', 1);
        expect(off.get('a')).toBeNull();
    });
    const stream = text => ({ fullStream: (async function* () { yield { type: 'text-delta', text }; })(), finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({}) });
    const ask = (respond, text, extra = {}) => {
        const emit = vi.fn();
        return respond({ messages: [{ role: 'user', text, status: 'complete' }], signal: new AbortController().signal, emit, ...extra }).then(answer => ({ answer, emit }));
    };
    it('replays a recent model answer to the same opening question without calling the model', async () => {
        const executePublicTool = vi.fn(async () => ({ jobs: [{ id: 'external-a16a0d2c3e4e', name: 'Kế toán' }], total: 1 }));
        const generate = vi.fn(args => ({ fullStream: (async function* () { await args.tools.search_jobs.execute({ query: 'kế toán', location: '' }); yield { type: 'text-delta', text: 'Có 1 tin.\n[[GOI_Y]] Lọc theo Hà Nội | Mẹo CV' }; })(),
            finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({}) }));
        const audit = vi.fn();
        const respond = createResponder({ providers: [{ name: 'claude' }], executePublicTool, generate, audit, retrieve: async () => [], answerCache: createAnswerCache() });
        const first = await ask(respond, 'Có việc kế toán nào?');
        const second = await ask(respond, 'có việc kế toán nào');
        expect(generate).toHaveBeenCalledTimes(1);
        expect(second.answer).toMatchObject({ text: 'Có 1 tin.', mode: 'claude', status: 'complete', suggestions: ['Lọc theo Hà Nội', 'Mẹo CV'] });
        expect(second.answer.cards).toEqual(first.answer.cards);
        expect(second.emit).toHaveBeenCalledWith('tool', { name: 'search_jobs', jobs: first.answer.cards });
        expect(second.emit).toHaveBeenCalledWith('suggestions', { suggestions: ['Lọc theo Hà Nội', 'Mẹo CV'] });
        expect(audit).toHaveBeenCalledWith({ event: 'support.answer_cache_hit', provider: 'claude' });
    });
    it('asks the model again for regenerations, follow-up turns and after a fallback answer', async () => {
        const generate = vi.fn(() => stream('Trả lời mới'));
        const respond = createResponder({ providers: [{ name: 'claude' }], generate, retrieve: async () => [], answerCache: createAnswerCache() });
        await ask(respond, 'Mẹo phỏng vấn');
        await ask(respond, 'Mẹo phỏng vấn', { cacheable: false });
        await respond({ messages: [{ role: 'user', text: 'Chào', status: 'complete' }, { role: 'assistant', text: 'Chào bạn', status: 'complete' },
            { role: 'user', text: 'Mẹo phỏng vấn', status: 'complete' }], signal: new AbortController().signal, emit: vi.fn() });
        expect(generate).toHaveBeenCalledTimes(3);
        const offline = createResponder({ providers: [], retrieve: async () => [], answerCache: createAnswerCache() });
        await ask(offline, 'Mẹo phỏng vấn');
        expect((await ask(offline, 'Mẹo phỏng vấn')).answer.mode).toBe('knowledge');
    });
    it('reports tool progress and trims blank lines a backend puts before the answer', async () => {
        const executePublicTool = vi.fn(async () => ({ jobs: [], total: 0 }));
        const generate = args => ({ fullStream: (async function* () { await args.tools.search_jobs.execute({ query: 'x', location: '' }); yield { type: 'text-delta', text: '\n\n  Chưa có tin.' }; })(),
            finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({}) });
        const { answer, emit } = await ask(createResponder({ providers: [{ name: 'claude' }], executePublicTool, generate, retrieve: async () => [] }), 'Tìm việc x');
        const events = emit.mock.calls.map(([event, payload]) => event === 'status' ? `status:${payload.stage}:${payload.name || ''}` : event);
        expect(events.slice(0, 4)).toEqual(['sources', 'status:tool:search_jobs', 'tool', 'status:writing:']);
        expect(answer.text).toBe('Chưa có tin.');
        expect(emit.mock.calls.filter(([event]) => event === 'token').map(([, payload]) => payload.text).join('')).toBe('Chưa có tin.');
    });
    it('turn route bypasses the cache when the visitor regenerates an answer', async () => {
        vi.stubEnv('INTERNAL_SECRET', secret);
        const requestId = randomUUID(), conversationId = randomUUID();
        const state = { id: conversationId, version: 2, answerId: randomUUID(), messages: [{ id: requestId, role: 'user', text: 'Mẹo CV', status: 'complete' }] };
        const store = { begin: vi.fn(async () => state), finish: vi.fn(async () => {}) };
        const respond = vi.fn(async ({ emit }) => { emit('token', { text: 'Đáp' }); return { text: 'Đáp', status: 'complete' }; });
        const app = express(); registerSupportRoutes(app, { store, tools: {}, respond, env: { INTERNAL_SECRET: secret } });
        const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); servers.push(server);
        const base = `http://127.0.0.1:${server.address().port}`;
        const headers = { 'x-internal-secret': secret, 'Content-Type': 'application/json', 'x-user-id': '7', 'x-user-role': 'CANDIDATE' };
        await (await fetch(`${base}/support/turn`, { method: 'POST', headers, body: JSON.stringify({ requestId, text: 'Mẹo CV' }) })).text();
        await (await fetch(`${base}/support/turn`, { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), text: 'Mẹo CV', conversationId, version: 2, replaceFrom: requestId }) })).text();
        expect(respond.mock.calls.map(([options]) => options.cacheable)).toEqual([true, false]);
    });
});
