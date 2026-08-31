import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => {
    const es = {
        cluster: { health: vi.fn() },
        indices: { exists: vi.fn(), create: vi.fn(), putMapping: vi.fn() },
        search: vi.fn(), index: vi.fn(), delete: vi.fn(), update: vi.fn(),
        updateByQuery: vi.fn(), bulk: vi.fn()
    };
    class Client { constructor(options) { es.options = options; return es; } }
    return {
        es,
        Client,
        axiosGet: vi.fn(),
        consume: vi.fn()
    };
});

vi.mock('@elastic/elasticsearch', () => ({ Client: mocks.Client }));
vi.mock('axios', () => ({ default: { get: mocks.axiosGet } }));
vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

beforeEach(() => {
    for (const fn of [
        mocks.es.cluster.health, mocks.es.indices.exists, mocks.es.indices.create,
        mocks.es.indices.putMapping, mocks.es.search, mocks.es.index, mocks.es.delete,
        mocks.es.update, mocks.es.updateByQuery, mocks.es.bulk,
        mocks.axiosGet, mocks.consume
    ]) fn.mockReset();
});

describe('Elasticsearch adapter', () => {
    it('waits for yellow health and retries transient failures', async () => {
        const { waitForElastic } = await import('../search-service/src/libs/elastic.js');
        mocks.es.cluster.health.mockResolvedValue(undefined);
        await waitForElastic();
        expect(mocks.es.cluster.health).toHaveBeenCalledWith({ wait_for_status: 'yellow', timeout: '30s' });

        vi.useFakeTimers();
        mocks.es.cluster.health.mockReset().mockRejectedValueOnce(new Error('booting')).mockResolvedValueOnce(undefined);
        const pending = waitForElastic();
        await vi.advanceTimersByTimeAsync(3000);
        await pending;
        expect(mocks.es.cluster.health).toHaveBeenCalledTimes(2);
    });

    it('stops retrying after the allowed attempts', async () => {
        const { waitForElastic } = await import('../search-service/src/libs/elastic.js');
        mocks.es.cluster.health.mockRejectedValue(new Error('down'));
        await expect(waitForElastic(11)).rejects.toThrow('down');
    });

    it('creates the jobs index only when absent', async () => {
        const { ensureIndex, INDEX } = await import('../search-service/src/libs/elastic.js');
        mocks.es.indices.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        await ensureIndex();
        expect(mocks.es.indices.create).toHaveBeenCalledWith(expect.objectContaining({
            index: INDEX,
            mappings: expect.objectContaining({ properties: expect.objectContaining({ name: expect.any(Object), statusCode: { type: 'keyword' } }) })
        }));
        mocks.es.indices.create.mockClear();
        await ensureIndex();
        expect(mocks.es.indices.create).not.toHaveBeenCalled();
        expect(mocks.es.indices.putMapping).toHaveBeenCalledWith(expect.objectContaining({
            index: INDEX,
            properties: expect.objectContaining({ companyStatusCode: { type: 'keyword' } })
        }));
    });

    it('normalizes database jobs into bounded search documents', async () => {
        vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
        const { toDocument } = await import('../search-service/src/libs/elastic.js');
        const doc = toDocument({
            id: 1, name: 'Dev', descriptionHTML: '<p>Hello&nbsp;  world</p>', statusCode: 'PS1',
            amount: 0, isHot: 1, timePost: '123', timeEnd: 'bad'
        });
        expect(doc).toMatchObject({
            id: 1, description: 'Hello world', amount: 0, isHot: true,
            companyStatusCode: null, companyCensorCode: null,
            timePost: 123, timeEnd: null, indexedAt: '2026-01-01T00:00:00.000Z'
        });
        expect(toDocument({ descriptionHTML: 'x'.repeat(21000) }).description).toHaveLength(20000);
        expect(toDocument({}).amount).toBe(1);
    });
});

describe('search controllers', () => {
    it('builds keyword/filter/sort/highlight queries and maps hits', async () => {
        mocks.es.search.mockResolvedValue({
            took: 4,
            hits: { total: { value: 1 }, hits: [{ _source: { id: 1 }, _score: 2, highlight: { description: ['match'] } }] }
        });
        const { searchJobs } = await import('../search-service/src/controllers/searchController.js');
        const req = makeReq({ query: {
            q: ' node ', categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: '',
            categoryJoblevelCode: 'L1', categoryWorktypeCode: 'FULL', experienceJobCode: 'E1',
            isHot: 'true', sort: 'relevance', limit: '500', offset: '5'
        } });
        const res = makeRes();
        await searchJobs(req, res);
        expect(res.body).toEqual({ errCode: 0, data: [{ id: 1, _score: 2, _highlight: 'match' }], count: 1, took: 4 });
        const query = mocks.es.search.mock.calls[0][0];
        expect(query).toMatchObject({ index: 'jobs', from: 5, size: 100, sort: ['_score', { isHot: 'desc' }] });
        expect(query.query.bool.filter).toContainEqual({ term: { isHot: true } });
        expect(query.query.bool.filter).toEqual(expect.arrayContaining([
            { term: { statusCode: 'PS1' } },
            { term: { companyStatusCode: 'S1' } },
            { term: { companyCensorCode: 'CS1' } }
        ]));
        expect(query.query.bool.must[0].multi_match.query).toBe('node');
        expect(query.highlight).toBeDefined();
    });

    it('uses match-all/newest defaults and fallback counts', async () => {
        mocks.es.search.mockResolvedValue({ took: 1, hits: { hits: [{ _source: { id: 2 }, _score: null }] } });
        const { searchJobs } = await import('../search-service/src/controllers/searchController.js');
        const res = makeRes();
        await searchJobs(makeReq({ query: { q: 'undefined', limit: 'bad', offset: 'bad' } }), res);
        const request = mocks.es.search.mock.calls[0][0];
        expect(request.query.bool.must).toEqual([{ match_all: {} }]);
        expect(request.sort).toEqual([{ isHot: 'desc' }, { timePost: 'desc' }]);
        expect(res.body.count).toBe(1);
    });

    it('returns a stable 500 response when search fails', async () => {
        mocks.es.search.mockRejectedValue(new Error('es down'));
        const { searchJobs } = await import('../search-service/src/controllers/searchController.js');
        const res = makeRes();
        await searchJobs(makeReq(), res);
        expect(res.statusCode).toBe(500);
        expect(res.body.errCode).toBe(-1);
    });

    it('validates suggestions and returns mapped suggestions', async () => {
        const { suggest } = await import('../search-service/src/controllers/searchController.js');
        const short = makeRes();
        await suggest(makeReq({ query: { q: 'a' } }), short);
        expect(short.body.data).toEqual([]);
        expect(mocks.es.search).not.toHaveBeenCalled();
        mocks.es.search.mockResolvedValue({ hits: { hits: [{ _source: { id: 1, name: 'Node' } }] } });
        const ok = makeRes();
        await suggest(makeReq({ query: { q: ' no ' } }), ok);
        expect(ok.body.data[0].name).toBe('Node');
        expect(mocks.es.search.mock.calls[0][0].query.bool.must[0].match_phrase_prefix.name.query).toBe('no');
        mocks.es.search.mockRejectedValue(new Error('x'));
        const failed = makeRes();
        await suggest(makeReq({ query: { q: 'node' } }), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('shapes facet buckets and handles missing aggregations/errors', async () => {
        const { facets } = await import('../search-service/src/controllers/searchController.js');
        mocks.es.search.mockResolvedValue({ aggregations: {
            byCategory: { buckets: [{ key: 'IT', doc_count: 3 }] },
            byProvince: { buckets: [{ key: 'HN', doc_count: 2 }] }
        } });
        const res = makeRes();
        await facets(makeReq(), res);
        expect(res.body.data).toEqual({ categories: [{ code: 'IT', count: 3 }], provinces: [{ code: 'HN', count: 2 }], salaries: [] });
        mocks.es.search.mockRejectedValue(new Error('x'));
        const failed = makeRes();
        await facets(makeReq(), failed);
        expect(failed.statusCode).toBe(500);
    });

    it('builds related-job queries, caps limits, and handles errors', async () => {
        const { related } = await import('../search-service/src/controllers/searchController.js');
        mocks.es.search.mockResolvedValue({ hits: { hits: [{ _source: { id: 2 } }] } });
        const res = makeRes();
        await related(makeReq({ params: { id: '9' }, query: { limit: '100' } }), res);
        expect(res.body.data).toEqual([{ id: 2 }]);
        expect(mocks.es.search.mock.calls[0][0]).toMatchObject({ size: 20 });
        expect(mocks.es.search.mock.calls[0][0].query.bool.must_not).toEqual([{ term: { id: 9 } }]);
        mocks.es.search.mockRejectedValue(new Error('x'));
        const failed = makeRes();
        await related(makeReq({ params: { id: '1' }, query: {} }), failed);
        expect(failed.statusCode).toBe(500);
    });
});

describe('search index consumer', () => {
    it('skips invalid/empty source responses', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.axiosGet.mockResolvedValueOnce({ data: { errCode: 1 } }).mockResolvedValueOnce({ data: { errCode: 0, data: [] } });
        await rebuildIndex();
        await rebuildIndex();
        expect(mocks.es.bulk).not.toHaveBeenCalled();
    });

    it('bulk rebuilds documents, reports item errors, and deletes orphans', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.axiosGet.mockResolvedValue({ data: { errCode: 0, data: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] } });
        mocks.es.bulk
            .mockResolvedValueOnce({ errors: true, items: [{ index: { error: { reason: 'bad' } } }, { index: {} }] })
            .mockResolvedValueOnce({ errors: false });
        mocks.es.search.mockResolvedValue({ hits: { hits: [{ _id: '1' }, { _id: '3' }] } });
        await rebuildIndex();
        expect(mocks.es.bulk).toHaveBeenCalledTimes(2);
        expect(mocks.es.bulk.mock.calls[0][0].operations).toHaveLength(4);
        expect(mocks.es.bulk.mock.calls[1][0].operations).toEqual([{ delete: { _index: 'jobs', _id: '3' } }]);
    });

    it('does not throw when rebuilding fails', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.axiosGet.mockRejectedValue(new Error('offline'));
        await expect(rebuildIndex()).resolves.toBeUndefined();
    });

    it('registers all event handlers and applies create/update/delete/moderation events', async () => {
        const { startIndexer } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.consume.mockResolvedValue(undefined);
        await startIndexer();
        const [queue, patterns, handler, options] = mocks.consume.mock.calls[0];
        expect(queue).toBe('search-service.indexer');
        expect(patterns).toHaveLength(5);
        expect(options).toEqual({ prefetch: 20 });

        mocks.es.index.mockResolvedValue(undefined);
        await handler({ job: { id: 4, name: 'Dev' } }, 'job.created');
        await handler({ job: null }, 'job.updated');
        expect(mocks.es.index).toHaveBeenCalledOnce();

        mocks.es.delete.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ meta: { statusCode: 404 } });
        await handler({ jobId: 4 }, 'job.deleted');
        await handler({ jobId: 5 }, 'job.deleted');

        mocks.es.update.mockResolvedValue(undefined);
        await handler({ jobId: 4, statusCode: 'PS1' }, 'job.moderated');
        expect(mocks.es.update).toHaveBeenCalledWith(expect.objectContaining({ id: '4', doc: { statusCode: 'PS1' } }));
        mocks.es.updateByQuery.mockResolvedValue(undefined);
        await handler({
            companyId: 3, companyStatusCode: 'S2', companyCensorCode: 'CS1'
        }, 'company.updated');
        expect(mocks.es.updateByQuery).toHaveBeenCalledWith(expect.objectContaining({
            query: { term: { companyId: 3 } },
            script: expect.objectContaining({ params: { status: 'S2', censor: 'CS1' } })
        }));
        await expect(handler({}, 'unknown')).resolves.toBeUndefined();
    });

    it('rethrows non-404 delete and moderation errors', async () => {
        const { startIndexer } = await import('../search-service/src/consumers/jobIndexer.js');
        await startIndexer();
        const handler = mocks.consume.mock.calls[0][2];
        mocks.es.delete.mockRejectedValue(new Error('boom'));
        await expect(handler({ jobId: 1 }, 'job.deleted')).rejects.toThrow('boom');
        mocks.es.update.mockRejectedValue(new Error('boom2'));
        await expect(handler({ jobId: 1 }, 'job.moderated')).rejects.toThrow('boom2');
        mocks.es.update.mockRejectedValue({ meta: { statusCode: 404 } });
        await expect(handler({ jobId: 1 }, 'job.moderated')).resolves.toBeUndefined();
    });
});
