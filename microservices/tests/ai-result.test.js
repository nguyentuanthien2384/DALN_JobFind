import { describe, expect, it, vi } from 'vitest';
import { createAiResultHandler } from '../job-core-service/src/libs/aiResultHandler.js';
import { moderationContentHash } from '../job-core-service/src/libs/moderationState.js';
import { validateAiResult } from '../job-core-service/src/libs/aiResultValidation.js';
import { aiResultRetry } from '../job-core-service/src/libs/aiResultRetry.js';
import { decodeEventFixture } from './contractAssertions.js';
import { assertEventPayload } from '../shared/eventContract.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const detail = { name: 'Developer', descriptionHTML: '<p>Build</p>' };
const payload = { jobId: 7, type: 'moderate_job', moderationRequestId: requestId, ok: true, result: { approved: true, reason: 'OK' } };
const metadata = { eventId: 'result-1', aggregateId: '7' };
const makeFixture = ({ post = { id: 7, detailPostId: 3, statusCode: 'PS3', userId: 5 },
    request = { requestId, contentHash: moderationContentHash(detail), state: 'pending' }, source = detail,
    task = { id: 'task-1', type: 'parse_resume', status: 'pending' } } = {}) => {
    const conn = { query: vi.fn(async (sql) => {
        if (sql.startsWith('SELECT id, detailPostId')) return [post ? [post] : []];
        if (sql.startsWith('SELECT requestId')) return [request ? [request] : []];
        if (sql.startsWith('SELECT name')) return [source ? [source] : []];
        if (sql.startsWith('SELECT id, type')) return [task ? [task] : []];
        return [{ affectedRows: 1 }];
    }) };
    const enqueue = vi.fn().mockResolvedValue('outbox-id');
    const transaction = vi.fn((work) => work(conn));
    return { conn, enqueue, transaction, handle: createAiResultHandler({ transaction, enqueue }) };
};

describe('transactional AI results', () => {
    it('accepts a typed moderation result and emits a matching validated downstream event', async () => {
        const f = makeFixture();
        const decoded = decodeEventFixture('ai.result', payload);
        expect(await f.handle(decoded.payload, decoded.metadata)).toEqual({ outcome: 'applied' });
        const outgoing = f.enqueue.mock.calls[0][1];
        expect(() => assertEventPayload(outgoing.eventType, outgoing.payload, { aggregateId: outgoing.aggregateId })).not.toThrow();
    });
    it.each(['parse_resume', 'match_cv', 'cover_letter'])('accepts a typed %s success/failure into its task inbox', async (type) => {
        const results = { parse_resume: { fullName: null, skills: [] }, match_cv: { score: 80 }, cover_letter: { letter: 'Synthetic letter' } };
        for (const ok of [true, false]) {
            const f = makeFixture({ task: { id: 'task-1', type, status: 'pending' } });
            const data = { taskId: 'task-1', type, ok, ...(ok ? { result: results[type] } : { error: 'EVENT_PAYLOAD_INVALID' }) };
            const decoded = decodeEventFixture('ai.result', data);
            await f.handle(decoded.payload, decoded.metadata);
            const write = f.conn.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE ai_tasks'));
            expect(write[1][0]).toBe(ok ? 'done' : 'failed');
            expect(f.enqueue).not.toHaveBeenCalled();
        }
    });
    it('commits the inbox, moderation state, status and outgoing event on the same connection', async () => {
        const f = makeFixture();
        expect(await f.handle(payload, metadata)).toEqual({ outcome: 'applied' });
        expect(f.transaction).toHaveBeenCalledOnce();
        expect(f.conn.query.mock.calls[0][0]).toContain('INSERT INTO ai_result_inbox');
        expect(f.conn.query.mock.calls[1][0]).toContain('FOR UPDATE');
        expect(f.conn.query.mock.calls.at(-1)[1]).toEqual(['applied', expect.any(Date), 'result-1']);
        expect(f.enqueue).toHaveBeenCalledWith(f.conn, {
            aggregateType: 'job', aggregateId: 7, eventType: 'job.moderated',
            payload: { jobId: 7, posterId: 5, jobTitle: 'Developer', approved: true, statusCode: 'PS1', reason: 'OK', moderationRequestId: requestId }
        });
    });
    it('bubbles outbox failure so transaction ownership can roll back everything', async () => {
        const f = makeFixture();
        f.enqueue.mockRejectedValue(new Error('outbox write failed'));
        await expect(f.handle(payload, metadata)).rejects.toThrow('outbox write failed');
        expect(f.conn.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE ai_result_inbox'))).toBe(false);
    });
    it('skips a previously committed event and rejects ID reuse with different content', async () => {
        const f = makeFixture();
        const identity = validateAiResult(payload, metadata);
        f.conn.query.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' })
            .mockResolvedValueOnce([[{ payloadHash: identity.payloadHash, outcome: 'applied' }]]);
        expect(await f.handle(payload, metadata)).toEqual({ outcome: 'duplicate' });
        expect(f.enqueue).not.toHaveBeenCalled();
        f.conn.query.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' })
            .mockResolvedValueOnce([[{ payloadHash: 'different', outcome: 'applied' }]]);
        await expect(f.handle(payload, metadata)).rejects.toHaveProperty('code', 'AI_RESULT_ID_CONFLICT');
    });
    it.each([
        { post: null }, { request: null },
        { request: { requestId: '22222222-2222-4222-8222-222222222222', state: 'pending' } },
        { request: { requestId, state: 'applied' } },
        { post: { id: 7, detailPostId: 3, statusCode: 'PS4' } },
        { post: { id: 7, detailPostId: 3, statusCode: 'PS1' } },
        { post: { id: 7, detailPostId: 3, statusCode: 'PS2' } },
        { source: { ...detail, name: 'Edited via legacy' } }, { source: null }
    ])('does not apply stale, removed or manually reviewed moderation %#', async (changes) => {
        const f = makeFixture(changes);
        expect(await f.handle(payload, metadata)).toEqual({ outcome: 'stale' });
        expect(f.enqueue).not.toHaveBeenCalled();
        expect(f.conn.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE posts'))).toBe(false);
    });
    it('keeps PS3 on model failure, closes that request and emits no rejection notification', async () => {
        const f = makeFixture();
        expect(await f.handle({ ...payload, ok: false, result: undefined, error: 'timeout' }, metadata)).toEqual({ outcome: 'failed' });
        expect(f.conn.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE posts'))).toBe(false);
        expect(f.conn.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE job_moderation_state'))[1][0]).toBe('failed');
        expect(f.enqueue).not.toHaveBeenCalled();
    });
    it.each(['done', 'failed'])('never overwrites a task already %s, even with a new event ID or no event ID', async (status) => {
        const f = makeFixture({ task: { id: 'task-1', type: 'parse_resume', status } });
        expect(await f.handle({ taskId: 'task-1', type: 'parse_resume', ok: true, result: {} })).toEqual({ outcome: 'already_completed' });
        expect(f.conn.query).toHaveBeenCalledOnce();
    });
    it('stores large results as complete valid JSON instead of slicing through a JSON string', async () => {
        const f = makeFixture();
        const result = { text: 'ắ'.repeat(65000) };
        await f.handle({ taskId: 'task-1', type: 'parse_resume', ok: true, result }, { eventId: 'task-result' });
        const write = f.conn.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE ai_tasks'));
        expect(JSON.parse(write[1][1])).toEqual(result);
    });
    it.each([null, { id: 'TASK-1', type: 'parse_resume', status: 'pending' }, { id: 'task-1', type: 'cover_letter', status: 'pending' }])('rejects an absent, case-mismatched or wrong-type task %#', async (task) => {
        const f = makeFixture({ task });
        await expect(f.handle({ taskId: 'task-1', type: 'parse_resume', ok: true, result: {} })).rejects.toThrow();
        expect(f.conn.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE ai_tasks'))).toBe(false);
    });
});

describe('AI result validation and retry', () => {
    it.each([
        null, { ...payload, ok: 'true' }, { ...payload, type: 'unknown' },
        { ...payload, moderationRequestId: undefined }, { ...payload, taskId: 'wrong-target' },
        { ...payload, result: { approved: 'false' } }, { ...payload, result: { approved: true, reason: {} } },
        { taskId: 't', type: 'parse_resume', ok: true, result: null },
        { taskId: 't', type: 'parse_resume', ok: false },
        { taskId: 't', type: 'parse_resume', ok: true, result: { text: 'x'.repeat(1024 * 1024) } }
    ])('rejects malformed/unattributable results before any DB transaction %#', async (value) => {
        const f = makeFixture();
        await expect(f.handle(value)).rejects.toThrow();
        expect(f.transaction).not.toHaveBeenCalled();
    });
    it('normalizes payload key order and validates event and aggregate identity', () => {
        expect(validateAiResult(payload).payloadHash).toBe(validateAiResult({ result: { reason: 'OK', approved: true }, ok: true, type: payload.type, jobId: 7, moderationRequestId: requestId }).payloadHash);
        expect(() => validateAiResult(payload, { aggregateId: 8 })).toThrow('mismatch');
        expect(() => validateAiResult(payload, { eventId: '' })).toThrow('eventId');
    });
    it('retries only recognized transient database errors on identified result events', () => {
        expect(aiResultRetry.delaysMs).toEqual([2000, 10000, 30000]);
        for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST']) {
            expect(aiResultRetry.shouldRetry({ code }, { metadata })).toBe(true);
            expect(aiResultRetry.shouldRetry({ code }, { metadata: {} })).toBe(false);
        }
        for (const code of ['ER_NO_SUCH_TABLE', 'AI_RESULT_UNCORRELATED', 'AI_RESULT_ID_CONFLICT', 'ER_ACCESS_DENIED_ERROR']) {
            expect(aiResultRetry.shouldRetry({ code }, { metadata })).toBe(false);
        }
    });
});
