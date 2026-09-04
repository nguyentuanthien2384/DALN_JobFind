import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCurrentJob, listCurrentJobIds, jobIdString } from '../search-service/src/libs/jobSource.js';
import { searchRetry } from '../search-service/src/libs/searchRetry.js';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mocks.get } }));
beforeEach(() => {
    vi.stubEnv('INTERNAL_SECRET', 'source-test-secret');
    vi.stubEnv('JOB_CORE_URL', 'http://job-core-test:4002');
});
afterEach(() => vi.unstubAllEnvs());

describe('trusted current-job source', () => {
    it('fetches the authoritative row including hidden/deleted jobs with a bounded timeout', async () => {
        const job = { id: 7, name: 'gone', statusCode: 'PS4' };
        mocks.get.mockResolvedValue({ data: { errCode: 0, data: job } });
        expect(await loadCurrentJob(7)).toEqual(job);
        expect(mocks.get).toHaveBeenCalledWith('http://job-core-test:4002/internal/jobs/7', {
            timeout: 10000, headers: { 'x-internal-secret': 'source-test-secret' }
        });
    });

    it('only treats the explicit domain not-found response as a removed job', async () => {
        mocks.get.mockRejectedValueOnce({ response: { status: 404, data: { errCode: 2 } } });
        expect(await loadCurrentJob(7)).toBeNull();
        for (const error of [
            { response: { status: 404, data: '<html>Cannot GET old endpoint</html>' } },
            { response: { status: 403, data: { errCode: 2 } } },
            { response: { status: 500, data: { errCode: -1 } } },
            Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
        ]) {
            mocks.get.mockRejectedValueOnce(error);
            await expect(loadCurrentJob(7)).rejects.toBe(error);
        }
    });

    it.each([
        { errCode: -1, data: { id: 7, statusCode: 'PS1' } },
        { errCode: 0, data: null }, { errCode: 0, data: { id: 8, statusCode: 'PS1' } },
        { errCode: 0, data: { id: 7 } }
    ])('rejects malformed/mismatched successful response %j', async (data) => {
        mocks.get.mockResolvedValue({ data });
        await expect(loadCurrentJob(7)).rejects.toThrow('Invalid current-job response');
    });

    it('discovers only IDs from list snapshots, optionally for a company', async () => {
        mocks.get.mockResolvedValue({ data: { errCode: 0, data: [{ id: 7, companyId: 3 }, { id: 8, companyId: 4 }] } });
        expect(await listCurrentJobIds()).toEqual(['7', '8']);
        expect(await listCurrentJobIds('3')).toEqual(['7']);
        expect(mocks.get.mock.lastCall[1].timeout).toBe(30000);
        mocks.get.mockResolvedValue({ data: { errCode: 0, data: [] } });
        expect(await listCurrentJobIds()).toEqual([]);
        mocks.get.mockResolvedValue({ data: { errCode: -1 } });
        await expect(listCurrentJobIds()).rejects.toThrow('Invalid job-list response');
    });

    it('rejects invalid IDs and missing internal credentials before making requests', async () => {
        for (const id of [undefined, null, '', 0, -1, '01', '7/8', '1.5', '9007199254740992']) {
            expect(() => jobIdString(id)).toThrow('Invalid job ID');
        }
        vi.stubEnv('INTERNAL_SECRET', '');
        await expect(loadCurrentJob(7)).rejects.toThrow('INTERNAL_SECRET');
        expect(mocks.get).not.toHaveBeenCalled();
    });
});

describe('search retry policy', () => {
    const context = { metadata: { eventId: 'event-1' } };
    it('bounds retry and recognizes source outages, throttling and ES contention', () => {
        expect(searchRetry.delaysMs).toEqual([2000, 10000, 30000]);
        for (const error of [
            { code: 'SEARCH_PROJECTION_CONFLICT' }, { code: 'ECONNABORTED' }, { code: 'ECONNREFUSED' },
            { name: 'ConnectionError' }, { name: 'TimeoutError' },
            ...[429, 500, 502, 503, 504].map((status) => ({ response: { status } })),
            { meta: { statusCode: 429 } }
        ]) expect(searchRetry.shouldRetry(error, context)).toBe(true);
    });
    it('does not retry legacy events, validation/auth failures or unknown errors', () => {
        expect(searchRetry.shouldRetry({ code: 'ECONNRESET' }, { metadata: {} })).toBe(false);
        for (const error of [new Error('unknown'), { response: { status: 404 } },
            { response: { status: 403 } }, { meta: { statusCode: 400 } }, { meta: { statusCode: 409 } }]) {
            expect(searchRetry.shouldRetry(error, context)).toBe(false);
        }
    });
});
