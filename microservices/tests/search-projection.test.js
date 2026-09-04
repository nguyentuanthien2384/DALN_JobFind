import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobSynchronizer } from '../search-service/src/libs/jobProjection.js';

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};
const conflict = () => Object.assign(new Error('conflict'), {
    meta: { statusCode: 409, body: { error: { type: 'version_conflict_engine_exception' } } }
});
const job = (name = 'A') => ({ id: 7, name, statusCode: 'PS1', companyId: 3, companyStatusCode: 'S1', companyCensorCode: 'CS1' });
const fixture = () => {
    let document;
    let seq = -1;
    let source = job();
    const client = {
        get: vi.fn(async () => {
            if (!document) throw { meta: { statusCode: 404, body: { found: false } } };
            return { _seq_no: seq, _primary_term: 1, _source: structuredClone(document) };
        }),
        index: vi.fn(async (request) => {
            if (request.op_type === 'create' ? !!document : request.if_seq_no !== seq || request.if_primary_term !== 1) throw conflict();
            document = structuredClone(request.document);
            seq += 1;
        })
    };
    const loadJob = vi.fn(async () => structuredClone(source));
    const sync = createJobSynchronizer({ client, index: 'test', loadJob });
    return { client, loadJob, sync, setSource: (value) => { source = value; }, doc: () => document, seq: () => seq };
};

afterEach(() => vi.useRealTimers());

describe('source reread and compare-and-set projection', () => {
    it('preserves business content/indexedAt on replay but advances its fence', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const f = fixture();
        expect(await f.sync(7, { eventId: 'same' })).toMatchObject({ changed: true, deleted: false });
        const before = f.doc();
        vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
        expect(await f.sync(7, { eventId: 'same' })).toMatchObject({ changed: false });
        expect(f.doc().indexedAt).toBe(before.indexedAt);
        expect(f.doc().searchSync.checkedAt).not.toBe(before.searchSync.checkedAt);
        expect(f.doc().searchSync.hash).toBe(before.searchSync.hash);
        expect(f.seq()).toBe(1);
        expect(f.client.index.mock.calls[0][0]).toMatchObject({ op_type: 'create' });
        expect(f.client.index.mock.calls[1][0]).toMatchObject({ if_seq_no: 0, if_primary_term: 1 });
        expect(f.client.get.mock.invocationCallOrder[0]).toBeLessThan(f.loadJob.mock.invocationCallOrder[0]);
    });

    it.each([false, true])('refetches after a paused old writer loses a race (existing=%s)', async (existing) => {
        const f = fixture();
        if (existing) await f.sync(7);
        const entered = deferred();
        const release = deferred();
        f.loadJob.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return job('old'); });
        const old = f.sync(7, { eventId: 'older' });
        await entered.promise;
        f.setSource(job('new'));
        await f.sync(7, { eventId: 'newer' });
        release.resolve();
        await old;
        expect(f.doc().name).toBe('new');
        expect(f.client.index.mock.calls.some(([r]) => r.document.name === 'old')).toBe(true);
        // Conflict retries reload the source, not just the ES sequence number.
        expect(f.loadJob).toHaveBeenCalledTimes(existing ? 4 : 3);
    });

    it.each([null, { ...job(), statusCode: 'PS4' }])('keeps a tombstone against stale writers for removed source %j', async (removed) => {
        const f = fixture();
        await f.sync(7);
        const entered = deferred();
        const release = deferred();
        f.loadJob.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return job('stale'); });
        const old = f.sync(7);
        await entered.promise;
        f.setSource(removed);
        await f.sync(7);
        release.resolve();
        await old;
        expect(f.doc()).toMatchObject({ id: 7, searchDeleted: true });
        expect(f.doc()).not.toHaveProperty('name');
        expect(f.doc()).not.toHaveProperty('companyId');
        await f.sync(7, { eventId: 'old-create-redelivered' });
        expect(f.doc().searchDeleted).toBe(true);
        f.setSource(job('explicitly restored in source'));
        await f.sync(7);
        expect(f.doc()).toMatchObject({ searchDeleted: false, name: 'explicitly restored in source' });
    });

    it('fences a paused B writer even when the source changes A -> B -> A', async () => {
        const f = fixture();
        await f.sync(7);
        const entered = deferred();
        const release = deferred();
        f.loadJob.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return job('B'); });
        const paused = f.sync(7);
        await entered.promise;
        expect(await f.sync(7)).toMatchObject({ changed: false });
        release.resolve();
        await paused;
        expect(f.doc().name).toBe('A');
        expect(f.seq()).toBe(2);
    });

    it('bounds contention retries and only retries genuine ES version conflicts', async () => {
        const f = fixture();
        f.client.index.mockRejectedValue(conflict());
        await expect(f.sync(7)).rejects.toMatchObject({ code: 'SEARCH_PROJECTION_CONFLICT' });
        expect(f.loadJob).toHaveBeenCalledTimes(5);
        expect(f.client.get).toHaveBeenCalledTimes(5);
        const otherConflict = { meta: { statusCode: 409, body: { error: { type: 'other' } } } };
        f.client.index.mockRejectedValue(otherConflict);
        await expect(f.sync(7)).rejects.toBe(otherConflict);
        expect(f.client.index).toHaveBeenCalledTimes(6);
    });

    it('does not interpret source errors, wrong IDs, or missing ES indexes as deletion', async () => {
        const f = fixture();
        f.loadJob.mockRejectedValueOnce(new Error('source unavailable'));
        await expect(f.sync(7)).rejects.toThrow('source unavailable');
        f.loadJob.mockResolvedValueOnce({ ...job(), id: 8 });
        await expect(f.sync(7)).rejects.toThrow('ID mismatch');
        f.client.get.mockRejectedValueOnce({ meta: { statusCode: 404, body: { error: { type: 'index_not_found_exception' } } } });
        await expect(f.sync(7)).rejects.toHaveProperty('meta.statusCode', 404);
        f.client.get.mockResolvedValueOnce({ _source: {} });
        await expect(f.sync(7)).rejects.toThrow('concurrency metadata');
        await expect(f.sync('7/other')).rejects.toThrow('Invalid job ID');
        expect(f.client.index).not.toHaveBeenCalled();
    });

    it('recovers after a committed ES write whose response was lost', async () => {
        const f = fixture();
        const write = f.client.index.getMockImplementation();
        f.client.index.mockImplementationOnce(async (request) => { await write(request); throw new Error('reply lost'); });
        await expect(f.sync(7)).rejects.toThrow('reply lost');
        expect(await f.sync(7)).toMatchObject({ changed: false });
        expect(f.doc().name).toBe('A');
    });
});
