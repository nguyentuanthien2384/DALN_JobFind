import { beforeEach, describe, expect, it, vi } from 'vitest';

const pgMock = vi.hoisted(() => {
    const state = { pool: null, options: [] };
    class Pool {
        constructor(options) {
            state.options.push(options);
            return state.pool;
        }
    }
    return { state, Pool };
});
vi.mock('pg', () => ({ default: { Pool: pgMock.Pool } }));

describe('application PostgreSQL adapter', () => {
    let pool;
    let client;

    beforeEach(() => {
        vi.resetModules();
        client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
        pool = { query: vi.fn(), connect: vi.fn().mockResolvedValue(client) };
        pgMock.state.pool = pool;
        pgMock.state.options = [];
    });

    it('exports ordered stage metadata and initializes the complete schema', async () => {
        pool.query.mockResolvedValue({});
        const db = await import('../application-service/src/libs/db.js');
        expect(db.STAGES).toEqual(['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi']);
        expect(db.STAGE_LABELS.phong_van).toBe('Phỏng vấn');
        await db.initSchema();
        expect(pool.query.mock.calls.map((x) => x[0]).join('\n')).toContain('ADD COLUMN IF NOT EXISTS decision_snapshot JSONB');
        expect(pool.query.mock.calls.map((x) => x[0]).join('\n')).toContain('CREATE TABLE IF NOT EXISTS talent_pool');
    });

    it('commits successful work and releases the client', async () => {
        const { withTransaction } = await import('../application-service/src/libs/db.js');
        await expect(withTransaction(async () => 'ok')).resolves.toBe('ok');
        expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
        expect(client.release).toHaveBeenCalledOnce();
    });

    it('rolls back failed work and releases the client', async () => {
        const { withTransaction } = await import('../application-service/src/libs/db.js');
        await expect(withTransaction(async () => { throw new Error('bad'); })).rejects.toThrow('bad');
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledOnce();
    });

    it('does not execute work or release an unacquired client when connection acquisition fails', async () => {
        const offline = Object.assign(new Error('PostgreSQL unavailable'), { code: 'ECONNREFUSED' });
        pool.connect.mockRejectedValueOnce(offline);
        const work = vi.fn();
        const { withTransaction } = await import('../application-service/src/libs/db.js');

        await expect(withTransaction(work)).rejects.toBe(offline);
        expect(work).not.toHaveBeenCalled();
        expect(client.query).not.toHaveBeenCalled();
        expect(client.release).not.toHaveBeenCalled();
    });

    it('never executes recruitment writes after BEGIN fails', async () => {
        const beginError = new Error('BEGIN failed');
        client.query.mockRejectedValueOnce(beginError);
        const work = vi.fn();
        const { withTransaction } = await import('../application-service/src/libs/db.js');

        await expect(withTransaction(work)).rejects.toBe(beginError);
        expect(work).not.toHaveBeenCalled();
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(client.query).not.toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalledOnce();
    });

    it('rejects a failed COMMIT instead of acknowledging a successful recruitment command', async () => {
        const commitError = new Error('COMMIT response lost');
        client.query.mockImplementation(async (sql) => {
            if (sql === 'COMMIT') throw commitError;
            return {};
        });
        const work = vi.fn().mockResolvedValue({ emailQueued: true });
        const { withTransaction } = await import('../application-service/src/libs/db.js');

        await expect(withTransaction(work)).rejects.toBe(commitError);
        expect(work).toHaveBeenCalledExactlyOnceWith(client);
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledOnce();
    });

    it.each(['work', 'COMMIT'])('preserves the %s failure and discards the client when rollback also fails', async (phase) => {
        const original = Object.assign(new Error(`${phase} failed`), { code: '40001' });
        const rollbackError = new Error('connection lost during ROLLBACK');
        client.query.mockImplementation(async (sql) => {
            if (sql === 'COMMIT' && phase === 'COMMIT') throw original;
            if (sql === 'ROLLBACK') throw rollbackError;
            return {};
        });
        const work = vi.fn(async () => {
            if (phase === 'work') throw original;
            return 'ok';
        });
        const { withTransaction } = await import('../application-service/src/libs/db.js');

        await expect(withTransaction(work)).rejects.toBe(original);
        expect(client.release).toHaveBeenCalledExactlyOnceWith(rollbackError);
    });

    it('checks server version', async () => {
        pool.query.mockResolvedValue({ rows: [{ version: 'PostgreSQL 16.1, x64' }] });
        const { testConnection } = await import('../application-service/src/libs/db.js');
        await testConnection();
        expect(pool.query).toHaveBeenCalledWith('SELECT version()');
    });
});
