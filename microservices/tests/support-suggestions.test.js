import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createResponder, systemPrompt } from '../support-chat-service/src/providers.js';
import { fallbackSuggestions, parseSuggestions, visibleText } from '../support-chat-service/src/suggestions.js';
import { createStore } from '../support-chat-service/src/store.js';
import { guestIdentity } from '../support-chat-service/src/policy.js';
import { registerSupportRoutes } from '../support-chat-service/src/http.js';

const secret = 'support-service-test-secret-32-characters';
const messages = [{ role: 'user', text: 'tìm việc kế toán', status: 'complete' }];
const stream = (...parts) => ({ fullStream: (async function* () { for (const text of parts) yield { type: 'text-delta', text }; })(),
    finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({ inputTokens: 5, outputTokens: 8 }) });
const run = (respond, emit = vi.fn()) => respond({ messages, signal: new AbortController().signal, emit });
const servers = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }))); });

describe('quick-reply line', () => {
    it('holds back a line that may become the marker and never shows the marker', () => {
        expect(visibleText('Xin chào\n[')).toBe('Xin chào\n');
        expect(visibleText('Xin chào\n[[GOI_Y]] A | B')).toBe('Xin chào\n');
        expect(visibleText('Có 11 tin. [[GOI_Y]] A | B')).toBe('Có 11 tin. ');
        expect(visibleText('Có 11 tin. [[GO')).toBe('Có 11 tin. ');
        expect(visibleText('Xem [tin')).toBe('Xem [tin');
        expect(visibleText('Xem [tin](/job)')).toBe('Xem [tin](/job)');
        expect(visibleText('Mảng [[1, 2], [3]] và hơn nữa')).toBe('Mảng [[1, 2], [3]] và hơn nữa');
        expect(visibleText('Kết thúc\n[', true)).toBe('Kết thúc\n[');
    });
    it('parses, cleans, de-duplicates and bounds suggestions', () => {
        expect(parseSuggestions('Trả lời\n[[GOI_Y]] **Tìm việc IT** | tìm việc IT | Mẹo CV | x | Hỏi thêm | Câu thứ năm')).toEqual(['Tìm việc IT', 'Mẹo CV', 'Hỏi thêm']);
        expect(parseSuggestions('[[Gợi ý]]\n- Mẹo phỏng vấn\n- Việc ở Đà Nẵng')).toEqual(['Mẹo phỏng vấn', 'Việc ở Đà Nẵng']);
        expect(parseSuggestions('Có 11 tin. [[GOI_Y]] Xem tin Jollibee | Việc làm công nghệ')).toEqual(['Xem tin Jollibee', 'Việc làm công nghệ']);
        expect(parseSuggestions('Không có dòng gợi ý')).toEqual([]);
        expect(parseSuggestions(`[[GOI_Y]] ${'a'.repeat(81)}`)).toEqual([]);
    });
    it('chooses fallback suggestions from tool results and topics', () => {
        expect(fallbackSuggestions({ tools: [{ name: 'search_jobs', count: 0 }] })[0]).toBe('Xem các việc mới nhất');
        expect(fallbackSuggestions({ tools: [{ name: 'search_jobs', count: 3 }] })[0]).toBe('Xem chi tiết tin đầu tiên');
        expect(fallbackSuggestions({ sources: [{ id: 'account' }] })[0]).toBe('Tôi không nhận được mã OTP');
        expect(fallbackSuggestions({ sources: [{ id: 'employer' }], tools: [{ name: 'job_market_overview', count: 0 }] }))
            .toEqual(['Xem các việc mới nhất', 'Ở Hà Nội có bao nhiêu việc?', 'Có việc IT nào đang tuyển?']);
        expect(fallbackSuggestions()).toHaveLength(3);
    });
});

describe('responder with quick replies and external jobs', () => {
    it('streams the answer without the marker split across deltas and returns model suggestions', async () => {
        const emit = vi.fn();
        const answer = await run(createResponder({ providers: [{ name: 'claude' }], generate: () => stream('Có 4 tin kế toán.\n', '[', '[GOI_Y]] Lọc theo Hà Nội | Mẹo CV kế toán'), retrieve: async () => [] }), emit);
        const shown = emit.mock.calls.filter(([event]) => event === 'token').map(([, payload]) => payload.text).join('');
        expect(shown).toBe('Có 4 tin kế toán.\n');
        expect(answer).toMatchObject({ text: 'Có 4 tin kế toán.', status: 'complete', suggestions: ['Lọc theo Hà Nội', 'Mẹo CV kế toán'] });
        expect(emit).toHaveBeenCalledWith('suggestions', { suggestions: ['Lọc theo Hà Nội', 'Mẹo CV kế toán'] });
    });
    it('falls back to context suggestions when the model omits the line', async () => {
        const executePublicTool = vi.fn(async () => ({ jobs: [], total: 0 }));
        const answer = await run(createResponder({ providers: [{ name: 'claude' }], executePublicTool, retrieve: async () => [],
            generate: args => ({ fullStream: (async function* () { await args.tools.search_jobs.execute({ query: 'kế toán', location: '' }); yield { type: 'text-delta', text: 'Chưa có tin phù hợp.' }; })(),
                finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({}) }) }));
        expect(answer.text).toBe('Chưa có tin phù hợp.');
        expect(answer.suggestions[0]).toBe('Xem các việc mới nhất');
    });
    it('keeps external job cards and rejects malformed job IDs', async () => {
        const jobs = [{ id: 'external-a16a0d2c3e4e', name: 'Lập trình PL/SQL' }, { id: 'external-<script>', name: 'x' }, { id: 12, name: 'Kế toán' }];
        const executePublicTool = vi.fn(async () => ({ jobs, total: 3 }));
        const answer = await run(createResponder({ providers: [{ name: 'claude' }], executePublicTool, retrieve: async () => [],
            generate: args => ({ fullStream: (async function* () { await args.tools.search_jobs.execute({ query: '', location: '' }); yield { type: 'text-delta', text: 'Đây là các tin.' }; })(),
                finishReason: Promise.resolve('stop'), totalUsage: Promise.resolve({}) }) }));
        expect(answer.cards.map(job => job.id)).toEqual(['external-a16a0d2c3e4e', 12]);
    });
    it('accepts external IDs in get_job_details and offers the market overview tool', async () => {
        let settings;
        await run(createResponder({ providers: [{ name: 'claude' }], executePublicTool: vi.fn(async () => ({ total: 0 })), retrieve: async () => [], generate: args => { settings = args; return stream('Được'); } }));
        const schema = settings.tools.get_job_details.inputSchema;
        expect(schema.safeParse({ job_id: 'external-a16a0d2c3e4e' }).success).toBe(true);
        expect(schema.safeParse({ job_id: 42 }).success).toBe(true);
        expect(schema.safeParse({ job_id: '42' }).success).toBe(true);
        expect(schema.safeParse({ job_id: '0' }).success).toBe(false);
        expect(schema.safeParse({ job_id: 'external-../../x' }).success).toBe(false);
        expect(settings.tools.job_market_overview.inputSchema.safeParse({ location: 'Hà Nội' }).success).toBe(true);
        expect(settings.instructions[0].content).toContain('[[GOI_Y]]');
        expect(settings.instructions[0].providerOptions).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
        expect(settings.instructions[1].content).toMatch(/^Hôm nay là \d{4}-\d{2}-\d{2}/);
        expect(settings.instructions[1].providerOptions).toBeUndefined();
        expect(systemPrompt([], Date.parse('2026-10-01T20:00:00Z'))).toContain('Hôm nay là 2026-10-02');
    });
    it('offers suggestions with the reviewed knowledge fallback', async () => {
        const answer = await run(createResponder({ providers: [], retrieve: async () => [{ id: 'cv', title: 'CV', href: '/support/help#cv', text: 'Hướng dẫn' }] }));
        expect(answer.mode).toBe('knowledge');
        expect(answer.suggestions[0]).toBe('Mẹo viết CV cho người mới đi làm');
    });
    it('summarises a market overview when the provider fails after the tool call', async () => {
        const executePublicTool = vi.fn(async () => ({ total: 97, topLocations: [{ name: 'Hà Nội', count: 30 }, { name: 'Hồ Chí Minh', count: 25 }] }));
        const answer = await run(createResponder({ providers: [{ name: 'claude' }], executePublicTool, retrieve: async () => [],
            generate: args => ({ fullStream: (async function* () { await args.tools.job_market_overview.execute({ location: '' }); yield { type: 'error', error: 'offline' }; })() }) }));
        expect(answer).toMatchObject({ mode: 'public_tool', text: 'Hiện có 97 tin tuyển dụng đang mở; nhiều nhất: Hà Nội (30), Hồ Chí Minh (25).' });
    });
});

describe('answer feedback', () => {
    const answerId = randomUUID();
    const fixture = (lease = 0, status = 'complete') => {
        const row = { id: randomUUID(), owner_key: 'user:7', title: 'Hỏi', version: 3, lease_until: lease, created_at: 1, updated_at: 1, expires_at: Date.now() + 86400000,
            messages: JSON.stringify([{ id: randomUUID(), role: 'user', text: 'Hỏi', status: 'complete' }, { id: answerId, role: 'assistant', text: 'Đáp', status }]) };
        const query = vi.fn(async sql => sql.startsWith('SELECT') ? [[row]] : [{ affectedRows: 1 }]);
        const connection = { query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
        return { row, query, store: createStore({ query, getConnection: async () => connection }) };
    };
    it('stores a rating on a completed answer without changing the conversation version', async () => {
        const { row, query, store } = fixture();
        await store.feedback('user:7', row.id, answerId, 'up');
        const [sql, values] = query.mock.calls.find(([text]) => text.startsWith('UPDATE'));
        expect(sql).not.toContain('version');
        expect(JSON.parse(values[0])[1]).toMatchObject({ id: answerId, feedback: 'up' });
        row.messages = values[0];
        await store.feedback('user:7', row.id, answerId, null);
        expect(JSON.parse(query.mock.calls.filter(([text]) => text.startsWith('UPDATE')).at(-1)[1][0])[1].feedback).toBeUndefined();
    });
    it('rejects ratings while an answer is streaming or for unknown and unfinished answers', async () => {
        await expect(fixture(Date.now() + 60000).store.feedback('user:7', randomUUID(), answerId, 'up')).rejects.toMatchObject({ status: 409 });
        await expect(fixture(0, 'failed').store.feedback('user:7', randomUUID(), answerId, 'up')).rejects.toMatchObject({ status: 404 });
        await expect(fixture().store.feedback('user:7', randomUUID(), randomUUID(), 'down')).rejects.toMatchObject({ status: 404 });
    });
    it('exposes a validated feedback route scoped to the conversation owner', async () => {
        vi.stubEnv('INTERNAL_SECRET', secret);
        const store = { feedback: vi.fn(async () => {}) }, audit = vi.fn();
        const app = express(); registerSupportRoutes(app, { store, tools: {}, respond: vi.fn(), audit, env: { INTERNAL_SECRET: secret } });
        const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); servers.push(server);
        const base = `http://127.0.0.1:${server.address().port}`;
        const guest = guestIdentity(null, secret);
        const conversation = randomUUID(), message = randomUUID();
        const post = body => fetch(`${base}/support/conversations/${conversation}/messages/${message}/feedback`, { method: 'POST',
            headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json', 'x-support-guest': guest.token }, body: JSON.stringify(body) });
        expect((await post({ value: 'down' })).status).toBe(200);
        expect(store.feedback).toHaveBeenCalledWith(guest.owner, conversation, message, 'down');
        expect(audit).toHaveBeenCalledWith({ event: 'support.feedback', value: 'down' });
        expect((await post({ value: 'love' })).status).toBe(400);
        expect((await post({ value: 'up', text: 'extra' })).status).toBe(400);
        expect(store.feedback).toHaveBeenCalledTimes(1);
    });
});
