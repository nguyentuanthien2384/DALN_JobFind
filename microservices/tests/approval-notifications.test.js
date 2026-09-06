import { describe, expect, it, vi } from 'vitest';
import { enqueueApprovalNotifications } from '../job-core-service/src/libs/approvalNotifications.js';
import { assertEventPayload } from '../shared/eventContract.js';
import { APPROVAL_NOTIFICATION_POLICY } from '../shared/jobNotificationPolicy.js';

const id = '11111111-1111-4111-8111-111111111111';
const post = { id: 7, userId: 5, timeEnd: '9000000000000' };
const detail = { name: 'Developer' };
const request = { jobId: 7, name: detail.name, descriptionHTML: '<p>Build</p>', moderationRequestId: id,
    notificationPolicy: APPROVAL_NOTIFICATION_POLICY };
const fixture = (saved = request, followers = [{ recipientId: 9, companyName: 'Example' }]) => {
    const conn = { query: vi.fn(async sql => {
        if (sql.startsWith('SELECT payload')) return [saved === null ? [] : [{ payload: saved }]];
        if (sql.startsWith('SELECT f.userId')) return [followers];
        return [{ affectedRows: 1 }];
    }) };
    return conn;
};
const inserts = conn => conn.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO outbox_events'));

describe('approval follower intents', () => {
    it('uses only the persisted request policy and freezes deduplicated recipients in batches of 100', async () => {
        const followers = Array.from({ length: 205 }, (_, i) => ({ recipientId: i + 1, companyName: 'Example' }));
        const conn = fixture(JSON.stringify(request), [...followers, followers[0], { recipientId: null }, { recipientId: -1 }]);
        await enqueueApprovalNotifications(conn, post, detail, id);
        expect(conn.query.mock.calls[0]).toEqual([expect.stringContaining('LOCK IN SHARE MODE'), [id, 'ai.moderate_job', '7']]);
        const batches = inserts(conn);
        expect(batches.map(([, args]) => args.length / 6)).toEqual([100, 100, 5]);
        const events = batches.flatMap(([, args]) => Array.from({ length: args.length / 6 }, (_, i) => args.slice(i * 6, i * 6 + 6)));
        expect(new Set(events.map(e => e[0])).size).toBe(205);
        for (const [eventId, aggregate, jobId, type, json, createdAt] of events) {
            expect(eventId).toMatch(/^[a-f0-9-]{36}$/); expect(aggregate).toBe('job-approval-notification');
            expect(type).toBe('notification.job_approved_requested'); expect(createdAt).toBeInstanceOf(Date);
            const data = JSON.parse(json);
            expect(() => assertEventPayload(type, data, { aggregateId: jobId })).not.toThrow();
            expect(data).toMatchObject({ decisionId: id, jobId: 7, jobTitle: 'Developer', companyName: 'Example' });
            expect(Object.keys(data).sort()).toEqual(['companyName', 'decisionId', 'jobId', 'jobTitle', 'recipientId']);
        }
        const read = conn.query.mock.calls[1];
        expect(read[0]).toContain("c.statusCode = 'S1' AND c.censorCode = 'CS1'");
        expect(read[0]).not.toMatch(/FOR UPDATE|LOCK IN SHARE/); expect(read[1]).toEqual([5]);
    });
    it('does not reinterpret unmarked historical requests under the new policy', async () => {
        const { notificationPolicy, ...old } = request;
        const conn = fixture(old);
        await enqueueApprovalNotifications(conn, post, detail, id);
        expect(conn.query).toHaveBeenCalledOnce();
    });
    it.each([null, '{bad', { ...request, notificationPolicy: 'future-v2' }, { ...request, moderationRequestId: '22222222-2222-4222-8222-222222222222' },
        { ...request, jobId: 8 }, { ...request, name: null }])('fails closed on absent/corrupt/mismatched policy evidence %#', async saved => {
        const conn = fixture(saved);
        await expect(enqueueApprovalNotifications(conn, post, detail, id)).rejects.toThrow();
        expect(inserts(conn)).toHaveLength(0);
    });
    it.each([null, '', 'bad', '0', '-1', String(Date.now() - 1), '8640000000000001', '9007199254740992'])('does not advertise an expired/unsafe deadline %s', async timeEnd => {
        const conn = fixture();
        await enqueueApprovalNotifications(conn, { ...post, timeEnd }, detail, id);
        expect(conn.query).toHaveBeenCalledOnce();
    });
    it('writes no intent when the eligible snapshot has no followers', async () => {
        const conn = fixture(request, []);
        await enqueueApprovalNotifications(conn, post, detail, id);
        expect(conn.query).toHaveBeenCalledTimes(2); expect(inserts(conn)).toHaveLength(0);
    });
    it('propagates a later batch failure so the decision transaction rolls back', async () => {
        const conn = fixture(request, Array.from({ length: 101 }, (_, i) => ({ recipientId: i + 1, companyName: 'E' })));
        const original = conn.query.getMockImplementation();
        let n = 0;
        conn.query.mockImplementation(async sql => {
            if (sql.startsWith('INSERT') && ++n === 2) throw new Error('batch failure');
            return original(sql);
        });
        await expect(enqueueApprovalNotifications(conn, post, detail, id)).rejects.toThrow('batch failure');
    });
});
