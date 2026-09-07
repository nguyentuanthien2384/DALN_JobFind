import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import { contractRoute } from '../shared/requestContract.js';
import { editedDetail, assertJobRevision } from '../job-core-service/src/libs/jobEdit.js';
import { jobRevision } from '../shared/jobRevision.js';
import { getManagedJob, updateJob } from '../../frontend/src/service/jobPostingService.js';
import { normalizeApiError } from '../../frontend/src/service/apiError.js';
import { readCoreJobSnapshot, prepareCoreEditPending, acceptCoreEditResponse, readCoreEditPending,
    clearCoreEditPending } from '../../frontend/src/service/jobEditSession.js';

const http = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../frontend/src/axios.js', () => ({ default: http }));
const memory = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
let server, origin, current, writes;
const wire = () => { const { detailPostId, ...data } = current; return { ...data, editRevision: jobRevision(current) }; };
beforeAll(async () => {
    // Actual frontend + HTTP schema + Core edit/revision helpers, but in-memory
    // records and synthetic identity. DB locks/outbox/AI use the MySQL suite.
    const app = express(); app.use(express.json());
    contractRoute(app, 'jobManageGet', (req, res) => res.json({ errCode: 0, data: wire() }));
    contractRoute(app, 'jobUpdate', (req, res) => {
        try {
            assertJobRevision(current, current, req.body);
            const result = editedDetail(current, req.body);
            if (result.changed) {
                current = { ...current, ...result.detail, detailPostId: current.detailPostId + 1,
                    statusCode: result.needsModeration ? 'PS3' : current.statusCode }; writes += 1;
            }
            return res.json({ errCode: 0, data: wire() });
        } catch (error) { return res.status(error.statusCode || 500).json({ errCode: 4, conflict: error.conflict, errMessage: error.message }); }
    });
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    origin = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
beforeEach(() => {
    vi.stubGlobal('sessionStorage', memory()); vi.stubGlobal('localStorage', memory());
    localStorage.setItem('userData', JSON.stringify(user)); writes = 0;
    current = { id: 55, userId: 7, companyId: 9, statusCode: 'PS1', isHot: 1, timeEnd: '1700000000000', detailPostId: 1,
        name: 'Engineer', descriptionHTML: '<p>Work</p>', descriptionMarkdown: 'Work', amount: 2,
        categoryJobCode: 'IT', addressCode: 'OLD', salaryJobCode: null, genderPostCode: null,
        categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null };
    const request = async (method, path, body) => {
        expect(path).toMatch(/^\/api\/jobs\/55(?:\/manage)?$/);
        const response = await fetch(origin + path.slice(4), { method, signal: AbortSignal.timeout(5000),
            headers: { 'content-type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) });
        const data = await response.json(); return response.ok ? data : normalizeApiError({ response: { status: response.status, data } });
    };
    http.get.mockReset().mockImplementation(path => request('GET', path));
    http.put.mockReset().mockImplementation((path, body) => request('PUT', path, body));
});
afterEach(() => vi.unstubAllGlobals());
it.each([
    ['name', 'Kỹ sư'], ['descriptionHTML', '<p>New</p>'], ['descriptionMarkdown', 'New'], ['amount', '3'],
    ['categoryJobCode', 'NEW'], ['addressCode', ''], ['salaryJobCode', 'SAL'], ['genderCode', 'G1'],
    ['categoryJoblevelCode', 'JL'], ['categoryWorktypeCode', 'WT'], ['experienceJobCode', 'EXP']
])('the UI only sends changed %s and accepts actual Core normalization/new-revision/PS3', async (field, value) => {
    const base = readCoreJobSnapshot(await getManagedJob(55), 55, user);
    const sent = prepareCoreEditPending(user, base, { ...base.form, [field]: value });
    const next = acceptCoreEditResponse(await updateJob(55, sent.patch), sent, user);
    expect(Object.keys(sent.patch)).toHaveLength(2); expect(next.form[field]).toBe(value);
    expect(next.form.statusCode).toBe('PS3'); expect(next.form.editRevision).not.toBe(base.form.editRevision);
    expect(current.timeEnd).toBe('1700000000000'); expect(current.isHot).toBe(1); expect(current.userId).toBe(7);
    expect(writes).toBe(1); clearCoreEditPending(user, 55, sent); expect(readCoreEditPending(user, 55)).toBeNull();
});
it('a stale revision from the actual editor fails the actual Core precondition without replacing local evidence or writing twice', async () => {
    const base = readCoreJobSnapshot(await getManagedJob(55), 55, user);
    const sent = prepareCoreEditPending(user, base, { ...base.form, name: 'My change' });
    // Concurrent manual decision changes the fingerprint before this PUT.
    current.statusCode = 'PS2';
    const response = await updateJob(55, sent.patch);
    expect(response).toMatchObject({ httpStatus: 409, errorType: 'conflict' });
    expect(() => acceptCoreEditResponse(response, sent, user)).toThrow();
    expect(readCoreEditPending(user, 55)).toEqual(sent); expect(current.name).toBe('Engineer'); expect(writes).toBe(0);
});
it('unchanged historical nullable fields are not normalized into an edit/request', async () => {
    current.amount = null; current.descriptionMarkdown = null;
    const base = readCoreJobSnapshot(await getManagedJob(55), 55, user);
    expect(prepareCoreEditPending(user, base, base.form)).toBeNull();
    expect(http.put).not.toHaveBeenCalled(); expect(writes).toBe(0);
});
