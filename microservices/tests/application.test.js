import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { expectResponseContract, decodeEventFixture } from './contractAssertions.js';

const mocks = vi.hoisted(() => ({
    pool: { query: vi.fn() },
    withTransaction: vi.fn(),
    publish: vi.fn(),
    enqueueOutboxEvent: vi.fn(),
    consume: vi.fn(),
    legacy: { query: vi.fn() },
    createPool: vi.fn()
}));

vi.mock('../application-service/src/libs/db.js', () => ({
    pool: mocks.pool,
    withTransaction: mocks.withTransaction,
    STAGES: ['moi_ung_tuyen', 'dang_xem_xet', 'phong_van', 'de_nghi', 'nhan_viec', 'tu_choi'],
    STAGE_LABELS: {
        moi_ung_tuyen: 'Mới ứng tuyển', dang_xem_xet: 'Đang xem xét', phong_van: 'Phỏng vấn',
        de_nghi: 'Đề nghị nhận việc', nhan_viec: 'Đã nhận việc', tu_choi: 'Từ chối'
    }
}));
vi.mock('../shared/rabbitmq.js', () => ({ publish: mocks.publish, consume: mocks.consume }));
vi.mock('../application-service/src/libs/outbox.js', () => ({ enqueueOutboxEvent: mocks.enqueueOutboxEvent }));
vi.mock('mysql2/promise', () => ({ default: { createPool: mocks.createPool } }));

beforeEach(() => {
    mocks.pool.query.mockReset();
    mocks.withTransaction.mockReset();
    mocks.publish.mockReset().mockResolvedValue(undefined);
    mocks.enqueueOutboxEvent.mockReset().mockResolvedValue('event-id');
    mocks.consume.mockReset().mockResolvedValue(undefined);
    mocks.legacy.query.mockReset();
    mocks.createPool.mockReturnValue(mocks.legacy);
});

const companyReq = (overrides = {}) => makeReq({
    headers: { 'x-user-id': '5', 'x-user-role': 'COMPANY', 'x-company-id': '9' },
    ...overrides
});

describe('application pipeline controller', () => {
    it('rejects company-scoped views when no company is attached', async () => {
        const { getBoard, listApplications, getFunnel } = await import('../application-service/src/controllers/applicationController.js');
        for (const handler of [getBoard, listApplications, getFunnel]) {
            const res = makeRes();
            await handler(makeReq({ headers: { 'x-user-role': 'COMPANY' } }), res);
            expect(res.statusCode).toBe(403);
        }
    });

    it('returns all Kanban columns, including empty stages, in configured order', async () => {
        const rows = [
            { id: 1, stage: 'moi_ung_tuyen' },
            { id: 2, stage: 'moi_ung_tuyen' },
            { id: 3, stage: 'phong_van' }
        ];
        mocks.pool.query.mockResolvedValue({ rows });
        const { getBoard } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await getBoard(companyReq({ query: { jobId: '12' } }), res);
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([9, 12]);
        expect(res.body.data.total).toBe(3);
        expect(res.body.data.columns).toHaveLength(6);
        expect(res.body.data.columns[0]).toMatchObject({ stage: 'moi_ung_tuyen', count: 2 });
        expect(res.body.data.columns[1]).toMatchObject({ stage: 'dang_xem_xet', count: 0 });
        expectResponseContract('applicationBoard', res);
    });

    it('allows admins an unscoped board and maps DB failures to 500', async () => {
        const { getBoard } = await import('../application-service/src/controllers/applicationController.js');
        mocks.pool.query.mockResolvedValueOnce({ rows: [] });
        await getBoard(makeReq({ headers: { 'x-user-role': 'ADMIN' } }), makeRes());
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([]);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await getBoard(companyReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('builds filtered/paginated application listings and returns total count', async () => {
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({ rows: [{ total: 8 }] });
        const { listApplications } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await listApplications(companyReq({ query: { jobId: '4', stage: 'phong_van', minRating: '3', q: 'Lan', limit: '200', offset: '2' } }), res);
        expect(mocks.pool.query.mock.calls[0][0]).toContain('LIMIT 100 OFFSET 2');
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([9, 4, 'phong_van', 3, '%Lan%']);
        expect(res.body).toEqual({ errCode: 0, data: [{ id: 1 }], count: 8 });
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await listApplications(companyReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('protects application details and marks an employer view as read', async () => {
        const { getApplication } = await import('../application-service/src/controllers/applicationController.js');
        mocks.pool.query.mockResolvedValueOnce({ rows: [] });
        const missing = makeRes();
        await getApplication(companyReq({ params: { id: '1' } }), missing);
        expect(missing.statusCode).toBe(404);

        mocks.pool.query.mockResolvedValueOnce({ rows: [{ id: 1, candidate_id: 2, company_id: 3 }] });
        const denied = makeRes();
        await getApplication(companyReq({ params: { id: '1' } }), denied);
        expect(denied.statusCode).toBe(403);

        const application = { id: 1, candidate_id: 2, company_id: 9, is_read: false };
        mocks.pool.query
            .mockResolvedValueOnce({ rows: [application] })
            .mockResolvedValueOnce({ rows: [{ body: 'note' }] })
            .mockResolvedValueOnce({ rows: [{ to_stage: 'phong_van' }] })
            .mockResolvedValueOnce({ rowCount: 1 });
        const ok = makeRes();
        await getApplication(companyReq({ params: { id: '1' } }), ok);
        expect(ok.body.data).toMatchObject({ id: 1, is_read: true, notes: [{ body: 'note' }], timeline: [{ to_stage: 'phong_van' }] });
        expect(mocks.pool.query.mock.calls.at(-1)[0]).toContain('is_read = TRUE');
    });

    it('lets candidates/admins view authorized details without marking them read', async () => {
        const { getApplication } = await import('../application-service/src/controllers/applicationController.js');
        const app = { id: 1, candidate_id: 5, company_id: 9, is_read: false };
        mocks.pool.query.mockResolvedValueOnce({ rows: [app] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
        const res = makeRes();
        await getApplication(makeReq({ headers: { 'x-user-id': '5', 'x-user-role': 'CANDIDATE' }, params: { id: '1' } }), res);
        expect(res.body.errCode).toBe(0);
        expect(mocks.pool.query).toHaveBeenCalledTimes(3);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await getApplication(companyReq({ params: { id: '1' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('validates stage names and maps transaction outcomes', async () => {
        const { moveStage } = await import('../application-service/src/controllers/applicationController.js');
        const invalid = makeRes();
        await moveStage(companyReq({ body: { stage: 'invalid' } }), invalid);
        expect(invalid.statusCode).toBe(400);
        for (const [result, status] of [[{ notFound: true }, 404], [{ denied: true }, 403]]) {
            mocks.withTransaction.mockResolvedValueOnce(result);
            const res = makeRes();
            await moveStage(companyReq({ params: { id: '1' }, body: { stage: 'phong_van' } }), res);
            expect(res.statusCode).toBe(status);
        }
        const unchanged = { id: 1, stage: 'phong_van' };
        mocks.withTransaction.mockResolvedValueOnce({ unchanged: true, app: unchanged });
        const same = makeRes();
        await moveStage(companyReq({ params: { id: '1' }, body: { stage: 'phong_van' } }), same);
        expect(same.body.data).toBe(unchanged);
        expect(mocks.publish).not.toHaveBeenCalled();
        expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled();
    });

    it('moves a stage and records the snapshot event in the same transaction', async () => {
        const before = { id: 1, stage: 'moi_ung_tuyen', company_id: 9, candidate_id: 2, candidate_email: 'lan@example.com', candidate_name: 'Lan', job_id: 3, job_title: 'Dev' };
        const after = { ...before, stage: 'phong_van' };
        const client = { query: vi.fn().mockResolvedValueOnce({ rows: [before] }).mockResolvedValueOnce({ rows: [after] }).mockResolvedValueOnce({}) };
        mocks.withTransaction.mockImplementation((work) => work(client));
        const { moveStage } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await moveStage(companyReq({ params: { id: '1' }, body: { stage: 'phong_van', reason: 'Strong CV' } }), res);
        expect(client.query.mock.calls[2][1]).toEqual([1, 'moi_ung_tuyen', 'phong_van', 5, 'Strong CV']);
        expect(mocks.enqueueOutboxEvent).toHaveBeenCalledWith(client, expect.objectContaining({
            aggregateId: 1, eventType: 'application.stage_changed', payload: {
            applicationId: 1, candidateId: 2, candidateEmail: 'lan@example.com', candidateName: 'Lan', jobId: 3, jobTitle: 'Dev',
            fromStage: 'moi_ung_tuyen', toStage: 'phong_van', reason: 'Strong CV'
            }
        }));
        expect(mocks.publish).not.toHaveBeenCalled();
        expect(res.body.data.stage).toBe('phong_van');
    });

    it('maps stage transaction failures to 500', async () => {
        mocks.withTransaction.mockRejectedValue(new Error('db'));
        const { moveStage } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await moveStage(companyReq({ body: { stage: 'phong_van' } }), res);
        expect(res.statusCode).toBe(500);
    });

    it('validates decisions and maps not-found/denied transaction outcomes', async () => {
        const { sendDecisionNotification } = await import('../application-service/src/controllers/applicationController.js');
        const invalid = makeRes();
        await sendDecisionNotification(companyReq({ body: { decision: 'maybe' } }), invalid);
        expect(invalid.statusCode).toBe(400);
        for (const [result, status] of [[{ notFound: true }, 404], [{ denied: true }, 403]]) {
            mocks.withTransaction.mockResolvedValueOnce(result);
            const res = makeRes();
            await sendDecisionNotification(companyReq({ body: { decision: 'accepted' } }), res);
            expect(res.statusCode).toBe(status);
        }
    });

    it('records accepted decisions, truncates messages, and queues email event', async () => {
        const before = { id: 1, stage: 'phong_van', company_id: 9, candidate_id: 2, candidate_email: 'a@b.com', candidate_name: 'Lan', job_id: 3, job_title: 'Dev' };
        const after = { ...before, stage: 'nhan_viec' };
        const client = { query: vi.fn().mockResolvedValueOnce({ rows: [before] }).mockResolvedValueOnce({ rows: [after] }).mockResolvedValueOnce({}) };
        mocks.withTransaction.mockImplementation((work) => work(client));
        const { sendDecisionNotification } = await import('../application-service/src/controllers/applicationController.js');
        const res = makeRes();
        await sendDecisionNotification(companyReq({ params: { id: '1' }, body: { decision: 'accepted', message: `  ${'x'.repeat(4000)}  ` } }), res);
        const payload = mocks.enqueueOutboxEvent.mock.calls[0][1].payload;
        expect(payload).toMatchObject({ applicationId: 1, candidateEmail: 'a@b.com', decision: 'accepted', fromStage: 'phong_van', toStage: 'nhan_viec' });
        expect(payload.message).toHaveLength(3000);
        expect(res.body.emailQueued).toBe(true);
    });

    it('supports resending an unchanged rejection and maps failures', async () => {
        const app = { id: 1, stage: 'tu_choi', company_id: 9, candidate_id: 2 };
        const client = { query: vi.fn().mockResolvedValueOnce({ rows: [app] }).mockResolvedValueOnce({}) };
        mocks.withTransaction.mockImplementationOnce((work) => work(client));
        const { sendDecisionNotification } = await import('../application-service/src/controllers/applicationController.js');
        const ok = makeRes();
        await sendDecisionNotification(companyReq({ body: { decision: 'rejected', message: ' ' } }), ok);
        expect(client.query).toHaveBeenCalledTimes(2);
        expect(mocks.enqueueOutboxEvent.mock.calls[0][1].payload).toMatchObject({ fromStage: null, message: null });
        mocks.withTransaction.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await sendDecisionNotification(companyReq({ body: { decision: 'accepted' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('validates and updates ratings with ownership checks', async () => {
        const { rateApplication } = await import('../application-service/src/controllers/applicationController.js');
        for (const rating of [0, 6, 2.5, undefined]) {
            const res = makeRes();
            await rateApplication(companyReq({ body: { rating } }), res);
            expect(res.statusCode).toBe(400);
        }
        mocks.pool.query.mockResolvedValueOnce({ rows: [] });
        const missing = makeRes();
        await rateApplication(companyReq({ body: { rating: 4 } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ company_id: 2 }] });
        const denied = makeRes();
        await rateApplication(companyReq({ body: { rating: 4 } }), denied);
        expect(denied.statusCode).toBe(403);
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ company_id: 9 }] }).mockResolvedValueOnce({ rows: [{ id: 1, rating: 4 }] });
        const ok = makeRes();
        await rateApplication(companyReq({ params: { id: '1' }, body: { rating: '4' } }), ok);
        expect(ok.body.data.rating).toBe(4);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await rateApplication(companyReq({ body: { rating: 4 } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('validates, authorizes, truncates, and creates internal notes', async () => {
        const { addNote } = await import('../application-service/src/controllers/applicationController.js');
        const empty = makeRes();
        await addNote(companyReq({ body: { body: '   ' } }), empty);
        expect(empty.statusCode).toBe(400);
        mocks.pool.query.mockResolvedValueOnce({ rows: [] });
        const missing = makeRes();
        await addNote(companyReq({ body: { body: 'x' } }), missing);
        expect(missing.statusCode).toBe(404);
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ company_id: 2 }] });
        const denied = makeRes();
        await addNote(companyReq({ body: { body: 'x' } }), denied);
        expect(denied.statusCode).toBe(403);
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ company_id: 9 }] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
        const ok = makeRes();
        await addNote(companyReq({ params: { id: '1' }, body: { body: ` ${'x'.repeat(6000)} ` } }), ok);
        expect(mocks.pool.query.mock.calls.at(-1)[1][2]).toHaveLength(5000);
        expect(ok.statusCode).toBe(201);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await addNote(companyReq({ body: { body: 'note' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('returns ordered funnel metrics and a zero-safe conversion rate', async () => {
        const { getFunnel } = await import('../application-service/src/controllers/applicationController.js');
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ stage: 'moi_ung_tuyen', count: 8, avg_rating: '3.5' }, { stage: 'nhan_viec', count: 2, avg_rating: '5' }] });
        const res = makeRes();
        await getFunnel(companyReq({ query: { jobId: '7' } }), res);
        expect(res.body.data).toMatchObject({ total: 10, hired: 2, conversionRate: 20 });
        expect(res.body.data.funnel).toHaveLength(6);
        mocks.pool.query.mockResolvedValueOnce({ rows: [] });
        const empty = makeRes();
        await getFunnel(companyReq(), empty);
        expect(empty.body.data.conversionRate).toBe(0);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await getFunnel(companyReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('requires a candidate identity and labels application history', async () => {
        const { myApplications } = await import('../application-service/src/controllers/applicationController.js');
        const denied = makeRes();
        await myApplications(makeReq(), denied);
        expect(denied.statusCode).toBe(401);
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ id: 1, stage: 'phong_van' }] });
        const ok = makeRes();
        await myApplications(makeReq({ headers: { 'x-user-id': '4' } }), ok);
        expect(ok.body.data[0].stageLabel).toBe('Phỏng vấn');
        expect(ok.body.count).toBe(1);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await myApplications(makeReq({ headers: { 'x-user-id': '4' } }), failed);
        expect(failed.statusCode).toBe(500);
    });
});

describe('talent pool controller', () => {
    it('requires company scope for non-admin reads/saves', async () => {
        const { savedCandidates, saveCandidate } = await import('../application-service/src/controllers/talentPoolController.js');
        for (const handler of [savedCandidates, saveCandidate]) {
            const res = makeRes();
            await handler(makeReq({ headers: { 'x-user-role': 'COMPANY' } }), res);
            expect(res.statusCode).toBe(403);
        }
    });

    it('filters saved candidates and handles DB errors', async () => {
        const { savedCandidates } = await import('../application-service/src/controllers/talentPoolController.js');
        mocks.pool.query.mockResolvedValueOnce({ rows: [{ candidate_id: 1 }] });
        const res = makeRes();
        await savedCandidates(companyReq({ query: { tag: 'backend', q: 'Lan' } }), res);
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([9, 'backend', '%Lan%']);
        expect(res.body.count).toBe(1);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await savedCandidates(companyReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('validates and upserts candidates with normalized values', async () => {
        const { saveCandidate } = await import('../application-service/src/controllers/talentPoolController.js');
        const invalid = makeRes();
        await saveCandidate(companyReq(), invalid);
        expect(invalid.statusCode).toBe(400);
        mocks.pool.query.mockResolvedValue({ rows: [{ candidate_id: 12 }] });
        const ok = makeRes();
        await saveCandidate(companyReq({ body: { candidateId: '12', candidateName: 'Lan', tags: 'bad', note: '' } }), ok);
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([9, 12, 'Lan', 5, [], null]);
        expect(ok.statusCode).toBe(201);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await saveCandidate(companyReq({ body: { candidateId: 1 } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('removes only scoped candidates and handles missing/error cases', async () => {
        const { removeCandidate } = await import('../application-service/src/controllers/talentPoolController.js');
        mocks.pool.query.mockResolvedValueOnce({ rowCount: 0 });
        const missing = makeRes();
        await removeCandidate(companyReq({ params: { candidateId: '2' } }), missing);
        expect(missing.statusCode).toBe(404);
        expect(mocks.pool.query.mock.calls[0][1]).toEqual([2, 9]);
        mocks.pool.query.mockResolvedValueOnce({ rowCount: 1 });
        const ok = makeRes();
        await removeCandidate(makeReq({ headers: { 'x-user-role': 'ADMIN' }, params: { candidateId: '2' } }), ok);
        expect(mocks.pool.query.mock.calls[1][1]).toEqual([2]);
        expect(ok.body.errCode).toBe(0);
        mocks.pool.query.mockRejectedValue(new Error('db'));
        const failed = makeRes();
        await removeCandidate(companyReq({ params: { candidateId: '2' } }), failed);
        expect(failed.statusCode).toBe(500);
    });
});

describe('legacy application synchronization', () => {
    it('imports only applications with a company and maps read state', async () => {
        const rows = [
            { cv_id: 1, candidate_id: 2, job_id: 3, isChecked: 1, firstName: 'Lan', lastName: 'Le', company_id: 9, createdAt: new Date('2026-01-01'), description: 'Hi' },
            { cv_id: 2, company_id: null }
        ];
        mocks.legacy.query.mockResolvedValue([rows]);
        mocks.pool.query.mockResolvedValue({ rowCount: 1 });
        const { syncFromLegacy } = await import('../application-service/src/controllers/syncController.js');
        await expect(syncFromLegacy()).resolves.toEqual({ total: 2, imported: 1 });
        const params = mocks.pool.query.mock.calls[0][1];
        expect(params).toEqual(expect.arrayContaining([1, 3, 2, 'Lan Le', 9, 'dang_xem_xet', true]));
        expect(JSON.parse(params.at(-1))).toMatchObject({ fullName: 'Lan Le', source: 'legacy_mysql' });
    });

    it('counts only inserted rows, returns errors safely, and exposes endpoint status', async () => {
        const { syncFromLegacy, syncEndpoint } = await import('../application-service/src/controllers/syncController.js');
        mocks.legacy.query.mockResolvedValueOnce([[{ cv_id: 1, company_id: 2 }]]);
        mocks.pool.query.mockResolvedValueOnce({ rowCount: 0 });
        await expect(syncFromLegacy()).resolves.toEqual({ total: 1, imported: 0 });
        mocks.legacy.query.mockRejectedValue(new Error('legacy down'));
        const result = await syncFromLegacy();
        expect(result).toMatchObject({ total: 0, imported: 0, error: 'legacy down' });
        mocks.legacy.query.mockRejectedValue(new Error('legacy down'));
        const res = makeRes();
        await syncEndpoint(makeReq(), res);
        expect(res.body.errCode).toBe(-1);
    });
});

describe('submission event consumer', () => {
    it('accepts the published legacy submission contract with intact identity and snapshot', async () => {
        const { startSubmissionConsumer } = await import('../application-service/src/consumers/submissionConsumer.js');
        await startSubmissionConsumer();
        const handler = mocks.consume.mock.calls[0][2];
        mocks.pool.query.mockResolvedValue({ rowCount: 1 });
        const { payload, metadata } = decodeEventFixture('application.submitted');
        await handler(payload, 'application.submitted', metadata);
        const [sql, values] = mocks.pool.query.mock.calls[0];
        expect(sql).toContain('ON CONFLICT (legacy_cv_id) DO NOTHING');
        expect(values.slice(0, 9)).toEqual([21, 7, 'Developer', 9, payload.candidateName, payload.candidateEmail, null, 3, payload.coverLetter]);
        expect(values[9]).toEqual(new Date(payload.appliedAt));
    });
    it('registers a durable idempotent consumer and skips incomplete events', async () => {
        const { startSubmissionConsumer } = await import('../application-service/src/consumers/submissionConsumer.js');
        await startSubmissionConsumer();
        const [queue, patterns, handler, options] = mocks.consume.mock.calls[0];
        expect(queue).toBe('application-service.submissions');
        expect(patterns).toEqual(['application.submitted']);
        expect(options).toEqual({ prefetch: 20 });
        await handler({ cvId: null, companyId: 2 });
        await handler({ cvId: 1, companyId: null });
        expect(mocks.pool.query).not.toHaveBeenCalled();
    });

    it('persists a snapshot with supplied/default timestamps and tolerates duplicates', async () => {
        const { startSubmissionConsumer } = await import('../application-service/src/consumers/submissionConsumer.js');
        await startSubmissionConsumer();
        const handler = mocks.consume.mock.calls[0][2];
        mocks.pool.query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
        const payload = { cvId: 1, jobId: 2, jobTitle: 'Dev', candidateId: 3, candidateName: 'Lan', candidateEmail: 'a@b.com', candidatePhone: '1', companyId: 4, coverLetter: 'Hi', appliedAt: '2026-01-01T00:00:00Z' };
        await handler(payload);
        const params = mocks.pool.query.mock.calls[0][1];
        expect(params[9]).toEqual(new Date(payload.appliedAt));
        expect(JSON.parse(params[10])).toMatchObject({ fullName: 'Lan', source: 'legacy_event' });
        await expect(handler({ ...payload, appliedAt: null })).resolves.toBeUndefined();
        expect(mocks.pool.query.mock.calls[1][1][9]).toBeInstanceOf(Date);
    });
});
