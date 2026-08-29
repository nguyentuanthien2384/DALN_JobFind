import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => ({
    pool: { query: vi.fn(), getConnection: vi.fn() },
    withTransaction: vi.fn(),
    publish: vi.fn()
}));

vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: mocks.pool, withTransaction: mocks.withTransaction }));
vi.mock('../shared/rabbitmq.js', () => ({ publish: mocks.publish }));

beforeEach(() => {
    mocks.pool.query.mockReset();
    mocks.withTransaction.mockReset();
    mocks.publish.mockReset().mockResolvedValue(undefined);
});

describe('job write controller', () => {
    it('validates required job fields before touching the database', async () => {
        const { createJob } = await import('../job-core-service/src/controllers/jobController.js');
        const res = makeRes();
        await createJob(makeReq({ body: { name: 'Missing description' } }), res);
        expect(res.statusCode).toBe(400);
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('creates both records atomically and publishes search/moderation payloads', async () => {
        const conn = { query: vi.fn().mockResolvedValueOnce([{ insertId: 10 }]).mockResolvedValueOnce([{ insertId: 20 }]) };
        mocks.withTransaction.mockImplementation((work) => work(conn));
        const job = { id: 20, name: 'Node Dev', descriptionHTML: '<p>Build</p>', companyId: 3 };
        mocks.pool.query.mockResolvedValue([[job]]);
        const { createJob } = await import('../job-core-service/src/controllers/jobController.js');
        const res = makeRes();
        await createJob(makeReq({
            headers: { 'x-user-id': '7', 'x-company-id': '3' },
            body: { name: 'Node Dev', descriptionHTML: '<p>Build</p>', categoryJobCode: 'IT', amount: 0, isHot: true }
        }), res);
        expect(conn.query).toHaveBeenCalledTimes(2);
        expect(conn.query.mock.calls[0][1][6]).toBe(1);
        expect(conn.query.mock.calls[1][1][0]).toBe('PS3');
        expect(mocks.publish).toHaveBeenNthCalledWith(1, 'job.created', { job });
        expect(mocks.publish).toHaveBeenNthCalledWith(2, 'ai.moderate_job', { jobId: 20, name: 'Node Dev', descriptionHTML: '<p>Build</p>' });
        expect(res.statusCode).toBe(201);
    });

    it('returns 500 when job creation or event publishing fails', async () => {
        mocks.withTransaction.mockRejectedValue(new Error('db'));
        const { createJob } = await import('../job-core-service/src/controllers/jobController.js');
        const res = makeRes();
        await createJob(makeReq({ body: { name: 'A', descriptionHTML: 'B', categoryJobCode: 'C' } }), res);
        expect(res.statusCode).toBe(500);
    });

    it('returns 404/403 before updating a missing or foreign-company job', async () => {
        const { updateJob } = await import('../job-core-service/src/controllers/jobController.js');
        mocks.pool.query.mockResolvedValueOnce([[]]);
        const missing = makeRes();
        await updateJob(makeReq({ params: { id: '4' } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockResolvedValueOnce([[{ id: 4, companyId: 2 }]]);
        const denied = makeRes();
        await updateJob(makeReq({ headers: { 'x-company-id': '3', 'x-user-role': 'COMPANY' }, params: { id: '4' } }), denied);
        expect(denied.statusCode).toBe(403);
    });

    it('updates owned jobs and re-moderates only when content changed', async () => {
        const old = { id: 4, companyId: 2, name: 'Old', descriptionHTML: 'Old desc' };
        const changed = { ...old, name: 'New', descriptionHTML: 'New desc' };
        mocks.pool.query.mockResolvedValueOnce([[old]]).mockResolvedValueOnce([[changed]]);
        const conn = { query: vi.fn().mockResolvedValue(undefined) };
        mocks.withTransaction.mockImplementation((work) => work(conn));
        const { updateJob } = await import('../job-core-service/src/controllers/jobController.js');
        const res = makeRes();
        await updateJob(makeReq({
            headers: { 'x-user-id': '1', 'x-company-id': '2', 'x-user-role': 'COMPANY' },
            params: { id: '4' }, body: { name: 'New', amount: 0 }
        }), res);
        expect(conn.query).toHaveBeenCalledTimes(2);
        expect(mocks.publish).toHaveBeenNthCalledWith(1, 'job.updated', { job: changed });
        expect(mocks.publish).toHaveBeenNthCalledWith(2, 'ai.moderate_job', expect.objectContaining({ jobId: 4, name: 'New' }));
        expect(res.body.data).toEqual(changed);

        mocks.publish.mockClear();
        mocks.pool.query.mockResolvedValueOnce([[old]]).mockResolvedValueOnce([[old]]);
        await updateJob(makeReq({ headers: { 'x-user-role': 'ADMIN' }, params: { id: '4' }, body: { amount: 3 } }), makeRes());
        expect(mocks.publish).toHaveBeenCalledOnce();
    });

    it('maps update exceptions to 500', async () => {
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const { updateJob } = await import('../job-core-service/src/controllers/jobController.js');
        const res = makeRes();
        await updateJob(makeReq({ params: { id: '4' } }), res);
        expect(res.statusCode).toBe(500);
    });

    it('soft-deletes owned/admin jobs and emits deletion events', async () => {
        const { deleteJob } = await import('../job-core-service/src/controllers/jobController.js');
        mocks.pool.query.mockResolvedValueOnce([[]]);
        const missing = makeRes();
        await deleteJob(makeReq({ params: { id: '1' } }), missing);
        expect(missing.statusCode).toBe(404);

        mocks.pool.query.mockResolvedValueOnce([[{ id: 1, companyId: 4 }]]);
        const denied = makeRes();
        await deleteJob(makeReq({ headers: { 'x-company-id': '9' }, params: { id: '1' } }), denied);
        expect(denied.statusCode).toBe(403);

        mocks.pool.query.mockResolvedValueOnce([[{ id: 1, companyId: 4 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
        const ok = makeRes();
        await deleteJob(makeReq({ headers: { 'x-company-id': '4' }, params: { id: '1' } }), ok);
        expect(mocks.pool.query.mock.calls.at(-1)[1][0]).toBe('PS4');
        expect(mocks.publish).toHaveBeenCalledWith('job.deleted', { jobId: 1 });
        expect(ok.body.errCode).toBe(0);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await deleteJob(makeReq({ params: { id: '1' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('returns job details/list data and stable not-found/error responses', async () => {
        const { getJob, listJobsForReindex, loadJobForEvent } = await import('../job-core-service/src/controllers/jobController.js');
        mocks.pool.query.mockResolvedValueOnce([[{ id: 2 }]]);
        await expect(loadJobForEvent(2)).resolves.toEqual({ id: 2 });
        mocks.pool.query.mockResolvedValueOnce([[{ id: 3 }]]);
        const found = makeRes();
        await getJob(makeReq({ params: { id: '3' } }), found);
        expect(found.body.data.id).toBe(3);
        mocks.pool.query.mockResolvedValueOnce([[]]);
        const missing = makeRes();
        await getJob(makeReq({ params: { id: '3' } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockRejectedValueOnce(new Error('db'));
        const getFailed = makeRes();
        await getJob(makeReq({ params: { id: '3' } }), getFailed);
        expect(getFailed.statusCode).toBe(500);
        mocks.pool.query.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]]);
        const list = makeRes();
        await listJobsForReindex(makeReq(), list);
        expect(list.body.count).toBe(2);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await listJobsForReindex(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });
});

describe('AI task controller', () => {
    it('creates the AI task table', async () => {
        mocks.pool.query.mockResolvedValue(undefined);
        const { ensureAiTaskTable } = await import('../job-core-service/src/controllers/aiController.js');
        await ensureAiTaskTable();
        expect(mocks.pool.query.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS ai_tasks');
    });

    it('validates resume parsing and queues a bounded task', async () => {
        const { parseResume } = await import('../job-core-service/src/controllers/aiController.js');
        const invalid = makeRes();
        await parseResume(makeReq(), invalid);
        expect(invalid.statusCode).toBe(400);
        mocks.pool.query.mockResolvedValue(undefined);
        const ok = makeRes();
        await parseResume(makeReq({ headers: { 'x-user-id': '5' }, body: { fileBase64: 'PDF', fileName: 'cv.pdf' } }), ok);
        expect(mocks.pool.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['parse_resume', 'pending', 5]));
        expect(mocks.publish).toHaveBeenCalledWith('ai.parse_resume', expect.objectContaining({ taskId: expect.any(String), fileBase64: 'PDF', fileName: 'cv.pdf' }));
        expect(ok.statusCode).toBe(202);
    });

    it('validates match requests, rejects missing jobs, and queues enriched payloads', async () => {
        const { matchCv } = await import('../job-core-service/src/controllers/aiController.js');
        const invalid = makeRes();
        await matchCv(makeReq({ body: { resumeText: 'CV' } }), invalid);
        expect(invalid.statusCode).toBe(400);
        mocks.pool.query.mockResolvedValueOnce([[]]);
        const missing = makeRes();
        await matchCv(makeReq({ body: { resumeText: 'CV', jobId: 1 } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockResolvedValueOnce([[{ name: 'Dev', descriptionHTML: 'Build' }]]).mockResolvedValueOnce(undefined);
        const ok = makeRes();
        await matchCv(makeReq({ headers: { 'x-user-id': '2' }, body: { resumeText: 'CV', jobId: 1 } }), ok);
        expect(mocks.publish).toHaveBeenCalledWith('ai.match_cv', expect.objectContaining({ resumeText: 'CV', jobTitle: 'Dev', jobDescription: 'Build' }));
        expect(ok.statusCode).toBe(202);
    });

    it('validates cover-letter requests and defaults language/company', async () => {
        const { coverLetter } = await import('../job-core-service/src/controllers/aiController.js');
        const invalid = makeRes();
        await coverLetter(makeReq(), invalid);
        expect(invalid.statusCode).toBe(400);
        mocks.pool.query.mockResolvedValueOnce([[]]);
        const missing = makeRes();
        await coverLetter(makeReq({ body: { resumeText: 'CV', jobId: 1 } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockResolvedValueOnce([[{ name: 'Dev', descriptionHTML: 'Build', companyName: null }]]).mockResolvedValueOnce(undefined);
        const ok = makeRes();
        await coverLetter(makeReq({ body: { resumeText: 'CV', jobId: 1 } }), ok);
        expect(mocks.publish).toHaveBeenCalledWith('ai.cover_letter', expect.objectContaining({ companyName: 'the company', language: 'en' }));
    });

    it('protects task results and parses stored JSON', async () => {
        const { getTask } = await import('../job-core-service/src/controllers/aiController.js');
        mocks.pool.query.mockResolvedValueOnce([[]]);
        const missing = makeRes();
        await getTask(makeReq({ params: { taskId: 'x' } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockResolvedValueOnce([[{ id: 'x', userId: 8 }]]);
        const denied = makeRes();
        await getTask(makeReq({ headers: { 'x-user-id': '7' }, params: { taskId: 'x' } }), denied);
        expect(denied.statusCode).toBe(403);
        const task = { id: 'x', userId: 8, type: 'match_cv', status: 'done', result: '{"score":90}', error: null, createdAt: 1, updatedAt: 2 };
        mocks.pool.query.mockResolvedValueOnce([[task]]);
        const ok = makeRes();
        await getTask(makeReq({ headers: { 'x-user-role': 'ADMIN' }, params: { taskId: 'x' } }), ok);
        expect(ok.body.data.result).toEqual({ score: 90 });
    });

    it('persists generic AI success/failure results', async () => {
        const { handleAiResult } = await import('../job-core-service/src/controllers/aiController.js');
        mocks.pool.query.mockResolvedValue(undefined);
        await handleAiResult({ taskId: 't', type: 'parse_resume', ok: true, result: { a: 1 } });
        expect(mocks.pool.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['done', '{"a":1}', 't']));
        mocks.pool.query.mockClear();
        await handleAiResult({ taskId: 't', type: 'match_cv', ok: false, error: 'bad' });
        expect(mocks.pool.query.mock.calls[0][1]).toEqual(expect.arrayContaining(['failed', null, 'bad', 't']));
    });

    it('keeps moderation pending on infrastructure failure', async () => {
        const { handleAiResult } = await import('../job-core-service/src/controllers/aiController.js');
        await handleAiResult({ jobId: 2, type: 'moderate_job', ok: false, error: 'quota' });
        expect(mocks.pool.query).not.toHaveBeenCalled();
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it('updates moderation status and publishes a complete notification event', async () => {
        const { handleAiResult } = await import('../job-core-service/src/controllers/aiController.js');
        mocks.pool.query.mockResolvedValueOnce(undefined).mockResolvedValueOnce([[{ posterId: 4, jobTitle: 'Dev' }]]);
        await handleAiResult({ jobId: 2, type: 'moderate_job', ok: true, result: { approved: false, reason: 'spam' } });
        expect(mocks.pool.query.mock.calls[0][1][0]).toBe('PS2');
        expect(mocks.publish).toHaveBeenCalledWith('job.moderated', {
            jobId: 2, posterId: 4, jobTitle: 'Dev', approved: false, statusCode: 'PS2', reason: 'spam'
        });
        mocks.pool.query.mockReset().mockResolvedValueOnce(undefined).mockResolvedValueOnce([[]]);
        await handleAiResult({ jobId: 3, type: 'moderate_job', ok: true, result: { approved: true } });
        expect(mocks.publish).toHaveBeenLastCalledWith('job.moderated', expect.objectContaining({ posterId: null, statusCode: 'PS1', approved: true }));
    });
});
