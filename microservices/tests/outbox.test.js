import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pool: { query: vi.fn() },
    withTransaction: vi.fn(),
    publish: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../job-core-service/src/libs/db.js', () => ({
    pool: mocks.pool,
    withTransaction: mocks.withTransaction
}));
vi.mock('../shared/outboxPublisher.js', () => ({ publishOutboxEvent: mocks.publish }));
vi.mock('../shared/logger.js', () => ({ createLogger: () => mocks.logger }));

beforeEach(() => {
    vi.resetModules();
    mocks.pool.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    mocks.withTransaction.mockReset();
    mocks.publish.mockReset().mockResolvedValue(undefined);
    for (const fn of Object.values(mocks.logger)) fn.mockReset();
});

describe('Job Core transactional outbox', () => {
    it.each([
        ['job.updated', 'legacy-job', 'legacy-backend'], ['job.updated', 'job', 'job-core-service'],
        ['job.updated', undefined, 'job-core-service'], ['job.created', 'legacy-job', 'legacy-backend'],
        ['job.created', 'job', 'job-core-service'], ['job.created', undefined, 'job-core-service'],
        ['notification.job_approved_requested', 'job-approval-notification', 'job-core-service'],
        ['job.deleted', 'legacy-job', 'job-core-service'],
        ['notification.manual_moderation_requested', 'manual-moderation-notification', 'legacy-backend']
    ])('preserves producer for %s with persisted aggregate marker %s', async (eventType, aggregateType, producer) => {
        const row = { id: 'stable-id', aggregateId: '7', aggregateType, eventType, createdAt: new Date(), payload: '{"job":{"id":7}}', attempts: 0 };
        const query = vi.fn().mockResolvedValue([[row]]);
        mocks.withTransaction.mockImplementation(work => work({ query }));
        const { runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');
        expect(await runOutboxOnce()).toBe(1);
        expect(query.mock.calls[0][0]).toContain('aggregateType');
        expect(mocks.publish).toHaveBeenCalledWith(eventType, JSON.parse(row.payload), { messageId: row.id, aggregateId: '7', occurredAt: row.createdAt, producer });
    });
    it.each(['job.created', 'job.updated'])('retries legacy %s with identical payload, ID and origin after confirm or DB-marker loss', async eventType => {
        const row = { id: 'stable-update', aggregateId: '7', aggregateType: 'legacy-job', eventType,
            createdAt: new Date(), payload: '{"job":{"id":7,"name":"Approved snapshot","statusCode":"PS1"}}', attempts: 0 };
        mocks.withTransaction.mockImplementation(work => work({ query: vi.fn().mockResolvedValue([[row]]) }));
        const { runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');
        mocks.publish.mockRejectedValueOnce(new Error('confirm lost'));
        expect(await runOutboxOnce()).toBe(0);
        expect(mocks.pool.query.mock.calls.some(([sql]) => sql.includes('SET publishedAt'))).toBe(false);
        mocks.pool.query.mockRejectedValueOnce(new Error('marker lost'));
        expect(await runOutboxOnce()).toBe(0); expect(await runOutboxOnce()).toBe(1);
        expect(mocks.publish).toHaveBeenCalledTimes(3);
        for (const call of mocks.publish.mock.calls) expect(call).toEqual([eventType, JSON.parse(row.payload), {
            messageId: row.id, aggregateId: '7', occurredAt: row.createdAt, producer: 'legacy-backend'
        }]);
    });
    it('relays legacy recipient intents with their persisted identity and producer across confirm/mark failure', async () => {
        const row = { id: 'stable-manual-1', aggregateId: '12', createdAt: new Date(),
            eventType: 'notification.manual_moderation_requested', payload: '{"jobId":12}', attempts: 0 };
        mocks.withTransaction.mockImplementation(work => work({ query: vi.fn().mockResolvedValue([[row]]) }));
        const { runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');
        mocks.publish.mockRejectedValueOnce(new Error('confirm lost'));
        await expect(runOutboxOnce()).resolves.toBe(0);
        expect(mocks.pool.query.mock.calls.some(([sql]) => sql.includes('SET publishedAt'))).toBe(false);
        mocks.pool.query.mockRejectedValueOnce(new Error('DB mark failed'));
        await expect(runOutboxOnce()).resolves.toBe(0);
        await expect(runOutboxOnce()).resolves.toBe(1);
        expect(mocks.publish).toHaveBeenCalledTimes(3);
        for (const call of mocks.publish.mock.calls) expect(call).toEqual([row.eventType, { jobId: 12 }, {
            messageId: row.id, aggregateId: '12', occurredAt: row.createdAt, producer: 'legacy-backend'
        }]);
    });
    it('refuses invalid payloads before any outbox INSERT', async () => {
        const { enqueueOutboxEvent } = await import('../job-core-service/src/libs/outbox.js');
        const conn = { query: vi.fn() };
        await expect(enqueueOutboxEvent(conn, { aggregateType: 'job', aggregateId: 12, eventType: 'job.created', payload: { job: { id: 12 } } })).rejects.toHaveProperty('code', 'EVENT_PAYLOAD_INVALID');
        expect(conn.query).not.toHaveBeenCalled();
    });
    it('creates an idempotent outbox table at startup', async () => {
        const { ensureOutboxTable } = await import('../job-core-service/src/libs/outbox.js');
        await ensureOutboxTable();
        expect(mocks.pool.query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS outbox_events'));
        expect(mocks.pool.query.mock.calls[0][0]).toContain('idx_outbox_pending');
    });

    it('writes the event using the caller transaction connection', async () => {
        const { enqueueOutboxEvent } = await import('../job-core-service/src/libs/outbox.js');
        const conn = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) };
        await enqueueOutboxEvent(conn, {
            eventId: 'event-1',
            aggregateType: 'job',
            aggregateId: 12,
            eventType: 'job.created',
            payload: { job: { id: 12, name: 'Developer', statusCode: 'PS1' } }
        });
        expect(conn.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO outbox_events'),
            ['event-1', 'job', '12', 'job.created', '{"job":{"id":12,"name":"Developer","statusCode":"PS1"}}', expect.any(Date)]
        );
    });

    it('publishes a committed event and marks it published', async () => {
        const conn = {
            query: vi.fn()
                .mockResolvedValueOnce([[
                    { id: 'event-1', aggregateId: '12', createdAt: new Date('2026-09-04T01:02:03Z'), eventType: 'job.created', payload: '{"job":{"id":12}}', attempts: 0 }
                ]])
                .mockResolvedValueOnce([{ affectedRows: 1 }])
        };
        mocks.withTransaction.mockImplementation((work) => work(conn));
        const { runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');

        await expect(runOutboxOnce()).resolves.toBe(1);
        expect(mocks.publish).toHaveBeenCalledWith('job.created', { job: { id: 12 } }, {
            messageId: 'event-1', aggregateId: '12', occurredAt: new Date('2026-09-04T01:02:03Z'), producer: 'job-core-service'
        });
        expect(mocks.pool.query).toHaveBeenCalledWith(
            expect.stringContaining('SET publishedAt'),
            [expect.any(Date), 'event-1', expect.any(String)]
        );
    });

    it('keeps a failed event pending with a retry timestamp', async () => {
        const conn = {
            query: vi.fn()
                .mockResolvedValueOnce([[
                    { id: 'event-2', eventType: 'job.updated', payload: '{"job":{"id":12}}', attempts: 1 }
                ]])
                .mockResolvedValueOnce([{ affectedRows: 1 }])
        };
        mocks.withTransaction.mockImplementation((work) => work(conn));
        mocks.publish.mockRejectedValueOnce(new Error('broker unavailable'));
        const { runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');

        await expect(runOutboxOnce()).resolves.toBe(0);
        expect(mocks.pool.query).toHaveBeenCalledWith(
            expect.stringContaining('SET nextAttemptAt'),
            [expect.any(Date), 'broker unavailable', 'event-2', expect.any(String)]
        );
    });
});
