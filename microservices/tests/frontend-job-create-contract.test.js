import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { contractRoute } from '../shared/requestContract.js';
import { normalizeJobCreate } from '../job-core-service/src/libs/jobRequest.js';
import { buildJobCreate } from '../../frontend/src/service/jobFormAdapter.js';
import { normalizeApiError } from '../../frontend/src/service/apiError.js';
import { prepareJobCreateAttempt, readJobCreateAttempt, sendJobCreateAttempt, jobCreateOutcome,
    settleJobCreateAttempt } from '../../frontend/src/service/jobCreateAttempt.js';
import { prepareLegacyCreateAttempt } from '../../frontend/src/service/legacyCreateAttempt.js';

const clients = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn() }));
vi.mock('../../frontend/src/axios.js', () => ({ default: { post: clients.post } }));
vi.mock('../../frontend/src/service/userService.js', () => ({ createPostService: clients.legacy }));
// Importing normalization must never open the project's DB during this HTTP test.
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: {} }));
const memory = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const user = { id: 7, companyId: 3 };
const form = { name: 'Kỹ sư hệ thống', descriptionHTML: '<p>Xây dựng API</p>', descriptionMarkdown: 'Xây dựng API',
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: '', categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderCode: 'G1', amount: '2', isHot: 0 };
let server, origin, failure, accepted;
beforeAll(async () => {
    const app = express(); app.use(express.json());
    contractRoute(app, 'jobCreate', (req, res) => {
        if (failure) return res.status(failure).json({ errCode: failure });
        accepted += 1;
        // Real transport schema and normalization; synthetic server receipt,
        // not a DB/AI/Auth end-to-end test. Quota is covered by disposable MySQL.
        const job = normalizeJobCreate(req.body);
        return res.status(201).json({ errCode: 0, data: { ...job, id: 21, userId: 7, companyId: 3, statusCode: 'PS3' } });
    });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
    vi.stubGlobal('sessionStorage', memory()); vi.stubGlobal('localStorage', memory());
    localStorage.setItem('userData', JSON.stringify(user)); failure = 0; accepted = 0; clients.legacy.mockReset();
    clients.post.mockReset().mockImplementation(async (path, body, options) => {
        expect(path).toBe('/api/jobs');
        const response = await fetch(origin + path.slice(4), { method: 'POST', signal: AbortSignal.timeout(5000),
            headers: { 'content-type': 'application/json', ...options.headers }, body: JSON.stringify(body) });
        const data = await response.json();
        return response.ok ? data : normalizeApiError({ response: { status: response.status, data } });
    });
});
afterEach(() => vi.unstubAllGlobals());
it.each([0, 1])('actual UI adapter/storage/helper passes Core transport and accepts normalized receipt (hot=%s)', async isHot => {
    const body = buildJobCreate({ ...form, isHot }, new Date(Date.now() + 86400000));
    const sent = prepareJobCreateAttempt(user, body, null, 'core');
    const result = await sendJobCreateAttempt(user, sent);
    expect(accepted).toBe(1); expect(result.data).toMatchObject({ isHot, salaryJobCode: null, genderPostCode: 'G1' });
    expect(jobCreateOutcome(result, sent, user)).toEqual({ status: 'succeeded', postId: 21 });
    expect(clients.legacy).not.toHaveBeenCalled();
});
it.each([400, 409, 429])('actual normalized HTTP %s allows correction without changing writer/key', async httpStatus => {
    const body = buildJobCreate(form, new Date(Date.now() + 86400000));
    const sent = prepareJobCreateAttempt(user, body, null, 'core'); failure = httpStatus;
    const result = await sendJobCreateAttempt(user, sent);
    const rejected = settleJobCreateAttempt(user, sent, jobCreateOutcome(result, sent, user));
    expect(rejected.status).toBe('rejected');
    const retry = prepareJobCreateAttempt(user, { ...body, name: 'Corrected' }, rejected, 'legacy');
    expect(retry.key).toBe(sent.key); expect(retry.writer).toBe('core'); failure = 0;
    expect(jobCreateOutcome(await sendJobCreateAttempt(user, retry), retry, user).status).toBe('succeeded');
    expect(clients.legacy).not.toHaveBeenCalled();
});
it('legacy stored payload including userId is never sent through the stricter Core contract', async () => {
    const old = prepareLegacyCreateAttempt(user, { userId: 7, name: 'Old draft', timeEnd: Date.now() + 86400000 }, null);
    const restored = readJobCreateAttempt(user); await sendJobCreateAttempt(user, restored);
    expect(clients.legacy).toHaveBeenCalledWith(old.payload, { idempotencyKey: old.key });
    expect(clients.post).not.toHaveBeenCalled(); expect(accepted).toBe(0);
});
