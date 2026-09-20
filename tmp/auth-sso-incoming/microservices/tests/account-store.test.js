import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    end: vi.fn(),
    createPool: vi.fn()
}));

vi.mock('mysql2/promise', () => ({
    default: {
        createPool: mocks.createPool
    }
}));

beforeEach(() => {
    vi.resetModules();
    mocks.query.mockReset();
    mocks.end.mockReset().mockResolvedValue(undefined);
    mocks.createPool.mockReset().mockReturnValue({ query: mocks.query, end: mocks.end });
});

describe('gateway current-account resolver', () => {
    it('reads current role/company/status from MySQL and normalizes identifiers', async () => {
        mocks.query.mockResolvedValue([[{
            id: '7', companyId: '3', roleCode: 'EMPLOYER', statusCode: 'S1',
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        }]]);
        const { resolveCurrentIdentity } = await import('../api-gateway/src/libs/accountStore.js');
        await expect(resolveCurrentIdentity(7)).resolves.toEqual({
            id: 7, companyId: 3, roleCode: 'EMPLOYER', statusCode: 'S1',
            companyStatusCode: 'S1', companyCensorCode: 'CS1'
        });
        expect(mocks.query.mock.calls[0][0]).toContain('INNER JOIN accounts');
        expect(mocks.query.mock.calls[0][0]).toContain('LEFT JOIN companies');
        expect(mocks.query.mock.calls[0][1]).toEqual([7]);
    });

    it('requires an unrevoked active session family when a JWT carries sid', async () => {
        mocks.query.mockResolvedValueOnce([[{ id: 7, companyId: null, roleCode: 'CANDIDATE', statusCode: 'S1' }]]);
        const { resolveCurrentIdentity } = await import('../api-gateway/src/libs/accountStore.js');
        const sid = 'ed4c58b5-f10d-470d-a398-61fa03c6395c';
        await expect(resolveCurrentIdentity(7, sid)).resolves.toMatchObject({ id: 7 });
        expect(mocks.query.mock.calls[0][0]).toContain('FROM AuthSessions');
        expect(mocks.query.mock.calls[0][0]).toContain('s.revokedAt IS NULL');
        expect(mocks.query.mock.calls[0][1]).toEqual([7, sid]);
        expect(await resolveCurrentIdentity(7, '../bad')).toBeNull();
    });

    it('rejects invalid/missing users, preserves null company, and closes cleanly', async () => {
        const { resolveCurrentIdentity, closeAccountStore } = await import('../api-gateway/src/libs/accountStore.js');
        await expect(resolveCurrentIdentity('bad')).resolves.toBeNull();
        expect(mocks.query).not.toHaveBeenCalled();

        mocks.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[
            {
                id: 8, companyId: null, roleCode: 'CANDIDATE', statusCode: 'S1',
                companyStatusCode: null, companyCensorCode: null
            }
        ]]);
        await expect(resolveCurrentIdentity(99)).resolves.toBeNull();
        await expect(resolveCurrentIdentity(8)).resolves.toMatchObject({ companyId: null });
        await closeAccountStore();
        expect(mocks.end).toHaveBeenCalledOnce();
    });
});
