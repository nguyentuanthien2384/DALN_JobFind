import { createHash } from 'node:crypto';
import { es, INDEX, toDocument } from './elastic.js';
import { jobIdString, loadCurrentJob } from './jobSource.js';

const missingDocument = (error) => error?.meta?.statusCode === 404 && error.meta.body?.found === false;
const versionConflict = (error) => error?.meta?.statusCode === 409 && error.meta.body?.error?.type === 'version_conflict_engine_exception';

// Read the ES generation BEFORE reading the primary source. If a concurrent
// projection wins, discard this source snapshot and fetch again, not just retry
// the old document against a new generation. Works across service replicas.
export const createJobSynchronizer = ({ client = es, index = INDEX, loadJob = loadCurrentJob } = {}) => async (jobId, { eventId } = {}) => {
    const id = jobIdString(jobId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        let current = null;
        try {
            current = await client.get({ index, id, realtime: true });
        } catch (error) {
            if (!missingDocument(error)) throw error;
        }
        if (current && (!Number.isInteger(current._seq_no) || !Number.isInteger(current._primary_term))) {
            throw new Error('Elasticsearch did not return concurrency metadata');
        }
        const job = await loadJob(id);
        if (job && jobIdString(job.id) !== id) throw new Error('Source job ID mismatch');
        const deleted = !job || job.statusCode === 'PS4';
        const projection = deleted ? { id: Number(id), searchDeleted: true } : { ...toDocument(job), searchDeleted: false };
        delete projection.indexedAt;
        const hash = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
        const unchanged = current?._source?.searchSync?.hash === hash;
        const now = new Date().toISOString();
        const document = {
            ...projection,
            indexedAt: unchanged ? current._source.indexedAt || now : now,
            searchSync: { hash, triggerEventId: eventId || null, checkedAt: now }
        };
        try {
            // Even unchanged content needs a CAS write to advance the generation:
            // otherwise a paused writer holding an older source snapshot could
            // overwrite it later (including when the source changed A -> B -> A).
            await client.index({
                index, id, document,
                ...(current ? { if_seq_no: current._seq_no, if_primary_term: current._primary_term } : { op_type: 'create' })
            });
            return { id, deleted, changed: !unchanged };
        } catch (error) {
            if (!versionConflict(error)) throw error;
        }
    }
    throw Object.assign(new Error('Search projection remained busy after five attempts'), { code: 'SEARCH_PROJECTION_CONFLICT' });
};

export const synchronizeJob = createJobSynchronizer();
