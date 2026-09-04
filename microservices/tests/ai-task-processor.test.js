import { describe, expect, it, vi } from 'vitest';
import { createTaskProcessor } from '../ai-worker/src/libs/taskProcessor.js';

const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};
const fixture = () => {
    let record;
    const store = {
        claim: vi.fn(async (identity) => {
            if (record) {
                if (record.fingerprint !== identity.fingerprint) throw new Error('identity conflict');
                return { acquired: false, record: structuredClone(record) };
            }
            record = { ...identity, _id: identity.key, owner: 'owner', state: 'started' };
            return { acquired: true, record: structuredClone(record) };
        }),
        complete: vi.fn(async (_record, output) => { record.state = 'ready'; record.output = structuredClone(output); }),
        markPublished: vi.fn(async () => { record.state = 'published'; delete record.output; })
    };
    const run = vi.fn().mockResolvedValue({ score: 90 });
    const publishResult = vi.fn().mockResolvedValue(undefined);
    const isConfigured = vi.fn().mockReturnValue(true);
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const options = { handlers: { 'ai.match_cv': { type: 'match_cv', run }, 'ai.moderate_job': { type: 'moderate_job', run } }, store, publishResult, isConfigured, logger };
    return { ...options, run, create: () => createTaskProcessor(options), record: () => record };
};
const payload = { taskId: 'task-1', resumeText: 'private CV' };
const metadata = { eventId: 'event-1' };

describe('durable AI task processing', () => {
    it.each([true, false])('echoes the source moderation token on success/failure (ok=%s), not a model-supplied token', async (ok) => {
        const f = fixture();
        if (ok) f.run.mockResolvedValue({ approved: true, moderationRequestId: 'model-invented' });
        else f.run.mockRejectedValue(new Error('timeout'));
        const requestId = '11111111-1111-4111-8111-111111111111';
        await f.create()({ jobId: 7, moderationRequestId: requestId }, 'ai.moderate_job', metadata);
        expect(f.publishResult.mock.lastCall[0].data).toMatchObject({ ok, moderationRequestId: requestId });
        expect(f.store.complete.mock.calls[0][1].data.moderationRequestId).toBe(requestId);
    });
    it('claims before the model, saves before publish, marks only after confirmation and skips settled duplicates', async () => {
        const f = fixture();
        await f.create()(payload, 'ai.match_cv', metadata);
        await f.create()(payload, 'ai.match_cv', metadata);
        expect(f.run).toHaveBeenCalledOnce();
        expect(f.publishResult).toHaveBeenCalledOnce();
        expect(f.store.claim.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]);
        expect(f.store.complete.mock.invocationCallOrder[0]).toBeLessThan(f.publishResult.mock.invocationCallOrder[0]);
        expect(f.publishResult.mock.invocationCallOrder[0]).toBeLessThan(f.store.markPublished.mock.invocationCallOrder[0]);
        expect(f.record().state).toBe('published');
        expect(f.record()).not.toHaveProperty('output');
    });
    it('coalesces same-process concurrent duplicates but rejects a changed payload', async () => {
        const f = fixture();
        const gate = deferred();
        f.run.mockReturnValue(gate.promise);
        const processor = f.create();
        const calls = Array.from({ length: 20 }, () => processor(payload, 'ai.match_cv', metadata));
        await expect(processor({ ...payload, resumeText: 'changed' }, 'ai.match_cv', metadata)).rejects.toHaveProperty('code', 'AI_TASK_ID_CONFLICT');
        gate.resolve({ score: 80 });
        await Promise.all(calls);
        expect(f.run).toHaveBeenCalledOnce();
        expect(f.publishResult).toHaveBeenCalledOnce();
    });
    it('does not steal another replica or crashed worker\'s unresolved paid-call claim', async () => {
        const f = fixture();
        const entered = deferred();
        const release = deferred();
        f.run.mockImplementation(async () => { entered.resolve(); return release.promise; });
        const first = f.create()(payload, 'ai.match_cv', metadata);
        await entered.promise;
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toHaveProperty('code', 'AI_TASK_UNRESOLVED');
        release.resolve({ score: 70 });
        await first;
        expect(f.run).toHaveBeenCalledOnce();
    });
    it('recovers a saved success after publish failure with the identical envelope and no new AI call', async () => {
        const f = fixture();
        f.publishResult.mockRejectedValueOnce(new Error('confirm lost'));
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toThrow('confirm lost');
        const saved = structuredClone(f.record().output);
        expect(saved.data.ok).toBe(true);
        expect(f.store.markPublished).not.toHaveBeenCalled();
        await f.create()(payload, 'ai.match_cv', metadata);
        expect(f.publishResult.mock.lastCall[0]).toEqual(saved);
        expect(f.run).toHaveBeenCalledOnce();
        expect(f.store.complete).toHaveBeenCalledOnce();
    });
    it('never calls the model if the claim write fails or its acknowledgement is lost', async () => {
        const f = fixture();
        f.store.claim.mockRejectedValue(new Error('db unavailable'));
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toThrow('db unavailable');
        expect(f.run).not.toHaveBeenCalled();
        expect(f.publishResult).not.toHaveBeenCalled();
    });
    it('leaves result-save failures unresolved instead of rerunning or publishing a fake failure', async () => {
        const f = fixture();
        f.store.complete.mockRejectedValue(new Error('save failed'));
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toThrow('save failed');
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toHaveProperty('code', 'AI_TASK_UNRESOLVED');
        expect(f.run).toHaveBeenCalledOnce();
        expect(f.publishResult).not.toHaveBeenCalled();
    });
    it('recovers after a confirmed publish but failed completion marker without charging again', async () => {
        const f = fixture();
        f.store.markPublished.mockRejectedValueOnce(new Error('marker failed'));
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toThrow('marker failed');
        await f.create()(payload, 'ai.match_cv', metadata);
        expect(f.run).toHaveBeenCalledOnce();
        expect(f.publishResult.mock.calls[0][0]).toEqual(f.publishResult.mock.calls[1][0]);
    });
    it.each(['configuration', 'model'])('stores and replays %s failure without an automatic model retry', async (kind) => {
        const f = fixture();
        if (kind === 'configuration') f.isConfigured.mockReturnValue(false);
        else f.run.mockRejectedValue(new Error('provider timeout'));
        f.publishResult.mockRejectedValueOnce(new Error('broker offline'));
        await expect(f.create()(payload, 'ai.match_cv', metadata)).rejects.toThrow('broker offline');
        expect(f.record().output.data.ok).toBe(false);
        await f.create()(payload, 'ai.match_cv', metadata);
        expect(f.run).toHaveBeenCalledTimes(kind === 'configuration' ? 0 : 1);
    });
    it('keeps legacy moderation compatible without inventing job-ID deduplication', async () => {
        const f = fixture();
        const processor = f.create();
        await processor({ jobId: 7 }, 'ai.moderate_job');
        await processor({ jobId: 7 }, 'ai.moderate_job');
        expect(f.run).toHaveBeenCalledTimes(2);
        expect(f.store.claim).not.toHaveBeenCalled();
        expect(f.publishResult.mock.calls[0][0].eventId).not.toBe(f.publishResult.mock.calls[1][0].eventId);
        expect(f.logger.warn).toHaveBeenCalledTimes(2);
    });
    it('ignores unknown/prototype routing keys and rejects malformed payloads before claiming', async () => {
        const f = fixture();
        await f.create()({}, 'toString');
        await expect(f.create()(null, 'ai.match_cv')).rejects.toThrow('payload');
        expect(f.store.claim).not.toHaveBeenCalled();
        expect(f.run).not.toHaveBeenCalled();
    });
});
