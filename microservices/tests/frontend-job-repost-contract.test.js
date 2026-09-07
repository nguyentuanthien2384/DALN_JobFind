import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { contractRoute } from '../shared/requestContract.js';
import { assertJobRevision } from '../job-core-service/src/libs/jobEdit.js';
import { jobRevision } from '../shared/jobRevision.js';
import { getManagedJob } from '../../frontend/src/service/jobPostingService.js';
import { normalizeApiError } from '../../frontend/src/service/apiError.js';
import { coreRepostSource, prepareJobRepostAttempt, sendJobRepostAttempt, readJobRepostAttempt,
    settleJobRepostAttempt, jobRepostOutcome } from '../../frontend/src/service/jobRepostAttempt.js';
import { prepareLegacyRepostAttempt } from '../../frontend/src/service/legacyRepostAttempt.js';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), legacy: vi.fn() }));
vi.mock('../../frontend/src/axios.js', () => ({ default: http }));
vi.mock('../../frontend/src/service/userService.js', () => ({ reupPostService: http.legacy }));
const memory = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
let server, origin, current, failure, accepted;
const wire = () => { const { detailPostId, ...data } = current; return { ...data, editRevision: jobRevision(current) }; };
beforeAll(async () => {
    // Real frontend, HTTP validators and Core revision helper. Source/receipt and
    // identity are synthetic; this is NOT a DB-ledger, Gateway-auth or AI E2E test.
    // The disposable MySQL writer suite separately exercises real transactions.
    const app = express(); app.use(express.json());
    contractRoute(app, 'jobManageGet', (req, res) => res.json({ errCode: 0, data: wire() }));
    contractRoute(app, 'jobRepost', (req, res) => {
        if (failure) return res.status(failure).json({ errCode: 2 });
        try {
            expect(Object.keys(req.body).sort()).toEqual(['expectedRevision', 'timeEnd']);
            expect(req.headers['idempotency-key']).toMatch(/^[a-f0-9]{32}$/);
            assertJobRevision(current, current, req.body); accepted += 1;
            const { editRevision, ...data } = wire();
            return res.status(201).json({ errCode: 0, data: { ...data, id: 101, userId: user.id,
                statusCode: 'PS3', timeEnd: String(req.body.timeEnd) } });
        } catch (error) { return res.status(error.statusCode || 500).json({ errCode: 2, errMessage: error.message, conflict: error.conflict }); }
    });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
    vi.stubGlobal('sessionStorage', memory()); vi.stubGlobal('localStorage', memory());
    localStorage.setItem('userData', JSON.stringify(user)); failure = 0; accepted = 0;
    current = { id: 55, detailPostId: 1, userId: 7, companyId: 9, statusCode: 'PS1', isHot: 1, timeEnd: '1700000000000',
        name: 'Engineer', descriptionHTML: '<p>Work</p>', descriptionMarkdown: null, amount: null,
        categoryJobCode: 'IT', addressCode: 'OLD', salaryJobCode: null, genderPostCode: null,
        categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null };
    const request = async (method, path, body, options = {}) => {
        expect(path).toMatch(/^\/api\/jobs\/55\/(manage|repost)$/);
        const response = await fetch(origin + path.slice(4), { method, signal: AbortSignal.timeout(5000),
            headers: { 'content-type': 'application/json', ...options.headers }, ...(body && { body: JSON.stringify(body) }) });
        const data = await response.json(); return response.ok ? data : normalizeApiError({ response: { status: response.status, data } });
    };
    http.get.mockReset().mockImplementation(path => request('GET', path));
    http.post.mockReset().mockImplementation((path, body, options) => request('POST', path, body, options)); http.legacy.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
const prepare = async previous => {
    const source = await getManagedJob(55), expectedRevision = source.data.editRevision;
    return prepareJobRepostAttempt(user, 55, { timeEnd: Date.now() + 86400000, expectedRevision, userId: 999, companyId: 999 },
        previous, 'core', coreRepostSource(source, 55, user, expectedRevision));
};
it.each([['PS1', 0], ['PS2', 1], ['PS3', 0]])('private %s source/hot=%s produces a typed repost with valid full original receipt', async (statusCode, isHot) => {
    current.statusCode = statusCode; current.isHot = isHot;
    const sent = await prepare(), result = await sendJobRepostAttempt(user, 55, sent);
    expect(accepted).toBe(1); expect(result.data).toMatchObject({ userId: 8, amount: null, descriptionMarkdown: null, addressCode: 'OLD', isHot });
    expect(jobRepostOutcome(result, 55, sent, user)).toEqual({ status: 'succeeded', postId: 101 });
    expect(http.legacy).not.toHaveBeenCalled(); expect(sent.payload).not.toHaveProperty('userId');
});
it('the actual Core fingerprint detects a race after preflight; explicit correction preserves key', async () => {
    const sent = await prepare(); current.statusCode = 'PS2';
    const response = await sendJobRepostAttempt(user, 55, sent);
    expect(response).toMatchObject({ httpStatus: 409, errorType: 'conflict' }); expect(accepted).toBe(0);
    const rejected = settleJobRepostAttempt(user, 55, sent, jobRepostOutcome(response, 55, sent, user));
    const corrected = await prepare(rejected); expect(corrected.key).toBe(sent.key);
    expect(corrected.payload.expectedRevision).not.toBe(sent.payload.expectedRevision);
    expect(jobRepostOutcome(await sendJobRepostAttempt(user, 55, corrected), 55, corrected, user).status).toBe('succeeded');
});
it.each([[400, 'rejected'], [403, 'rejected'], [429, 'rejected'], [401, 'pending'], [404, 'pending'], [503, 'pending']])
('actual normalized HTTP %s retains the %s intent without fallback', async (httpStatus, status) => {
    const sent = await prepare(); failure = httpStatus; const result = await sendJobRepostAttempt(user, 55, sent);
    const saved = settleJobRepostAttempt(user, 55, sent, jobRepostOutcome(result, 55, sent, user));
    expect(saved).toEqual({ ...sent, status }); expect(accepted).toBe(0); expect(http.legacy).not.toHaveBeenCalled();
});
it('legacy records keep the legacy payload/header and never enter the Core contract', async () => {
    const old = prepareLegacyRepostAttempt(user, 55, { userId: 8, postId: 55, timeEnd: Date.now() + 86400000, expectedRevision: jobRevision(current) }, null);
    const saved = readJobRepostAttempt(user, 55); await sendJobRepostAttempt(user, 55, saved);
    expect(http.legacy).toHaveBeenCalledWith(old.payload, { idempotencyKey: old.key }); expect(http.post).not.toHaveBeenCalled();
});
