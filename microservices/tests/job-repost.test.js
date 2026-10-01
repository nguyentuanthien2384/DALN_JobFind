import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { expectResponseContract } from './contractAssertions.js';
import { jobRevision } from '../shared/jobRevision.js';

// Controller-level tests for "Đăng lại tin": the ledger, lock and quota helpers
// have their own suites, so here they are replaced by spies to pin down the
// order of checks and how each failure maps to an HTTP response.
const mocks = vi.hoisted(() => ({
    conn: { query: vi.fn() },
    withTransaction: vi.fn(),
    enqueueOutboxEvent: vi.fn(),
    runJobRequest: vi.fn(),
    lockJobForEdit: vi.fn(),
    consumeLockedPostingQuota: vi.fn()
}));

vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: { query: vi.fn() }, withTransaction: mocks.withTransaction }));
vi.mock('../shared/rabbitmq.js', () => ({ publish: vi.fn() }));
vi.mock('../job-core-service/src/libs/outbox.js', () => ({ enqueueOutboxEvent: mocks.enqueueOutboxEvent }));
vi.mock('../job-core-service/src/libs/jobRequest.js', async (importOriginal) => ({
    ...(await importOriginal()), runJobRequest: mocks.runJobRequest
}));
vi.mock('../job-core-service/src/libs/jobEdit.js', async (importOriginal) => ({
    ...(await importOriginal()), lockJobForEdit: mocks.lockJobForEdit
}));
vi.mock('../job-core-service/src/libs/postingQuota.js', async (importOriginal) => ({
    ...(await importOriginal()), consumeLockedPostingQuota: mocks.consumeLockedPostingQuota
}));

const { repostJob } = await import('../job-core-service/src/controllers/jobController.js');
const { PostingQuotaError } = await import('../job-core-service/src/libs/postingQuota.js');
const { JobEditError } = await import('../job-core-service/src/libs/jobEdit.js');

const DAY = 24 * 3600 * 1000;
const expiredAt = () => String(Date.now() - DAY);
const futureAt = (days = 30) => String(Date.now() + days * DAY);
const sourcePost = (overrides = {}) => ({
    id: 5, userId: 7, detailPostId: 50, statusCode: 'PS1', timeEnd: expiredAt(), isHot: 0, ...overrides
});
const sourceDetail = (overrides = {}) => ({
    id: 50, name: 'Node.js Developer', descriptionHTML: '<p>Build APIs</p>', descriptionMarkdown: 'Build APIs',
    categoryJobCode: 'IT', addressCode: 'HCM', salaryJobCode: 'S1', amount: 2, categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'E1', genderPostCode: 'G0', ...overrides
});
const createdJob = { id: 21, name: 'Node.js Developer', descriptionHTML: '<p>Build APIs</p>', statusCode: 'PS3', userId: 7, companyId: 3 };

// Query script for the happy path, in the exact order the controller issues them.
const scriptQueries = ({ initial = { id: 5, userId: 7 }, detail = sourceDetail(), job = createdJob } = {}) => {
    mocks.conn.query.mockImplementation(async (sql) => {
        if (sql.startsWith('SELECT id, userId FROM posts')) return [[initial].filter(Boolean)];
        if (sql.startsWith('SELECT * FROM detailposts')) return [[detail].filter(Boolean)];
        if (sql.startsWith('INSERT INTO detailposts')) return [{ insertId: 11 }];
        if (sql.includes('INSERT INTO posts')) return [{ insertId: 21 }];
        if (sql.includes('FROM posts p')) return [[job].filter(Boolean)];
        if (sql.includes('job_moderation_state')) return [{ affectedRows: 1 }];
        throw new Error(`unexpected query: ${sql}`);
    });
};
const repostReq = ({ id = '5', body = { timeEnd: futureAt() }, key = 'repost-key-1', role = 'COMPANY' } = {}) => makeReq({
    method: 'POST', params: { id },
    headers: { 'x-user-id': '7', 'x-company-id': '3', 'x-user-role': role, ...(key === null ? {} : { 'idempotency-key': key }) },
    body
});
const sql = (fragment) => mocks.conn.query.mock.calls.filter(([text]) => text.includes(fragment));

beforeEach(() => {
    mocks.conn.query.mockReset();
    mocks.withTransaction.mockReset().mockImplementation((work) => work(mocks.conn));
    mocks.enqueueOutboxEvent.mockReset().mockResolvedValue('event-id');
    mocks.runJobRequest.mockReset().mockImplementation((_conn, _context, work) => work());
    mocks.lockJobForEdit.mockReset().mockResolvedValue(sourcePost());
    mocks.consumeLockedPostingQuota.mockReset().mockResolvedValue(undefined);
});

describe('repost job: request validation', () => {
    it.each([
        ['non-numeric id', { id: 'abc' }],
        ['zero id', { id: '0' }],
        ['negative id', { id: '-4' }],
        ['fractional id', { id: '1.5' }],
        ['missing new deadline', { body: {} }],
        ['empty new deadline', { body: { timeEnd: '' } }],
        ['missing body', { body: null }]
    ])('rejects %s with 400 before opening a transaction', async (_label, overrides) => {
        const res = makeRes();
        await repostJob(repostReq(overrides), res);
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ errCode: 2, errMessage: 'Thiếu tin nguồn hoặc ngày hết hạn mới' });
        expect(mocks.withTransaction).not.toHaveBeenCalled();
    });

    it('rejects a deadline that is not in the future without touching the source post', async () => {
        const res = makeRes();
        await repostJob(repostReq({ body: { timeEnd: String(Date.now() - 1000) } }), res);
        expect(res.statusCode).toBe(400);
        expect(res.body.errMessage).toBe('Ngày hết hạn phải nằm trong tương lai');
        expect(mocks.conn.query).not.toHaveBeenCalled();
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });

    it.each(['soon', '1e3', String(8640000000000001)])('rejects malformed deadline %s', async (timeEnd) => {
        const res = makeRes();
        await repostJob(repostReq({ body: { timeEnd } }), res);
        expect(res.statusCode).toBe(400);
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });
});

describe('repost job: idempotent request ledger', () => {
    it('always requires an idempotency key and hashes only the source and deadline', async () => {
        scriptQueries();
        const timeEnd = futureAt(10);
        await repostJob(repostReq({ body: { timeEnd, name: 'ignored edit' } }), makeRes());
        expect(mocks.runJobRequest).toHaveBeenCalledWith(mocks.conn, {
            userId: 7, companyId: 3, key: 'repost-key-1', operation: 'repost', input: { sourceId: 5, timeEnd }, required: true
        }, expect.any(Function));
    });

    it('includes expectedRevision in the hashed input only when the client sent it', async () => {
        scriptQueries();
        const post = sourcePost();
        mocks.lockJobForEdit.mockResolvedValue(post);
        const expectedRevision = jobRevision(post, sourceDetail());
        const timeEnd = futureAt();
        await repostJob(repostReq({ body: { timeEnd, expectedRevision } }), makeRes());
        expect(mocks.runJobRequest.mock.calls[0][1].input).toEqual({ sourceId: 5, timeEnd, expectedRevision });
    });

    it('returns the replayed response from the ledger without running the repost again', async () => {
        mocks.runJobRequest.mockResolvedValue({ postId: 21, job: createdJob });
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(201);
        expect(res.body).toEqual({ errCode: 0, data: createdJob });
        expect(mocks.conn.query).not.toHaveBeenCalled();
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });

    it('maps ledger rejections (missing key, foreign company, reused key) to their status codes', async () => {
        const { JobRequestError } = await import('../job-core-service/src/libs/jobRequest.js');
        for (const [message, status] of [['Mã thao tác đăng tin không hợp lệ hoặc còn thiếu', 400],
            ['Mã thao tác thuộc công ty khác hoặc không còn hợp lệ', 403], ['Mã thao tác đã dùng cho nội dung khác', 409]]) {
            mocks.runJobRequest.mockRejectedValueOnce(new JobRequestError(message, status));
            const res = makeRes();
            await repostJob(repostReq({ key: null }), res);
            expect(res.statusCode).toBe(status);
            expect(res.body).toEqual({ errCode: 2, errMessage: message });
        }
    });
});

describe('repost job: source checks under lock', () => {
    it('returns 404 when the source post does not exist', async () => {
        scriptQueries({ initial: null });
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(404);
        expect(res.body.errMessage).toBe('Không tìm thấy tin tuyển dụng');
        expect(mocks.lockJobForEdit).not.toHaveBeenCalled();
    });

    it('locks with COMPANY rights even for an admin so paid slots come from their own company', async () => {
        scriptQueries();
        await repostJob(repostReq({ role: 'ADMIN' }), makeRes());
        expect(mocks.lockJobForEdit).toHaveBeenCalledWith(mocks.conn, { id: 5, userId: 7 }, { userId: 7, companyId: 3, roleCode: 'COMPANY' });
    });

    it('maps lock failures (foreign company, removed post) to the lock error status', async () => {
        scriptQueries();
        mocks.lockJobForEdit.mockRejectedValueOnce(new JobEditError('Bạn không có quyền sửa tin hoặc thông tin công ty đã thay đổi', 403));
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(403);
        expect(res.body.errCode).toBe(2);
        expect(sql('INSERT INTO posts')).toHaveLength(0);
    });

    it.each(['PS4', 'PS9', null])('refuses to repost a source with status %s', async (statusCode) => {
        scriptQueries();
        mocks.lockJobForEdit.mockResolvedValue(sourcePost({ statusCode }));
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.errMessage).toBe('Trạng thái tin nguồn không hợp lệ');
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });

    it.each([
        ['a still-active post', () => futureAt(5)],
        ['a missing deadline', () => null],
        ['a zero-padded deadline', () => `0${expiredAt()}`],
        ['a non-numeric deadline', () => 'yesterday'],
        ['a deadline beyond the Date range', () => '9999999999999999'],
        ['a boolean deadline', () => true]
    ])('only reposts expired posts, refusing %s', async (_label, timeEnd) => {
        scriptQueries();
        mocks.lockJobForEdit.mockResolvedValue(sourcePost({ timeEnd: timeEnd() }));
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.errMessage).toBe('Chỉ có thể đăng lại tin đã hết hạn và có ngày hết hạn hợp lệ');
        expect(sql('FROM detailposts')).toHaveLength(0);
    });

    it('accepts a numeric expired deadline as stored by MySQL BIGINT columns', async () => {
        scriptQueries();
        mocks.lockJobForEdit.mockResolvedValue(sourcePost({ timeEnd: Date.now() - DAY }));
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(201);
    });

    it('returns 409 when the source detail snapshot is gone', async () => {
        scriptQueries({ detail: null });
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(409);
        expect(res.body.errMessage).toBe('Không tìm thấy nội dung tin nguồn');
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });

    it('flags a stale editor revision as a conflict instead of reposting outdated content', async () => {
        scriptQueries();
        const stale = jobRevision(sourcePost(), sourceDetail({ name: 'Old title' }));
        const res = makeRes();
        await repostJob(repostReq({ body: { timeEnd: futureAt(), expectedRevision: stale } }), res);
        expect(res.statusCode).toBe(409);
        expect(res.body).toEqual({ errCode: 2, errMessage: expect.stringContaining('Tin đã thay đổi'), conflict: true });
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });

    it('rejects a malformed revision with 400', async () => {
        scriptQueries();
        const res = makeRes();
        await repostJob(repostReq({ body: { timeEnd: futureAt(), expectedRevision: 'v1' } }), res);
        expect(res.statusCode).toBe(400);
        expect(res.body.conflict).toBeUndefined();
    });

    it('re-checks the new deadline after waiting for locks so an expired copy is never created', async () => {
        scriptQueries();
        const timeEnd = String(Date.now() + 50);
        const now = vi.spyOn(Date, 'now');
        // First check (before locks) passes; the post-lock re-check sees time has moved on.
        mocks.lockJobForEdit.mockImplementation(async () => { now.mockReturnValue(Number(timeEnd) + 1); return sourcePost({ timeEnd: '1000' }); });
        const res = makeRes();
        await repostJob(repostReq({ body: { timeEnd } }), res);
        now.mockRestore();
        expect(res.statusCode).toBe(400);
        expect(res.body.errMessage).toBe('Ngày hết hạn phải nằm trong tương lai');
        expect(mocks.consumeLockedPostingQuota).not.toHaveBeenCalled();
    });
});

describe('repost job: quota and new pending copy', () => {
    it('spends the matching quota and creates a pending copy with its own detail snapshot', async () => {
        scriptQueries();
        mocks.lockJobForEdit.mockResolvedValue(sourcePost({ isHot: 1 }));
        const timeEnd = futureAt(15);
        const res = makeRes();
        await repostJob(repostReq({ body: { timeEnd } }), res);

        expect(mocks.consumeLockedPostingQuota).toHaveBeenCalledWith(mocks.conn, { companyId: 3, isHot: 1 });
        const [detailInsert] = sql('INSERT INTO detailposts');
        expect(detailInsert[1]).toEqual(['Node.js Developer', '<p>Build APIs</p>', 'Build APIs', 'IT', 'HCM', 'S1', 2, 'JL1', 'WT1', 'E1', 'G0']);
        const [postInsert] = sql('INSERT INTO posts');
        expect(postInsert[1].slice(0, 4)).toEqual(['PS3', timeEnd, 7, 1]);
        expect(postInsert[1][5]).toBe(11);
        expect(sql('LOCK IN SHARE MODE')).toHaveLength(1);

        expect(res.statusCode).toBe(201);
        expect(res.body).toEqual({ errCode: 0, data: createdJob });
        expectResponseContract('jobRepost', res);
    });

    it('queues the creation event and a fresh AI moderation request in the same transaction', async () => {
        scriptQueries();
        await repostJob(repostReq(), makeRes());
        expect(mocks.enqueueOutboxEvent).toHaveBeenNthCalledWith(1, mocks.conn, expect.objectContaining({
            aggregateType: 'job', aggregateId: 21, eventType: 'job.created', payload: { job: createdJob, notificationPolicy: 'approval-v1' }
        }));
        expect(mocks.enqueueOutboxEvent).toHaveBeenNthCalledWith(2, mocks.conn, expect.objectContaining({
            aggregateId: 21, eventType: 'ai.moderate_job', payload: expect.objectContaining({ jobId: 21, moderationRequestId: expect.any(String) })
        }));
        expect(sql('INSERT INTO job_moderation_state')).toHaveLength(1);
    });

    it('stores null for detail fields missing from a legacy snapshot', async () => {
        scriptQueries({ detail: { id: 50, name: 'Legacy', descriptionHTML: '<p>x</p>' } });
        await repostJob(repostReq(), makeRes());
        const [detailInsert] = sql('INSERT INTO detailposts');
        expect(detailInsert[1].slice(2)).toEqual(Array(9).fill(null));
    });

    it('maps an exhausted quota to 409 with the quota message and creates nothing', async () => {
        scriptQueries();
        mocks.consumeLockedPostingQuota.mockRejectedValueOnce(new PostingQuotaError('Công ty bạn đã hết số lần đăng bài viết bình thường'));
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(409);
        expect(res.body).toEqual({ errCode: 2, errMessage: 'Công ty bạn đã hết số lần đăng bài viết bình thường' });
        expect(sql('INSERT INTO')).toHaveLength(0);
        expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled();
    });

    it('returns 500 without leaking internals when the new copy cannot be read back', async () => {
        scriptQueries({ job: null });
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ errCode: -1, errMessage: 'Không đăng lại được tin tuyển dụng' });
        expect(mocks.enqueueOutboxEvent).not.toHaveBeenCalled();
    });

    it('returns 500 for unexpected database or outbox failures', async () => {
        scriptQueries();
        mocks.enqueueOutboxEvent.mockRejectedValueOnce(new Error('outbox table missing'));
        const res = makeRes();
        await repostJob(repostReq(), res);
        expect(res.statusCode).toBe(500);
        expect(res.body.errCode).toBe(-1);
        mocks.withTransaction.mockRejectedValueOnce(new Error('deadlock'));
        const again = makeRes();
        await repostJob(repostReq(), again);
        expect(again.statusCode).toBe(500);
    });
});
