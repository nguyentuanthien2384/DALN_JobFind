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
        expect(pool.query).toHaveBeenCalledTimes(9);
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

    it('checks server version', async () => {
        pool.query.mockResolvedValue({ rows: [{ version: 'PostgreSQL 16.1, x64' }] });
        const { testConnection } = await import('../application-service/src/libs/db.js');
        await testConnection();
        expect(pool.query).toHaveBeenCalledWith('SELECT version()');
    });
});
