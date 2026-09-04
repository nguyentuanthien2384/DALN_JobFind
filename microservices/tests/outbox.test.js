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
vi.mock('../shared/rabbitmq.js', () => ({ publish: mocks.publish }));
vi.mock('../shared/logger.js', () => ({ createLogger: () => mocks.logger }));

beforeEach(() => {
    vi.resetModules();
    mocks.pool.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    mocks.withTransaction.mockReset();
    mocks.publish.mockReset().mockResolvedValue(undefined);
    for (const fn of Object.values(mocks.logger)) fn.mockReset();
});

describe('Job Core transactional outbox', () => {
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
            payload: { job: { id: 12 } }
        });
        expect(conn.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO outbox_events'),
            ['event-1', 'job', '12', 'job.created', '{"job":{"id":12}}', expect.any(Date)]
        );
    });

    it('publishes a committed event and marks it published', async () => {
        const conn = {
            query: vi.fn()
                .mockResolvedValueOnce([[
                    { id: 'event-1', eventType: 'job.created', payload: '{"job":{"id":12}}', attempts: 0 }
                ]])
                .mockResolvedValueOnce([{ affectedRows: 1 }])
        };
        mocks.withTransaction.mockImplementation((work) => work(conn));
        const { runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');

        await expect(runOutboxOnce()).resolves.toBe(1);
        expect(mocks.publish).toHaveBeenCalledWith('job.created', { job: { id: 12 } });
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
