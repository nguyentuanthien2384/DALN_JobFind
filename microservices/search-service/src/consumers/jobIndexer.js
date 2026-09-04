import { es, INDEX } from '../libs/elastic.js';
import { listCurrentJobIds, jobIdString } from '../libs/jobSource.js';
import { synchronizeJob } from '../libs/jobProjection.js';
import { searchRetry } from '../libs/searchRetry.js';
import { consume } from '../../../shared/rabbitmq.js';
import { EVENTS, QUEUES } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('search-service');

const refreshIndex = async () => {
    const result = await es.indices.refresh({ index: INDEX });
    if (result?._shards?.failed) throw new Error('Incomplete Elasticsearch refresh');
};

// Scan every page, including tombstones. A stale list is only an ID discovery
// mechanism, never permission to delete or overwrite a projection.
export const listIndexedIds = async (query = { match_all: {} }) => {
    let scrollId;
    const ids = new Set();
    try {
        // GET/CAS is realtime; search/scroll is not. Include acknowledged writes
        // that have not reached the periodic ES refresh before discovering IDs.
        await refreshIndex();
        let page = await es.search({
            index: INDEX, size: 500, _source: false, sort: ['_doc'],
            scroll: '1m', allow_partial_search_results: false, query
        });
        while (true) {
            scrollId = page._scroll_id || scrollId;
            if (page.timed_out || page._shards?.failed || !Array.isArray(page.hits?.hits)) {
                throw new Error('Incomplete Elasticsearch reconciliation scan');
            }
            if (!page.hits.hits.length) break;
            if (!scrollId) throw new Error('Missing Elasticsearch scroll cursor');
            for (const hit of page.hits.hits) ids.add(jobIdString(hit._id));
            page = await es.scroll({ scroll_id: scrollId, scroll: '1m' });
        }
        return [...ids];
    } finally {
        if (scrollId) {
            try { await es.clearScroll({ scroll_id: scrollId }); }
            catch (error) { logger.warn('khong dong duoc scroll', { error: error.message }); }
        }
    }
};

const synchronizeIds = async (ids, metadata = {}) => {
    const uniqueIds = [...new Set(ids)];
    const result = { total: uniqueIds.length, changed: 0, deleted: 0 };
    let cursor = 0;
    let firstError;
    // Bound internal API load; wait for every started worker before reporting failure.
    await Promise.all(Array.from({ length: Math.min(4, uniqueIds.length) }, async () => {
        while (cursor < uniqueIds.length) {
            const id = uniqueIds[cursor++];
            try {
                const item = await synchronizeJob(id, { eventId: metadata.eventId });
                if (item.changed) result.changed += 1;
                if (item.deleted) result.deleted += 1;
            } catch (error) {
                firstError ||= error;
                logger.warn('doi chieu tin that bai', { jobId: id, error: error.message });
            }
        }
    }));
    if (firstError) throw firstError;
    return result;
};

let rebuilding = null;
export const rebuildIndex = () => {
    if (rebuilding) return rebuilding;
    const work = (async () => {
        const sourceIds = await listCurrentJobIds();
        const indexedIds = await listIndexedIds();
        const result = await synchronizeIds([...sourceIds, ...indexedIds]);
        await refreshIndex();
        logger.info('da doi chieu index', result);
        return result;
    })().finally(() => { if (rebuilding === work) rebuilding = null; });
    rebuilding = work;
    return work;
};

export const handleSearchEvent = async (payload, routingKey, metadata = {}) => {
    if (routingKey === EVENTS.COMPANY_UPDATED) {
        const companyId = jobIdString(payload?.companyId);
        const sourceIds = await listCurrentJobIds(companyId);
        const indexedIds = await listIndexedIds({ term: { companyId: Number(companyId) } });
        await synchronizeIds([...sourceIds, ...indexedIds], metadata);
        return;
    }
    const snapshotEvent = [EVENTS.JOB_CREATED, EVENTS.JOB_UPDATED].includes(routingKey);
    if (!snapshotEvent && ![EVENTS.JOB_DELETED, EVENTS.JOB_MODERATED].includes(routingKey)) return;
    const id = jobIdString(snapshotEvent ? payload?.job?.id : payload?.jobId);
    if (metadata.aggregateId !== undefined && String(metadata.aggregateId) !== id) {
        throw new Error('Search event aggregate ID mismatch');
    }
    // Event payloads identify what to refresh; their old title/status never wins
    // over the current authoritative state, even for legacy events without IDs.
    await synchronizeJob(id, { eventId: metadata.eventId });
};

export const startIndexer = async () => {
    await consume(QUEUES.SEARCH_INDEXER, [
        EVENTS.JOB_CREATED, EVENTS.JOB_UPDATED, EVENTS.JOB_DELETED,
        EVENTS.JOB_MODERATED, EVENTS.COMPANY_UPDATED
    ], handleSearchEvent, { prefetch: 20, retry: searchRetry });
};
