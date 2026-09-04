import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';

const mocks = vi.hoisted(() => {
    const app = Object.fromEntries(['use', 'get', 'post', 'put', 'delete', 'listen'].map((key) => [key, vi.fn()]));
    const express = Object.assign(vi.fn(() => app), { json: vi.fn() });
    return { app, express, waitForElastic: vi.fn(), ensureIndex: vi.fn(), startIndexer: vi.fn(),
        rebuildIndex: vi.fn(), count: vi.fn(), testConnection: vi.fn(), consume: vi.fn(),
        getJobForIndex: vi.fn(), ensureAiResultTables: vi.fn(), handleAiResult: vi.fn(), timer: { unref: vi.fn() } };
});
vi.mock('express', () => ({ default: mocks.express }));
vi.mock('../search-service/src/libs/elastic.js', () => ({
    waitForElastic: mocks.waitForElastic, ensureIndex: mocks.ensureIndex,
    es: { count: mocks.count }, INDEX: 'jobs',
    liveIndexQuery: { bool: { must_not: [{ term: { searchDeleted: true } }] } }
}));
vi.mock('../search-service/src/consumers/jobIndexer.js', () => ({ startIndexer: mocks.startIndexer, rebuildIndex: mocks.rebuildIndex }));
vi.mock('../search-service/src/controllers/searchController.js', () => ({ searchJobs: vi.fn(), suggest: vi.fn(), facets: vi.fn(), related: vi.fn() }));
vi.mock('../job-core-service/src/libs/db.js', () => ({ testConnection: mocks.testConnection }));
vi.mock('../job-core-service/src/libs/outbox.js', () => ({ ensureOutboxTable: vi.fn(), startOutboxRelay: vi.fn() }));
vi.mock('../job-core-service/src/libs/moderationState.js', () => ({ ensureAiResultTables: mocks.ensureAiResultTables }));
vi.mock('../job-core-service/src/controllers/jobController.js', () => ({
    createJob: vi.fn(), updateJob: vi.fn(), deleteJob: vi.fn(), getJob: vi.fn(), listJobsForReindex: vi.fn(), getJobForIndex: mocks.getJobForIndex
}));
vi.mock('../job-core-service/src/controllers/aiController.js', () => ({
    ensureAiTaskTable: vi.fn(), parseResume: vi.fn(), matchCv: vi.fn(), coverLetter: vi.fn(), getTask: vi.fn(), handleAiResult: mocks.handleAiResult
}));
vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));

beforeEach(() => {
    vi.resetModules();
    for (const fn of Object.values(mocks.app)) fn.mockReset();
    mocks.express.mockReturnValue(mocks.app);
    for (const key of ['waitForElastic', 'ensureIndex', 'startIndexer', 'rebuildIndex', 'testConnection', 'consume']) mocks[key].mockResolvedValue(undefined);
    mocks.count.mockResolvedValue({ count: 3 });
    mocks.ensureAiResultTables.mockResolvedValue(undefined);
    mocks.handleAiResult.mockResolvedValue({ outcome: 'applied' });
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(mocks.timer);
    vi.stubEnv('INTERNAL_SECRET', 'internal-bootstrap-secret');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Search/Job Core projection wiring', () => {
    it('passes AI result metadata to the transactional handler and waits for schemas before consuming', async () => {
        await import('../job-core-service/src/app.js');
        await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
        expect(mocks.ensureAiResultTables.mock.invocationCallOrder[0]).toBeLessThan(mocks.consume.mock.invocationCallOrder[0]);
        const [queue, patterns, callback, options] = mocks.consume.mock.calls[0];
        expect(queue).toBe('job-core-service.ai-results');
        expect(patterns).toEqual(['ai.result']);
        expect(options.retry.delaysMs).toEqual([2000, 10000, 30000]);
        const metadata = { eventId: 'result-1', aggregateId: '7' };
        await callback({ jobId: 7 }, 'ai.result', metadata);
        expect(mocks.handleAiResult).toHaveBeenCalledWith({ jobId: 7 }, metadata);
        mocks.handleAiResult.mockRejectedValueOnce(new Error('transaction failed'));
        await expect(callback({}, 'ai.result', metadata)).rejects.toThrow('transaction failed');
    });

    it('does not consume results or expose writes if AI result schema checks fail', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
        mocks.ensureAiResultTables.mockRejectedValueOnce(new Error('nontransactional table'));
        await import('../job-core-service/src/app.js');
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
        expect(mocks.consume).not.toHaveBeenCalled();
        expect(mocks.app.listen).not.toHaveBeenCalled();
    });

    it('protects the internal current-job route with the trusted-service middleware', async () => {
        const { requireTrustedGateway } = await import('../shared/accessControl.js');
        await import('../job-core-service/src/app.js');
        await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
        const route = mocks.app.get.mock.calls.findIndex(([path]) => path === '/internal/jobs/:id');
        const guard = mocks.app.use.mock.calls.findIndex(([fn]) => fn === requireTrustedGateway);
        expect(route).toBeGreaterThanOrEqual(0);
        expect(guard).toBeGreaterThanOrEqual(0);
        expect(mocks.app.get.mock.calls[route][1]).toBe(mocks.getJobForIndex);
        expect(mocks.app.use.mock.invocationCallOrder[guard]).toBeLessThan(mocks.app.get.mock.invocationCallOrder[route]);
        const denied = makeRes();
        const next = vi.fn();
        requireTrustedGateway(makeReq(), denied, next);
        expect(denied.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
        requireTrustedGateway(makeReq({ headers: { 'x-internal-secret': 'internal-bootstrap-secret' } }), makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
    });

    it('serves the existing index if initial reconciliation fails and schedules another attempt', async () => {
        mocks.rebuildIndex.mockRejectedValueOnce(new Error('source offline'));
        await import('../search-service/src/app.js');
        await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
        expect(mocks.ensureIndex.mock.invocationCallOrder[0]).toBeLessThan(mocks.startIndexer.mock.invocationCallOrder[0]);
        expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 600000);
        await setInterval.mock.calls[0][0]();
        expect(mocks.rebuildIndex).toHaveBeenCalledTimes(2);
    });

    it('returns 503 for incomplete manual reconciliation, otherwise reports non-tombstone counts', async () => {
        await import('../search-service/src/app.js');
        await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
        const { requireTrustedGateway } = await import('../shared/accessControl.js');
        const route = mocks.app.post.mock.calls.find(([path]) => path === '/internal/reindex')[1];
        expect(mocks.app.use).toHaveBeenCalledWith(requireTrustedGateway);
        mocks.rebuildIndex.mockRejectedValueOnce(new Error('one ID failed'));
        const failed = makeRes();
        await route(makeReq(), failed);
        expect(failed.statusCode).toBe(503);
        expect(mocks.count).not.toHaveBeenCalled();
        mocks.rebuildIndex.mockResolvedValueOnce({ total: 5, changed: 2, deleted: 2 });
        const ok = makeRes();
        await route(makeReq(), ok);
        expect(ok.body).toEqual({ errCode: 0, indexed: 3, reconciliation: { total: 5, changed: 2, deleted: 2 } });
        const health = mocks.app.get.mock.calls.find(([path]) => path === '/health')[1];
        await health(makeReq(), makeRes());
        expect(mocks.count).toHaveBeenCalledTimes(2);
        for (const [request] of mocks.count.mock.calls) expect(request.query).toEqual({ bool: { must_not: [{ term: { searchDeleted: true } }] } });
    });

    it('does not consume if additive mapping setup fails', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
        mocks.ensureIndex.mockRejectedValueOnce(new Error('incompatible mapping'));
        await import('../search-service/src/app.js');
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
        expect(mocks.startIndexer).not.toHaveBeenCalled();
        expect(mocks.app.listen).not.toHaveBeenCalled();
    });
});
