import { describe, expect, it, vi } from 'vitest';
import { ensureAiResultTables, requestJobModeration, cancelJobModeration, moderationContentHash } from '../job-core-service/src/libs/moderationState.js';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('../job-core-service/src/libs/outbox.js', () => ({ enqueueOutboxEvent: mocks.enqueue }));
const tables = ['posts', 'detailposts', 'ai_tasks', 'outbox_events', 'job_moderation_state', 'ai_result_inbox'];

describe('moderation request fence', () => {
    it('adds new tables without altering legacy business tables and verifies transactional storage', async () => {
        const db = { query: vi.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([tables.map((name) => ({ name, engine: 'InnoDB' }))]) };
        await ensureAiResultTables(db);
        expect(db.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS job_moderation_state');
        expect(db.query.mock.calls[1][0]).toContain('ascii_bin');
        expect(db.query.mock.calls.every(([sql]) => !/ALTER|DROP|DELETE/i.test(sql))).toBe(true);
    });
    it.each(['MyISAM', 'missing'])('fails closed with %s tables', async (mode) => {
        const db = { query: vi.fn().mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([mode === 'missing' ? [] : tables.map((name) => ({ name, engine: 'MyISAM' }))]) };
        await expect(ensureAiResultTables(db)).rejects.toThrow('InnoDB');
    });
    it('uses one fresh request token for both the state row and the outgoing event', async () => {
        const conn = { query: vi.fn().mockResolvedValue([{}]) };
        const job = { id: 7, name: 'Title', descriptionHTML: '<p>A</p>' };
        const first = await requestJobModeration(conn, job);
        const second = await requestJobModeration(conn, job);
        expect(first).not.toBe(second);
        expect(conn.query.mock.calls[0][1]).toEqual([7, first, moderationContentHash(job), expect.any(Date), first, moderationContentHash(job), expect.any(Date)]);
        expect(mocks.enqueue).toHaveBeenCalledWith(conn, expect.objectContaining({ eventId: first, payload: { jobId: 7, name: job.name, descriptionHTML: job.descriptionHTML, moderationRequestId: first, notificationPolicy: 'approval-v1' } }));
        expect(conn.query.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]);
    });
    it('cancels outstanding moderation inside the delete transaction', async () => {
        const conn = { query: vi.fn() };
        await cancelJobModeration(conn, 7);
        expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("state = 'cancelled'"), [expect.any(Date), 7]);
    });
});
