import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { createContractValidator } from '../shared/requestContract.js';
import { schemas } from '../shared/contracts/schemas.js';
import { consumePostingQuota, PostingQuotaError } from '../job-core-service/src/libs/postingQuota.js';

const mocks = vi.hoisted(() => ({ conn: { query: vi.fn() } }));
vi.mock('../job-core-service/src/libs/db.js', () => ({
    pool: {}, withTransaction: (work) => work(mocks.conn)
}));
const identity = { userId: 7, companyId: 3 };
const validError = createContractValidator().compile(schemas.Error);
const tables = () => ['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }));
beforeEach(() => mocks.conn.query.mockReset()
    .mockResolvedValueOnce([tables()])
    .mockResolvedValueOnce([[{ id: 7, companyId: 3 }]])
    .mockResolvedValueOnce([[{ id: 3, statusCode: 'S1', censorCode: 'CS1' }]])
    .mockResolvedValueOnce([{ affectedRows: 1 }]));

describe('transactional posting quota', () => {
    it.each([undefined, false, 0, true, 1])('charges only the selected bucket (%s)', async (isHot) => {
        await consumePostingQuota(mocks.conn, { ...identity, isHot });
        const field = isHot ? 'allowHotPost' : 'allowPost';
        expect(mocks.conn.query.mock.calls.map(call => call[0])).toEqual([
            expect.stringContaining('information_schema.TABLES'),
            'SELECT id, companyId FROM users WHERE id = ? FOR UPDATE',
            'SELECT id, statusCode, censorCode FROM companies WHERE id = ? FOR UPDATE',
            `UPDATE companies SET ${field} = ${field} - 1 WHERE id = ? AND ${field} > 0`
        ]);
        expect(mocks.conn.query.mock.calls[1][1]).toEqual([7]);
        expect(mocks.conn.query.mock.calls[3][1]).toEqual([3]);
    });

    it.each(['0', '1', 'allowPost', null, {}, -1, 2])('rejects invalid direct-call hot flags (%s) before DB access', async isHot => {
        await expect(consumePostingQuota(mocks.conn, { ...identity, isHot })).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.conn.query).not.toHaveBeenCalled();
    });

    it.each([{ userId: null }, { companyId: null }, { userId: -1 }, { companyId: 0 }, { userId: 1.5 }])('requires a linked actor: %j', async overrides => {
        await expect(consumePostingQuota(mocks.conn, { ...identity, ...overrides })).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.conn.query).not.toHaveBeenCalled();
    });

    it.each(['users', 'companies', 'posts', 'detailposts'])('fails closed for nontransactional %s', async name => {
        mocks.conn.query.mockReset().mockResolvedValue([tables().map(t => t.name === name ? { ...t, engine: 'MyISAM' } : t)]);
        await expect(consumePostingQuota(mocks.conn, identity)).rejects.toMatchObject({ statusCode: 503 });
        expect(mocks.conn.query).toHaveBeenCalledTimes(1);
    });

    it('fails closed for a missing participating table', async () => {
        mocks.conn.query.mockReset().mockResolvedValue([tables().slice(1)]);
        await expect(consumePostingQuota(mocks.conn, identity)).rejects.toBeInstanceOf(PostingQuotaError);
        expect(mocks.conn.query).toHaveBeenCalledTimes(1);
    });

    it.each([[], [{ id: 7, companyId: 9 }], [{ id: 7, companyId: null }]].map(rows => ({ rows })))('refuses missing/moved membership: %j', async ({ rows }) => {
        mocks.conn.query.mockReset().mockResolvedValueOnce([tables()]).mockResolvedValueOnce([rows]);
        await expect(consumePostingQuota(mocks.conn, identity)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.conn.query).toHaveBeenCalledTimes(2);
    });

    it.each([[], [{ statusCode: 'S2', censorCode: 'CS1' }], [{ statusCode: 'S1', censorCode: 'CS2' }]].map(rows => ({ rows })))('refuses missing/ineligible companies: %j', async ({ rows }) => {
        mocks.conn.query.mockReset().mockResolvedValueOnce([tables()])
            .mockResolvedValueOnce([[{ id: 7, companyId: 3 }]]).mockResolvedValueOnce([rows]);
        await expect(consumePostingQuota(mocks.conn, identity)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.conn.query).toHaveBeenCalledTimes(3);
    });

    it.each([false, true])('returns a contract-valid quota error without creating a post (hot=%s)', async isHot => {
        mocks.conn.query.mockReset().mockResolvedValueOnce([tables()])
            .mockResolvedValueOnce([[{ id: 7, companyId: 3 }]])
            .mockResolvedValueOnce([[{ statusCode: 'S1', censorCode: 'CS1' }]])
            .mockResolvedValueOnce([{ affectedRows: 0 }]);
        const { createJob } = await import('../job-core-service/src/controllers/jobController.js');
        const res = makeRes();
        await createJob(makeReq({ headers: { 'x-user-id': '7', 'x-company-id': '3' },
            body: { name: 'Job', descriptionHTML: 'Work', categoryJobCode: 'IT', isHot } }), res);
        expect(res.statusCode).toBe(409);
        expect(res.body).toEqual({ errCode: 2, errMessage: expect.stringContaining(isHot ? 'nổi bật' : 'bình thường') });
        expect(validError(res.body)).toBe(true);
        expect(mocks.conn.query).toHaveBeenCalledTimes(4);
    });
});
