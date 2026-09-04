import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    mysqlPool: { query: vi.fn(), getConnection: vi.fn() },
    saveNotification: vi.fn(), getUserEmail: vi.fn()
}));
vi.mock('../notification-service/src/libs/channels.js', () => mocks);
import { queueNotification, ensureDeliveryTables, claimDelivery, finishDelivery } from '../notification-service/src/libs/deliveryStore.js';

const request = {
    eventId: 'e1', userId: 2, recipientEmail: 'snapshot@x.com',
    template: { typeCode: 'APPLICATION_STAGE', content: 'Interview', link: '/x', email: { subject: 'S', html: 'H', text: 'T' } }
};

// Transactional test double: serialize transactions, commit snapshots, discard rollbacks.
// This verifies application failure boundaries, not MySQL's own locking implementation.
const database = () => {
    let committed = { inbox: {}, notifications: [], deliveries: [] };
    let gate = Promise.resolve();
    const control = { failDelivery: false, loseCommitResponse: false, connections: [] };
    mocks.mysqlPool.getConnection.mockImplementation(async () => {
        let local;
        let unlock;
        const connection = {
            beginTransaction: vi.fn(async () => {
                const previous = gate;
                gate = new Promise((resolve) => { unlock = resolve; });
                await previous;
                local = structuredClone(committed);
            }),
            commit: vi.fn(async () => {
                committed = local;
                if (control.loseCommitResponse) throw new Error('commit response lost');
            }),
            rollback: vi.fn(async () => {}),
            release: vi.fn(() => unlock?.()),
            query: vi.fn(async (sql, args) => {
                if (sql.includes('INSERT INTO notification_inbox')) {
                    const key = JSON.stringify(args);
                    local.inbox[key] ??= { notificationId: null };
                    return [{ affectedRows: 1 }];
                }
                if (sql.startsWith('SELECT notificationId')) return [[local.inbox[JSON.stringify(args)]]];
                if (sql.startsWith('INSERT INTO notifications ')) {
                    const id = local.notifications.length + 1;
                    local.notifications.push({ id, ...args[0] });
                    return [{ insertId: id }];
                }
                if (sql.includes('INSERT INTO notification_deliveries')) {
                    if (control.failDelivery && args[2] === 'email') throw new Error('delivery storage failed');
                    if (local.deliveries.some((row) => JSON.stringify(row.slice(0, 3)) === JSON.stringify(args.slice(0, 3)))) {
                        throw new Error('duplicate channel intent');
                    }
                    local.deliveries.push(args);
                    return [{ affectedRows: 1 }];
                }
                if (sql.startsWith('UPDATE notification_inbox')) {
                    local.inbox[JSON.stringify(args.slice(1))].notificationId = args[0];
                    return [{ affectedRows: 1 }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            })
        };
        control.connections.push(connection);
        return connection;
    });
    mocks.saveNotification.mockImplementation(async (data, connection) => {
        const [result] = await connection.query('INSERT INTO notifications (...)', [data]);
        return { id: result.insertId, ...data };
    });
    mocks.getUserEmail.mockResolvedValue({ email: 'lookup@x.com' });
    return { control, state: () => committed };
};

beforeEach(() => {
    mocks.mysqlPool.query.mockReset();
    mocks.mysqlPool.getConnection.mockReset();
    mocks.saveNotification.mockReset();
    mocks.getUserEmail.mockReset();
});

describe('notification durable inbox', () => {
    it('commits one notification and one intent per channel across concurrent redeliveries', async () => {
        const db = database();
        const results = await Promise.all(Array.from({ length: 5 }, () => queueNotification(request)));
        expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
        expect(new Set(results.map((result) => result.notificationId)).size).toBe(1);
        expect(db.state().notifications).toHaveLength(1);
        expect(db.state().deliveries).toHaveLength(2);
        expect(mocks.saveNotification).toHaveBeenCalledOnce();
        expect(mocks.getUserEmail).not.toHaveBeenCalled();
        const email = JSON.parse(db.state().deliveries.find((row) => row[2] === 'email')[3]);
        expect(email).toMatchObject({ to: 'snapshot@x.com', subject: 'S', text: 'T' });
        expect(email.messageId).toMatch(/^<[a-f0-9]{64}@jobfind.local>$/);
        for (const connection of db.control.connections) expect(connection.release).toHaveBeenCalledOnce();
    });

    it('rolls back notification, inbox and all intents together if one intent fails', async () => {
        const db = database();
        db.control.failDelivery = true;
        await expect(queueNotification(request)).rejects.toThrow('delivery storage failed');
        expect(db.state()).toEqual({ inbox: {}, notifications: [], deliveries: [] });
        expect(db.control.connections[0].rollback).toHaveBeenCalledOnce();
        expect(db.control.connections[0].commit).not.toHaveBeenCalled();
        db.control.failDelivery = false;
        expect(await queueNotification(request)).toMatchObject({ duplicate: false });
        expect(db.state().notifications).toHaveLength(1);
    });

    it('deduplicates after a successful commit whose response was lost', async () => {
        const db = database();
        db.control.loseCommitResponse = true;
        await expect(queueNotification(request)).rejects.toThrow('commit response lost');
        db.control.loseCommitResponse = false;
        expect(await queueNotification(request)).toMatchObject({ duplicate: true });
        expect(db.state().notifications).toHaveLength(1);
        expect(db.state().deliveries).toHaveLength(2);
    });

    it('keeps recipients independent and allows an explicit resend with a new event ID', async () => {
        const db = database();
        await queueNotification(request);
        await queueNotification({ ...request, userId: 3 });
        await queueNotification({ ...request, eventId: 'e2' });
        await queueNotification({ ...request, template: { ...request.template, content: 'Changed on replay' } });
        expect(db.state().notifications).toHaveLength(3);
        expect(db.state().notifications[0].content).toBe('Interview');
        expect(new Set(db.state().deliveries.filter((row) => row[2] === 'email').map((row) => JSON.parse(row[3]).messageId)).size).toBe(3);
    });

    it('looks up a missing snapshot address inside the same transaction', async () => {
        const db = database();
        await queueNotification({ ...request, recipientEmail: undefined });
        expect(mocks.getUserEmail).toHaveBeenCalledWith(2, db.control.connections[0]);
        expect(JSON.parse(db.state().deliveries[1][3]).to).toBe('lookup@x.com');
    });

    it('rejects invalid identities before opening a transaction', async () => {
        database();
        await expect(queueNotification({ ...request, eventId: 'bad id' })).rejects.toThrow('eventId');
        await expect(queueNotification({ ...request, userId: -1 })).rejects.toThrow('recipientId');
        expect(mocks.mysqlPool.getConnection).not.toHaveBeenCalled();
    });
});

describe('delivery schema and lease guards', () => {
    it('creates both tables and verifies transactional storage at startup', async () => {
        mocks.mysqlPool.query.mockImplementation(async (sql) => sql.includes('information_schema')
            ? [[{ engine: 'InnoDB' }, { engine: 'InnoDB' }, { engine: 'InnoDB' }]] : [{}]);
        await ensureDeliveryTables();
        expect(mocks.mysqlPool.query.mock.calls[0][0]).toContain('PRIMARY KEY (eventId, recipientId)');
        expect(mocks.mysqlPool.query.mock.calls[1][0]).toContain('UNIQUE KEY notification_delivery_event_recipient_channel');
    });

    it.each([
        { tables: [] },
        { tables: [{ engine: 'MyISAM' }, { engine: 'InnoDB' }, { engine: 'InnoDB' }] }
    ])('refuses startup without transactional notification tables: $tables', async ({ tables }) => {
        mocks.mysqlPool.query.mockImplementation(async (sql) => sql.includes('information_schema') ? [tables] : [{}]);
        await expect(ensureDeliveryTables()).rejects.toThrow('InnoDB');
    });

    it('commits the claim before returning it and fences result updates by lock token', async () => {
        const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn() };
        connection.query.mockImplementation(async (sql) => sql.includes('SELECT *')
            ? [[{ id: 9, channel: 'email', attempts: 0, payload: '{}' }]] : [{ affectedRows: 1 }]);
        mocks.mysqlPool.getConnection.mockResolvedValue(connection);
        const row = await claimDelivery();
        expect(row).toMatchObject({ id: 9, attempts: 1, lockToken: expect.any(String) });
        expect(connection.commit).toHaveBeenCalledOnce();
        expect(connection.release).toHaveBeenCalledOnce();
        expect(connection.query.mock.calls[0][0]).toContain("WHEN channel = 'email' THEN 'unknown' ELSE 'pending'");
        expect(connection.query.mock.calls[1][0]).toContain('FOR UPDATE');
        mocks.mysqlPool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
        expect(await finishDelivery(row, { status: 'sent' })).toBe(false);
        expect(mocks.mysqlPool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'processing' AND lockToken = ?"), ['sent', null, 0, 2, 9, row.lockToken]);
    });

    it('does not spend the retry budget while configuration is missing', async () => {
        mocks.mysqlPool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
        await finishDelivery({ id: 9, attempts: 1, lockToken: 'token' }, { status: 'pending', error: 'email_not_configured', attempted: false });
        expect(mocks.mysqlPool.query).toHaveBeenCalledWith(expect.stringContaining('attempts = GREATEST(0, attempts - ?)'), ['pending', 'email_not_configured', 1, 60, 9, 'token']);
    });
});
