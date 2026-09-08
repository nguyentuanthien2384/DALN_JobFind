import { beforeEach, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { expectResponseContract } from './contractAssertions.js';
import { listManagedJobs, getManagedJobReview, reviewState } from '../job-core-service/src/controllers/jobWorkspaceController.js';
import { moderationContentHash } from '../job-core-service/src/libs/moderationState.js';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: { query: mocks.query } }));
const request = (query = {}, headers = {}, id = '55') => makeReq({ query, params: { id }, headers: {
    'x-user-id': '7', 'x-company-id': '3', 'x-user-role': 'COMPANY', ...headers
} });
const row = () => ({ total: 6, id: 55, name: 'Job', statusCode: 'PS3', timeEnd: '1700000000000', isHot: 0,
    updatedAt: new Date('2026-09-08T00:00:00Z'), userId: 8, companyId: 3, authorFirstName: 'Lan', authorLastName: null });
const review = () => ({ total: 1, jobId: 55, name: 'Job', descriptionHTML: '<p>Work</p>', companyId: 3, statusCode: 'PS3',
    aiState: 'pending', aiContentHash: moderationContentHash({ name: 'Job', descriptionHTML: '<p>Work</p>' }),
    noteId: 9, note: 'Historical manual note', createdAt: new Date('2026-09-08T00:00:00Z'), authorId: 88, authorFirstName: null, authorLastName: null });
beforeEach(() => { mocks.query.mockReset(); });
it('list gates authorization, count, minimal rows and deterministic page in one SELECT; escapes wildcard text as a bound parameter', async () => {
    mocks.query.mockResolvedValueOnce([[{ ...row(), password: 'secret', descriptionHTML: 'not selected' }]]);
    const res = makeRes(); await listManagedJobs(request({ search: '10%_! x', statusCode: 'PS3', limit: '5', offset: '5' }), res);
    expectResponseContract('jobManageList', res); expect(res.body.count).toBe(6); expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/password|secret|descriptionHTML|editRevision/);
    expect(mocks.query).toHaveBeenCalledOnce(); const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual([7, 3, 3, 'PS3', '%10!%!_!! x%', '%10!%!_!! x%', 3, 'PS3', '%10!%!_!! x%', '%10!%!_!! x%', 5, 5]);
    for (const clause of ['actor.companyId = ?', "company.statusCode = 'S1'", "company.censorCode = 'CS1'", 'COUNT(*)', 'ORDER BY p.updatedAt DESC, p.id DESC', 'LEFT JOIN']) expect(sql).toContain(clause);
    expect(sql).not.toContain('10%'); expect(res.headers['Cache-Control']).toBe('private, no-store');
});
it.each([0, 6])('authorized empty/out-of-range page keeps scoped count %s', async count => {
    mocks.query.mockResolvedValueOnce([[{ total: count, id: null }]]); const res = makeRes();
    await listManagedJobs(request(), res); expect(res.body).toEqual({ errCode: 0, count, data: [] }); expectResponseContract('jobManageList', res);
});
it('review returns current AI summary and historical notes without leaking prompt, hash, event or source HTML', async () => {
    mocks.query.mockResolvedValueOnce([[{ ...review(), requestId: 'secret-request', result: 'secret-result' }]]);
    const res = makeRes(); await getManagedJobReview(request(), res); expectResponseContract('jobReviewGet', res);
    expect(res.body.data.job.reviewState).toBe('ai_requested'); expect(res.body.data.notes[0].authorId).toBe(88);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|descriptionHTML|contentHash|requestId|aiState/);
    expect(mocks.query).toHaveBeenCalledOnce(); expect(mocks.query.mock.calls[0][1]).toEqual([7, 55, 55, 5, 0, 55, 3]);
    expect(mocks.query.mock.calls[0][0]).toContain('actor.companyId = owner.companyId');
    expect(mocks.query.mock.calls[0][0]).toContain('ORDER BY n.createdAt DESC, n.id DESC');
    expect(res.headers['Cache-Control']).toBe('private, no-store');
});
it.each([0, 7])('review with no notes on page retains job summary and count %s', async count => {
    mocks.query.mockResolvedValueOnce([[{ ...review(), total: count, noteId: null }]]); const res = makeRes();
    await getManagedJobReview(request(), res); expect(res.body.data.notes).toEqual([]); expect(res.body.data.count).toBe(count);
    expect(res.body.data.job.id).toBe(55); expectResponseContract('jobReviewGet', res);
});
it.each([
    ['pending', 'PS3', 'ai_requested'], ['failed', 'PS3', 'ai_failed'], ['applied', 'PS1', 'ai_applied'], ['applied', 'PS2', 'ai_applied'],
    ['cancelled', 'PS1', 'no_active_ai'], ['cancelled', 'PS3', 'no_active_ai'], ['cancelled', 'PS4', 'no_active_ai'],
    ['pending', 'PS1', 'untracked'], ['pending', 'PS4', 'untracked'], ['failed', 'PS2', 'untracked'], ['applied', 'PS3', 'untracked'],
    ['applied', 'PS4', 'untracked'], ['superseded', 'PS3', 'untracked'], [null, 'PS3', 'untracked'], ['new-state', 'PS3', 'untracked']
])('%s on %s summarizes as %s without inferring work/provenance from status', (aiState, statusCode, expected) => {
    expect(reviewState({ ...review(), aiState, statusCode })).toBe(expected);
});
it.each(['pending', 'applied', 'failed'])('changed/missing content never claims current %s AI', aiState => {
    expect(reviewState({ ...review(), aiState, name: 'Changed' })).toBe('untracked');
    expect(reviewState({ ...review(), aiState, descriptionHTML: null })).toBe('untracked');
});
it.each([['list', listManagedJobs], ['review', getManagedJobReview]])('%s rejects invalid role/current identity before any query', async (_name, controller) => {
    for (const headers of [{ 'x-user-role': 'CANDIDATE' }, { 'x-user-role': 'ADMIN' }, { 'x-user-role': '' }, { 'x-company-id': '0' },
        { 'x-company-id': '3.0' }, { 'x-user-id': '1e2' }, { 'x-user-id': '9007199254740992' }]) {
        const res = makeRes(); await controller(request({}, headers), res); expect(res.statusCode).toBe(403);
        expect(res.headers['Cache-Control']).toBe('private, no-store');
    }
    expect(mocks.query).not.toHaveBeenCalled();
});
it.each([['list', listManagedJobs], ['review', getManagedJobReview]])('%s rejects invalid query without DB work', async (_name, controller) => {
    for (const query of [{ limit: '0' }, { limit: '51' }, { limit: 5 }, { limit: ['5'] }, { limit: '01' }, { offset: '-1' },
        { offset: '1000001' }, { companyId: 3 }]) {
        const res = makeRes(); await controller(request(query), res); expect(res.statusCode).toBe(400);
    }
    expect(mocks.query).not.toHaveBeenCalled();
});
it('missing/out-of-scope review is identical, list cannot expose even counts to a stale tenant', async () => {
    mocks.query.mockResolvedValue([[]]); const a = makeRes(), b = makeRes(), list = makeRes();
    await getManagedJobReview(request(), a); await getManagedJobReview(request({}, {}, '999'), b); await listManagedJobs(request(), list);
    expect(a.statusCode).toBe(404); expect(a.body).toEqual(b.body); expect(list.statusCode).toBe(403);
    expect(list.body).not.toHaveProperty('count');
});
it.each([['list', listManagedJobs], ['review', getManagedJobReview]])('%s fails closed on missing tables/outage and does not leak SQL or fallback', async (_name, controller) => {
    mocks.query.mockRejectedValue(new Error('Secret schema failure')); const res = makeRes(); await controller(request(), res);
    expect(res.statusCode).toBe(500); expect(JSON.stringify(res.body)).not.toContain('Secret'); expect(mocks.query).toHaveBeenCalledOnce();
});
