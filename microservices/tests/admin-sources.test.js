import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => {
    const state = { pgPool: null, pgOptions: [] };
    class PgPool {
        constructor(options) {
            state.pgOptions.push(options);
            return state.pgPool;
        }
    }
    return { createPool: vi.fn(), PgPool, state };
});
vi.mock('mysql2/promise', () => ({ default: { createPool: deps.createPool } }));
vi.mock('pg', () => ({ default: { Pool: deps.PgPool } }));

describe('admin read-only data sources', () => {
    let mysqlPool;
    let pgPool;
    let conn;

    beforeEach(() => {
        vi.resetModules();
        conn = { ping: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
        mysqlPool = { getConnection: vi.fn().mockResolvedValue(conn) };
        pgPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        deps.createPool.mockReset().mockReturnValue(mysqlPool);
        deps.state.pgPool = pgPool;
        deps.state.pgOptions = [];
    });

    it('creates bounded pools and verifies both data sources', async () => {
        const { testSources } = await import('../admin-service/src/libs/sources.js');
        expect(deps.createPool).toHaveBeenCalledWith(expect.objectContaining({ connectionLimit: 5 }));
        expect(deps.state.pgOptions[0]).toEqual(expect.objectContaining({ max: 5 }));
        await testSources();
        expect(conn.ping).toHaveBeenCalledOnce();
        expect(conn.release).toHaveBeenCalledOnce();
        expect(pgPool.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('always releases MySQL and tolerates an unavailable PostgreSQL report source', async () => {
        pgPool.query.mockRejectedValue(new Error('down'));
        const { testSources } = await import('../admin-service/src/libs/sources.js');
        await expect(testSources()).resolves.toBeUndefined();
        expect(conn.release).toHaveBeenCalledOnce();
    });
});
