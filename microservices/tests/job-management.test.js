import { beforeEach, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { getManagedJob } from '../job-core-service/src/controllers/jobManagementController.js';
import { jobRevision } from '../shared/jobRevision.js';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: { query: mocks.query } }));
const request = (headers = {}, id = '12') => makeReq({ params: { id }, headers: {
    'x-user-id': '7', 'x-company-id': '3', 'x-user-role': 'COMPANY', ...headers
} });
beforeEach(() => mocks.query.mockReset());

it.each(['PS1', 'PS2', 'PS3', 'PS4'])('reads managed %s jobs with tenant/content in one query and no writes', async statusCode => {
    const job = { id: 12, detailPostId: 21, name: 'Private job', statusCode };
    mocks.query.mockResolvedValueOnce([[job]]);
    const res = makeRes();
    await getManagedJob(request(), res);
    const { detailPostId, ...publicFields } = job;
    expect(res.body).toEqual({ errCode: 0, data: { ...publicFields, editRevision: jobRevision(job) } });
    expect(res.body.data).not.toHaveProperty('detailPostId');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(mocks.query).toHaveBeenCalledOnce();
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual([7, 12, 3]);
    for (const part of ['JOIN users actor', 'actor.companyId = ?', 'owner.companyId = actor.companyId', "c.statusCode = 'S1'", "c.censorCode = 'CS1'"]) expect(sql).toContain(part);
    expect(sql).not.toMatch(/SELECT \*|p\.statusCode =|job_moderation_state|FOR UPDATE/);
});
it('permits ADMIN inspection outside a company while requiring an existing actor', async () => {
    mocks.query.mockResolvedValueOnce([[{ id: 12 }]]);
    await getManagedJob(request({ 'x-user-role': 'ADMIN', 'x-company-id': '' }), makeRes());
    expect(mocks.query.mock.calls[0][1]).toEqual([7, 12]);
    expect(mocks.query.mock.calls[0][0]).toContain('JOIN users actor ON actor.id = ?');
    expect(mocks.query.mock.calls[0][0]).not.toContain('actor.companyId = ?');
});
it('hides out-of-scope and nonexistent jobs using the same no-data response', async () => {
    mocks.query.mockResolvedValue([[]]);
    const first = makeRes(), second = makeRes();
    await getManagedJob(request(), first);
    await getManagedJob(request({}, '99999'), second);
    expect(first.statusCode).toBe(404);
    expect(first.body).toEqual(second.body);
    expect(first.body.data).toBeUndefined();
});
it.each([
    [{ 'x-user-role': 'CANDIDATE' }, '12', 403], [{ 'x-user-role': '' }, '12', 403],
    [{ 'x-user-id': 'NaN' }, '12', 403], [{ 'x-user-id': '0' }, '12', 403],
    [{ 'x-company-id': '' }, '12', 403], [{ 'x-company-id': '3.5' }, '12', 403],
    [{}, 'no', 400], [{}, '0', 400], [{}, '9007199254740992', 400]
])('rejects invalid direct-call identity/id before DB: %j %s', async (headers, id, status) => {
    const res = makeRes();
    await getManagedJob(request(headers, id), res);
    expect(res.statusCode).toBe(status);
    expect(mocks.query).not.toHaveBeenCalled();
});
it('returns a safe uncached error on database outage', async () => {
    mocks.query.mockRejectedValueOnce(new Error('private SQL details'));
    const res = makeRes(); await getManagedJob(request(), res);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('private SQL');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
});
