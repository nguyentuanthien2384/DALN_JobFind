import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => ({ pool: { query: vi.fn() } }));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: mocks.pool, withTransaction: vi.fn() }));
import { getTask } from '../job-core-service/src/controllers/aiController.js';

const task = { id: 'task-1', type: 'match_cv', status: 'done', userId: 9,
    input: JSON.stringify({ jobId: 7, companyId: 3 }), result: JSON.stringify({ score: 80, summary: 'Private analysis' }),
    error: null, createdAt: '2026-09-24', updatedAt: '2026-09-24' };
const read = async (role = 'EMPLOYER', user = '9') => {
    const res = makeRes();
    await getTask(makeReq({ params: { taskId: 'task-1' }, headers: { 'x-user-id': user, 'x-user-role': role } }), res);
    return res;
};
beforeEach(() => { mocks.pool.query.mockReset().mockResolvedValueOnce([[{ ...task }]]).mockResolvedValue([[{ companyId: 3 }]]); });

describe('recruiter AI results remain within their original company', () => {
    it.each(['EMPLOYER', 'COMPANY'])('allows %s to read its own task after fresh account/company authorization', async role => {
        const res = await read(role);
        expect(res.body.data.result.score).toBe(80);
        expect(mocks.pool.query).toHaveBeenCalledTimes(2);
        const [sql, params] = mocks.pool.query.mock.calls[1];
        expect(params).toEqual([9, 3]);
        expect(sql).toContain('c.id = viewer.companyId');
        expect(sql).toContain("c.statusCode = 'S1'");
        expect(sql).toContain("c.censorCode = 'CS1'");
        expect(sql).toContain("viewerAccount.statusCode = 'S1'");
        expect(sql).toContain("viewerAccount.roleCode IN ('COMPANY', 'EMPLOYER')");
    });

    it.each(['moved company', 'revoked approval', 'disabled company', 'disabled account', 'changed account role'])('immediately denies a completed result after %s', async () => {
        mocks.pool.query.mockReset().mockResolvedValueOnce([[task]]).mockResolvedValue([[]]);
        const res = await read();
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toHaveProperty('data');
        expect(JSON.stringify(res.body)).not.toContain('Private analysis');
    });

    it.each(['pending', 'failed'])('also denies a %s task after company access is revoked', async status => {
        mocks.pool.query.mockReset().mockResolvedValueOnce([[{ ...task, status, result: null }]]).mockResolvedValue([[]]);
        expect((await read()).statusCode).toBe(403);
    });

    it.each([null, undefined, '{}', '{', 'null', '[]', '{"companyId":null}', '{"companyId":"3"}', '{"companyId":0}'])('fails closed for missing or invalid tenant metadata: %s', async input => {
        mocks.pool.query.mockReset().mockResolvedValueOnce([[{ ...task, input }]]);
        expect((await read()).statusCode).toBe(403);
        expect(mocks.pool.query).toHaveBeenCalledOnce();
    });

    it('cannot bypass tenant ownership after the actor changes into a candidate', async () => {
        expect((await read('CANDIDATE')).statusCode).toBe(403);
        expect(mocks.pool.query).toHaveBeenCalledOnce();
    });

    it('does not expose another actor task even in the same company', async () => {
        expect((await read('EMPLOYER', '10')).statusCode).toBe(403);
        expect(mocks.pool.query).toHaveBeenCalledOnce();
    });

    it('preserves candidate task ownership without company metadata', async () => {
        mocks.pool.query.mockReset().mockResolvedValueOnce([[{ ...task, type: 'generate_cv', input: '{"language":"vi"}' }]]);
        expect((await read('CANDIDATE')).body.data.type).toBe('generate_cv');
        expect(mocks.pool.query).toHaveBeenCalledOnce();
    });

    it('preserves admin review access without requiring original company membership', async () => {
        expect((await read('ADMIN', '1')).body.data.result.score).toBe(80);
        expect(mocks.pool.query).toHaveBeenCalledOnce();
    });

    it('does not allow recruiters to read candidate generation tasks', async () => {
        mocks.pool.query.mockReset().mockResolvedValueOnce([[{ ...task, type: 'generate_cv' }]]);
        expect((await read()).statusCode).toBe(403);
        expect(mocks.pool.query).toHaveBeenCalledOnce();
    });
});
