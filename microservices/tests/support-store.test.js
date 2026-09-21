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
