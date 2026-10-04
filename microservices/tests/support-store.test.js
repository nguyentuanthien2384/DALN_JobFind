import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStore } from '../support-chat-service/src/store.js';

const history = turns => Array.from({ length: turns }, (_, index) => [
    { id: randomUUID(), role: 'user', text: `Câu hỏi ${index + 1}`, status: 'complete' },
    { id: randomUUID(), role: 'assistant', text: `Câu trả lời ${index + 1}`, status: 'complete', sources: [] }
]).flat();

// Capture writes at the SQL boundary; the separate MySQL integration suite covers
// transactions and ownership against the real database.
function fixture(messages) {
    const now = Date.now();
    const row = {
        id: randomUUID(), owner_key: 'user:7', title: messages[0].text,
        messages: JSON.stringify(messages), version: 99, request_id: randomUUID(),
        lease_until: 0, created_at: now - 86400000, updated_at: now, expires_at: now + 86400000
    };
    const query = vi.fn(async sql => {
        if (sql.startsWith('SELECT * FROM support_conversations')) return [[row]];
        if (sql.startsWith('UPDATE support_conversations')) return [{ affectedRows: 1 }];
        throw new Error(`Unexpected SQL: ${sql}`);
    });
    const connection = { query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    const store = createStore({ query, getConnection: async () => connection });
    const input = { conversationId: row.id, version: row.version, requestId: randomUUID(),
        parentId: messages.at(-1).id, text: 'Câu hỏi tiếp theo' };
    return { store, row, query, connection, input };
}

describe('support conversation history preservation', () => {
    it('retains every earlier message beyond 40 and saves the complete answer transcript', async () => {
        const earlier = history(30);
        const { store, query, input } = fixture(earlier);
        const state = await store.begin('user:7', input);
        expect(state.messages).toHaveLength(62);
        expect(state.messages.slice(0, earlier.length)).toEqual(earlier);
        const beginWrite = query.mock.calls.find(([sql]) => sql.startsWith('UPDATE'));
        expect(JSON.parse(beginWrite[1][1]).slice(0, earlier.length)).toEqual(earlier);
        expect(beginWrite[1][0]).toBe('Câu hỏi 1');

        await store.finish('user:7', state, { text: 'Câu trả lời mới', status: 'complete' });
        const transcript = JSON.parse(query.mock.calls.at(-1)[1][0]);
        expect(transcript).toHaveLength(62);
        expect(transcript.slice(0, earlier.length)).toEqual(earlier);
        expect(transcript.at(-1)).toMatchObject({ id: state.answerId, text: 'Câu trả lời mới', status: 'complete' });
    });

    it('allows the hundredth turn without removing any earlier messages', async () => {
        const earlier = history(99);
        const { store, input } = fixture(earlier);
        const state = await store.begin('user:7', input);
        expect(state.messages).toHaveLength(200);
        expect(state.messages.slice(0, 198)).toEqual(earlier);
    });

    it('rejects an additional turn at the limit without writing or modifying the saved transcript', async () => {
        const { store, row, query, connection, input } = fixture(history(100));
        const saved = row.messages;
        await expect(store.begin('user:7', input)).rejects.toMatchObject({ status: 409,
            message: expect.stringContaining('Hãy tạo cuộc trò chuyện mới') });
        expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
        expect(row.messages).toBe(saved);
        expect(connection.commit).not.toHaveBeenCalled();
        expect(connection.rollback).toHaveBeenCalledOnce();
        expect(connection.release).toHaveBeenCalledOnce();
    });

    it('allows explicitly editing an earlier question in a full conversation', async () => {
        const earlier = history(100);
        const { store, input } = fixture(earlier);
        const state = await store.begin('user:7', { ...input, replaceFrom: earlier[100].id });
        expect(state.messages).toHaveLength(102);
        expect(state.messages.slice(0, 100)).toEqual(earlier.slice(0, 100));
        expect(state.messages[100]).toMatchObject({ id: input.requestId, text: input.text });
        expect(state.messages.some(message => message.id === earlier[100].id)).toBe(false);
    });

    it('allows regenerating the latest answer at the limit and preserves all previous turns', async () => {
        const earlier = history(100);
        const { store, input } = fixture(earlier);
        const state = await store.begin('user:7', { ...input, replaceFrom: earlier[198].id, text: earlier[198].text });
        expect(state.messages).toHaveLength(200);
        expect(state.messages.slice(0, 198)).toEqual(earlier.slice(0, 198));
        expect(state.messages[198].text).toBe(earlier[198].text);
    });

    it('replays the last completed request even when its conversation is full', async () => {
        const earlier = history(100);
        const { store, row, query, input } = fixture(earlier);
        row.request_id = earlier[198].id;
        const state = await store.begin('user:7', { ...input, requestId: row.request_id, text: earlier[198].text });
        expect(state.replay).toBe(true);
        expect(state.messages).toEqual(earlier);
        expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    });
});

function handoffFixture(overrides = {}) {
    const row = { id: randomUUID(), user_id: 7, agent_id: null, status: 'waiting', delivered_at: null,
        messages: JSON.stringify(history(1)), ...overrides };
    const query = vi.fn(async (sql, values) => {
        if (sql.startsWith('SELECT h.*')) return [[{ ...row }]];
        if (sql.startsWith('UPDATE support_handoffs')) {
            [row.agent_id, row.status] = values;
            return [{ affectedRows: 1 }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    });
    const connection = { query, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
    return { store: createStore({ query, getConnection: async () => connection }), row, query, connection };
}

describe('support handoff administrative handling', () => {
    it('allows an administrator to claim and resolve their own ticket without a self chat delivery', async () => {
        const { store, row, query } = handoffFixture();
        const claimed = await store.claim(row.id, 7, false, { roleCode: 'ADMIN' });
        expect(claimed).toMatchObject({ userId: 7, agentId: 7, status: 'assigned', delivered: false });
        expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
        const resolved = await store.claim(row.id, 7, true, { roleCode: 'ADMIN' });
        expect(resolved).toMatchObject({ userId: 7, agentId: 7, status: 'resolved', delivered: false });
        expect(row.delivered_at).toBeNull();
    });

    it.each([undefined, 'CANDIDATE', 'COMPANY', 'EMPLOYER'])('keeps self claims forbidden without verified administrator role: %s', async roleCode => {
        const { store, row, query, connection } = handoffFixture();
        await expect(store.claim(row.id, 7, false, { roleCode })).rejects.toMatchObject({ status: 409 });
        expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
        expect(connection.rollback).toHaveBeenCalledOnce();
    });

    it('requires claiming an own ticket before resolving it', async () => {
        const { store, row } = handoffFixture();
        await expect(store.claim(row.id, 7, true, { roleCode: 'ADMIN' })).rejects.toMatchObject({ status: 409,
            message: expect.stringContaining('tiếp nhận') });
    });

    it('still requires successful chat delivery before resolving a ticket from another user', async () => {
        const { store, row } = handoffFixture({ user_id: 8, agent_id: 7, status: 'assigned' });
        await expect(store.claim(row.id, 7, true, { roleCode: 'ADMIN' })).rejects.toMatchObject({ status: 409,
            message: expect.stringContaining('Tin nhắn') });
    });

    it.each([
        { agent_id: 9, status: 'assigned' },
        { agent_id: 7, status: 'resolved' }
    ])('does not silently override another assignment or reopen a resolved ticket: %j', async assigned => {
        const { store, row, query } = handoffFixture(assigned);
        await expect(store.claim(row.id, 7, false, { roleCode: 'ADMIN' })).rejects.toMatchObject({ status: 409 });
        expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    });
});
