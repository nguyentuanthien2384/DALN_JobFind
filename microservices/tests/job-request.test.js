import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeJobCreate, futureJobDeadline, runJobRequest, ensureJobRequestTable } from '../job-core-service/src/libs/jobRequest.js';

const mocks = vi.hoisted(() => ({ query: vi.fn(), lock: vi.fn() }));
vi.mock('../job-core-service/src/libs/db.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../job-core-service/src/libs/postingQuota.js', async importOriginal => ({
    ...await importOriginal(), lockPostingCompany: mocks.lock
}));
const conn = { query: mocks.query };
const options = { userId: 7, companyId: 3, key: 'request-1', operation: 'create', input: { name: 'Dev' } };
const job = { id: 12, userId: 7, companyId: 3, name: 'Dev', statusCode: 'PS3' };
const work = vi.fn();
beforeEach(() => {
    mocks.query.mockReset().mockResolvedValue([{ affectedRows: 1 }]);
    mocks.lock.mockReset().mockResolvedValue(undefined);
    work.mockReset().mockResolvedValue({ postId: job.id, job });
});
afterEach(() => vi.useRealTimers());
const fresh = () => mocks.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]]);
const duplicate = (saved = {}, post = { id: 12, userId: 7 }) => {
    fresh();
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }));
    mocks.query.mockImplementationOnce(async () => [[{
        operation: 'create', requestHash: mocks.query.mock.calls[1][1][3],
        companyId: 3, postId: 12, responseJson: JSON.stringify(job), ...saved
    }]]).mockResolvedValueOnce([post ? [post] : []]);
};

describe('durable posting requests', () => {
    it('ensures a case-sensitive InnoDB key namespace with no TTL', async () => {
        mocks.query.mockResolvedValueOnce([{}]).mockResolvedValueOnce([[{ engine: 'InnoDB' }]]);
        await ensureJobRequestTable();
        expect(mocks.query.mock.calls[0][0]).toContain('COLLATE ascii_bin');
        expect(mocks.query.mock.calls[0][0]).toContain('PRIMARY KEY (userId, requestKey)');
        expect(mocks.query.mock.calls[0][0]).toContain('UNIQUE KEY uq_job_request_post (postId)');
    });
    it('preserves compatibility only for unkeyed create', async () => {
        await runJobRequest(conn, { ...options, key: undefined }, work);
        expect(work).toHaveBeenCalledOnce();
        expect(mocks.query).not.toHaveBeenCalled();
        await expect(runJobRequest(conn, { ...options, key: undefined, required: true }, work)).rejects.toMatchObject({ statusCode: 400 });
    });
    it.each(['', null, 'bad key', 'x'.repeat(129), ['two', 'keys']])('rejects unsafe key %j before writes', async key => {
        await expect(runJobRequest(conn, { ...options, key }, work)).rejects.toMatchObject({ statusCode: 400 });
        expect(mocks.query).not.toHaveBeenCalled();
        expect(work).not.toHaveBeenCalled();
    });
    it.each([{ userId: null }, { companyId: 0 }, { companyId: 1.5 }])('requires a company even for an admin: %j', async context => {
        await expect(runJobRequest(conn, { ...options, ...context }, work)).rejects.toMatchObject({ statusCode: 403 });
        expect(mocks.query).not.toHaveBeenCalled();
    });
    it.each(['MyISAM', undefined])('fails closed for a missing/nontransactional ledger (%s)', async engine => {
        mocks.query.mockResolvedValueOnce([[{ engine }]]);
        await expect(runJobRequest(conn, options, work)).rejects.toMatchObject({ statusCode: 503 });
        expect(work).not.toHaveBeenCalled();
    });
    it('claims before work and finalizes the exact result in the same transaction', async () => {
        fresh();
        expect(await runJobRequest(conn, options, work)).toEqual({ postId: 12, job });
        expect(mocks.query.mock.calls[1][0]).toContain('INSERT INTO job_request_keys');
        expect(mocks.query.mock.calls[2][1]).toEqual([12, JSON.stringify(job), 7, 'request-1']);
        expect(mocks.query.mock.invocationCallOrder[1]).toBeLessThan(work.mock.invocationCallOrder[0]);
        expect(work.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[2]);
    });
    it('replays the accepted snapshot with current shared reads and current company authorization, without work/debit', async () => {
        duplicate();
        expect(await runJobRequest(conn, options, work)).toEqual({ postId: 12, job });
        expect(mocks.lock).toHaveBeenCalledWith(conn, { userId: 7, companyId: 3 });
        expect(mocks.query.mock.calls.slice(2).every(([sql]) => sql.includes('LOCK IN SHARE MODE'))).toBe(true);
        expect(work).not.toHaveBeenCalled();
    });
    it.each([{ operation: 'repost' }, { requestHash: 'changed' }])('rejects changed intent %j without work', async saved => {
        duplicate(saved);
        await expect(runJobRequest(conn, options, work)).rejects.toMatchObject({ statusCode: 409 });
        expect(work).not.toHaveBeenCalled();
    });
    it('denies keys from a previous company', async () => {
        duplicate({ companyId: 4 });
        await expect(runJobRequest(conn, options, work)).rejects.toMatchObject({ statusCode: 403 });
        expect(work).not.toHaveBeenCalled();
    });
    it.each([{ responseJson: '{' }, { responseJson: 'null' }, { responseJson: JSON.stringify({ ...job, userId: 8 }) }, { postId: 13 }])('fails closed on corrupted mapping %j', async saved => {
        duplicate(saved);
        await expect(runJobRequest(conn, options, work)).rejects.toMatchObject({ statusCode: 409 });
        expect(work).not.toHaveBeenCalled();
    });
    it.each([null, { id: 12, userId: 8 }])('never recreates a missing/transferred accepted post: %j', async post => {
        duplicate({}, post);
        await expect(runJobRequest(conn, options, work)).rejects.toMatchObject({ statusCode: 409 });
        expect(work).not.toHaveBeenCalled();
    });
    it('propagates work/finalization failure so the owner transaction rolls back', async () => {
        fresh(); work.mockRejectedValueOnce(new Error('outbox failed'));
        await expect(runJobRequest(conn, options, work)).rejects.toThrow('outbox failed');
        expect(mocks.query).toHaveBeenCalledTimes(2);
        mocks.query.mockReset(); fresh();
        mocks.query.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{ affectedRows: 0 }]);
        await expect(runJobRequest(conn, options, work)).rejects.toThrow('finalize');
    });
});

it('canonicalizes form numbers/defaults/order but preserves content and explicit deadline intent', () => {
    const a = normalizeJobCreate({ name: 'Dev', descriptionHTML: 'Text', categoryJobCode: 'IT' });
    const b = normalizeJobCreate({ categoryJobCode: 'IT', descriptionHTML: 'Text', name: 'Dev', amount: '1', isHot: false, addressCode: null, descriptionMarkdown: '' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.timeEnd).toBeNull();
    expect(normalizeJobCreate({ timeEnd: 2000000000000 }).timeEnd).toBe(normalizeJobCreate({ timeEnd: '2000000000000' }).timeEnd);
    expect(normalizeJobCreate({ descriptionHTML: ' Text ' }).descriptionHTML).toBe(' Text ');
});
it.each([0, -1, 'bad', '1700000000000', 8640000000000001])('rejects past/invalid new deadlines (%s)', value => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-05'));
    expect(() => futureJobDeadline(value)).toThrow('tương lai');
});
it('calculates the default deadline only when creating new work', () => {
    expect(Number(futureJobDeadline(null))).toBeGreaterThan(Date.now() + 29 * 86400000);
});
