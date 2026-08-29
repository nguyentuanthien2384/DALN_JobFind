import { beforeEach, describe, expect, it, vi } from 'vitest';

const mysql = vi.hoisted(() => ({ createPool: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createPool: mysql.createPool } }));

describe('job-core MySQL adapter', () => {
    let conn;
    let pool;

    beforeEach(() => {
        vi.resetModules();
        conn = {
            ping: vi.fn().mockResolvedValue(undefined),
            beginTransaction: vi.fn().mockResolvedValue(undefined),
            commit: vi.fn().mockResolvedValue(undefined),
            rollback: vi.fn().mockResolvedValue(undefined),
            release: vi.fn()
        };
        pool = { getConnection: vi.fn().mockResolvedValue(conn) };
        mysql.createPool.mockReset().mockReturnValue(pool);
    });

    it('creates a correctly configured pool and verifies connectivity', async () => {
        const db = await import('../job-core-service/src/libs/db.js');
        expect(mysql.createPool).toHaveBeenCalledWith(expect.objectContaining({ connectionLimit: 10, charset: 'utf8mb4_general_ci' }));
        await db.testConnection();
        expect(conn.ping).toHaveBeenCalledOnce();
        expect(conn.release).toHaveBeenCalledOnce();
    });

    it('commits successful transactions and returns their value', async () => {
        const { withTransaction } = await import('../job-core-service/src/libs/db.js');
        const value = await withTransaction(async (received) => {
            expect(received).toBe(conn);
            return 42;
        });
        expect(value).toBe(42);
        expect(conn.beginTransaction).toHaveBeenCalledBefore(conn.commit);
        expect(conn.rollback).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledOnce();
    });

    it('rolls back errors and always releases the connection', async () => {
        const { withTransaction } = await import('../job-core-service/src/libs/db.js');
        await expect(withTransaction(async () => { throw new Error('bad'); })).rejects.toThrow('bad');
        expect(conn.rollback).toHaveBeenCalledOnce();
        expect(conn.commit).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledOnce();
    });
});
