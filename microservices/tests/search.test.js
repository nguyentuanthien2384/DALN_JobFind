import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import { expectResponseContract, decodeEventFixture } from './contractAssertions.js';
import { eventCatalog } from '../shared/contracts/eventCatalog.js';

const mocks = vi.hoisted(() => {
    const es = {
        cluster: { health: vi.fn() },
        indices: { exists: vi.fn(), create: vi.fn(), putMapping: vi.fn(), refresh: vi.fn() },
        search: vi.fn(), index: vi.fn(), delete: vi.fn(), update: vi.fn(),
        updateByQuery: vi.fn(), bulk: vi.fn(), scroll: vi.fn(), clearScroll: vi.fn()
    };
    class Client { constructor(options) { es.options = options; return es; } }
    return {
        es,
        Client,
        axiosGet: vi.fn(),
        consume: vi.fn(), listCurrentJobIds: vi.fn(), synchronizeJob: vi.fn()
    };
});

vi.mock('@elastic/elasticsearch', () => ({ Client: mocks.Client }));
vi.mock('axios', () => ({ default: { get: mocks.axiosGet } }));
vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));
vi.mock('../search-service/src/libs/jobProjection.js', () => ({ synchronizeJob: mocks.synchronizeJob }));
vi.mock('../search-service/src/libs/jobSource.js', async (original) => ({ ...(await original()), listCurrentJobIds: mocks.listCurrentJobIds }));

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

beforeEach(() => {
    for (const fn of [
        mocks.es.cluster.health, mocks.es.indices.exists, mocks.es.indices.create,
        mocks.es.indices.putMapping, mocks.es.search, mocks.es.index, mocks.es.delete,
        mocks.es.update, mocks.es.updateByQuery, mocks.es.bulk, mocks.es.scroll, mocks.es.clearScroll, mocks.es.indices.refresh,
        mocks.axiosGet, mocks.consume, mocks.listCurrentJobIds, mocks.synchronizeJob
    ]) fn.mockReset();
    mocks.synchronizeJob.mockResolvedValue({ changed: true, deleted: false });
    mocks.es.scroll.mockResolvedValue({ _scroll_id: 'cursor', hits: { hits: [] } });
    mocks.es.search.mockResolvedValue({ _scroll_id: 'cursor', hits: { hits: [] } });
    mocks.listCurrentJobIds.mockResolvedValue([]);
});

describe('published search consumer contracts', () => {
    it.each(Object.keys(eventCatalog).filter((key) => eventCatalog[key].consumers.includes('search-service.indexer')))
    ('refreshes the correct source for %s without trusting snapshot fields', async (key) => {
        const { handleSearchEvent } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.listCurrentJobIds.mockResolvedValue(['7']);
        const { payload, metadata } = decodeEventFixture(key);
        await handleSearchEvent(payload, key, metadata);
        expect(mocks.synchronizeJob).toHaveBeenCalledWith('7', { eventId: metadata.eventId });
        if (key === 'company.updated') expect(mocks.listCurrentJobIds).toHaveBeenCalledWith('3');
        expect(mocks.es.index).not.toHaveBeenCalled();
        expect(mocks.es.updateByQuery).not.toHaveBeenCalled();
    });
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
            properties: expect.objectContaining({ companyStatusCode: { type: 'keyword' },
                searchDeleted: { type: 'boolean' }, searchSync: { type: 'object', enabled: false } })
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
    it.each(['searchJobs', 'suggest', 'related', 'facets'])('hides tombstones and internal metadata in %s', async (action) => {
        const controller = await import('../search-service/src/controllers/searchController.js');
        mocks.es.search.mockResolvedValue({ hits: { hits: [{ _source: {
            id: 7, name: 'Dev', searchDeleted: false, searchSync: { hash: 'private', triggerEventId: 'private' }
        } }] } });
        const res = makeRes();
        await controller[action](makeReq({ params: { id: '1' }, query: { q: 'Dev' } }), res);
        expect(mocks.es.search.mock.lastCall[0].query.bool.filter).toContainEqual({
            bool: { must_not: [{ term: { searchDeleted: true } }] }
        });
        expect(JSON.stringify(res.body)).not.toContain('searchSync');
        expect(JSON.stringify(res.body)).not.toContain('searchDeleted');
    });

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
        expectResponseContract('searchSuggest', ok);
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
        expectResponseContract('searchFacets', res);
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
    it('reports source failures instead of declaring a successful rebuild', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.listCurrentJobIds.mockRejectedValue(new Error('source offline'));
        await expect(rebuildIndex()).rejects.toThrow('source offline');
        expect(mocks.synchronizeJob).not.toHaveBeenCalled();
    });

    it('rechecks indexed orphans even when the source list is empty', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.es.search.mockResolvedValue({ _scroll_id: 'cursor', hits: { hits: [{ _id: '3' }] } });
        mocks.synchronizeJob.mockResolvedValue({ changed: true, deleted: true });
        expect(await rebuildIndex()).toEqual({ total: 1, changed: 1, deleted: 1 });
        expect(mocks.synchronizeJob).toHaveBeenCalledWith('3', { eventId: undefined });
        expect(mocks.es.bulk).not.toHaveBeenCalled();
        expect(mocks.es.delete).not.toHaveBeenCalled();
        expect(mocks.es.indices.refresh).toHaveBeenCalledWith({ index: 'jobs' });
    });

    it('unions source and indexed IDs, rereads each once, and shares overlapping rebuilds', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        let sourceReady;
        mocks.listCurrentJobIds.mockImplementationOnce(() => new Promise((resolve) => { sourceReady = resolve; }));
        const first = rebuildIndex();
        const second = rebuildIndex();
        expect(first).toBe(second);
        mocks.es.search.mockResolvedValue({ _scroll_id: 'cursor', hits: { hits: [{ _id: '1' }, { _id: '3' }] } });
        sourceReady(['1', '2']);
        expect(await first).toEqual({ total: 3, changed: 3, deleted: 0 });
        expect(mocks.synchronizeJob.mock.calls.map(([id]) => id).sort()).toEqual(['1', '2', '3']);
    });

    it('scans beyond 10000 documents and releases its cursor', async () => {
        const { listIndexedIds } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.es.search.mockResolvedValue({ _scroll_id: 'first', hits: { hits: Array.from({ length: 10000 }, (_, i) => ({ _id: String(i + 1) })) } });
        mocks.es.scroll.mockResolvedValueOnce({ _scroll_id: 'last', hits: { hits: [{ _id: '10001' }] } })
            .mockResolvedValueOnce({ _scroll_id: 'last', hits: { hits: [] } });
        expect(await listIndexedIds()).toHaveLength(10001);
        expect(mocks.es.search.mock.calls[0][0]).toMatchObject({ scroll: '1m', allow_partial_search_results: false });
        expect(mocks.es.clearScroll).toHaveBeenCalledWith({ scroll_id: 'last' });
        expect(mocks.es.indices.refresh.mock.invocationCallOrder[0]).toBeLessThan(mocks.es.search.mock.invocationCallOrder[0]);
    });

    it('does not scan or report success after a partial refresh', async () => {
        const { listIndexedIds } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.es.indices.refresh.mockResolvedValueOnce({ _shards: { failed: 1 } });
        await expect(listIndexedIds()).rejects.toThrow('Incomplete Elasticsearch refresh');
        expect(mocks.es.search).not.toHaveBeenCalled();
    });

    it('reports a final visibility refresh failure instead of successful reconciliation', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.es.indices.refresh.mockResolvedValueOnce({ _shards: { failed: 0 } })
            .mockResolvedValueOnce({ _shards: { failed: 1 } });
        await expect(rebuildIndex()).rejects.toThrow('Incomplete Elasticsearch refresh');
    });

    it('rejects a partial scan or cursor failure and still cleans up', async () => {
        const { listIndexedIds } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.es.search.mockResolvedValueOnce({ _scroll_id: 'cursor', timed_out: true, hits: { hits: [] } });
        await expect(listIndexedIds()).rejects.toThrow('Incomplete');
        expect(mocks.es.clearScroll).toHaveBeenCalledWith({ scroll_id: 'cursor' });
        mocks.es.search.mockResolvedValueOnce({ _scroll_id: 'cursor', hits: { hits: [{ _id: '1' }] } });
        mocks.es.scroll.mockRejectedValue(new Error('scroll expired'));
        await expect(listIndexedIds()).rejects.toThrow('scroll expired');
        expect(mocks.es.clearScroll).toHaveBeenCalledTimes(2);
    });

    it('reports partial refresh errors instead of ACKing a failed rebuild', async () => {
        const { rebuildIndex } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.listCurrentJobIds.mockResolvedValue(['1', '2']);
        mocks.synchronizeJob.mockRejectedValueOnce(new Error('source unavailable'));
        await expect(rebuildIndex()).rejects.toThrow('source unavailable');
        expect(mocks.synchronizeJob).toHaveBeenCalledTimes(2);
        // Discovery refreshed once; a failed synchronization never reaches the final refresh.
        expect(mocks.es.indices.refresh).toHaveBeenCalledTimes(1);
    });

    it('registers bounded retry and treats event payloads only as refresh signals', async () => {
        const { startIndexer } = await import('../search-service/src/consumers/jobIndexer.js');
        const { searchRetry } = await import('../search-service/src/libs/searchRetry.js');
        await startIndexer();
        const [queue, patterns, handler, options] = mocks.consume.mock.calls[0];
        expect(queue).toBe('search-service.indexer');
        expect(patterns).toHaveLength(5);
        expect(options).toEqual({ prefetch: 20, retry: searchRetry });
        for (const name of ['job.created', 'job.updated']) await handler({ job: { id: 4, name: 'stale title' } }, name, { eventId: 'e1', aggregateId: '4' });
        for (const name of ['job.deleted', 'job.moderated']) await handler({ jobId: 4, statusCode: 'stale status' }, name);
        expect(mocks.synchronizeJob).toHaveBeenCalledTimes(4);
        expect(mocks.synchronizeJob).toHaveBeenCalledWith('4', { eventId: 'e1' });
        expect(mocks.es.update).not.toHaveBeenCalled();
        expect(mocks.es.index).not.toHaveBeenCalled();
        await expect(handler({ job: null }, 'job.updated')).rejects.toThrow('Invalid job ID');
        await expect(handler({ jobId: 4 }, 'job.deleted', { aggregateId: '5' })).rejects.toThrow('mismatch');
        await expect(handler({}, 'unknown')).resolves.toBeUndefined();
    });

    it('refreshes company jobs plus stale indexed memberships without applying old company flags', async () => {
        const { handleSearchEvent } = await import('../search-service/src/consumers/jobIndexer.js');
        mocks.listCurrentJobIds.mockResolvedValue(['1']);
        mocks.es.search.mockResolvedValue({ _scroll_id: 'cursor', hits: { hits: [{ _id: '2' }] } });
        await handleSearchEvent({ companyId: 3, companyStatusCode: 'stale' }, 'company.updated', { eventId: 'c1' });
        expect(mocks.listCurrentJobIds).toHaveBeenCalledWith('3');
        expect(mocks.es.search.mock.calls[0][0].query).toEqual({ term: { companyId: 3 } });
        expect(mocks.synchronizeJob.mock.calls).toEqual([['1', { eventId: 'c1' }], ['2', { eventId: 'c1' }]]);
        expect(mocks.es.updateByQuery).not.toHaveBeenCalled();
    });
});
