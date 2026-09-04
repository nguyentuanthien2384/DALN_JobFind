import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    consume: vi.fn(), publish: vi.fn(), isConfigured: vi.fn(),
    claim: vi.fn(), complete: vi.fn(), markPublished: vi.fn(),
    parseResume: vi.fn(), matchCv: vi.fn(), moderateJob: vi.fn(), generateCoverLetter: vi.fn()
}));

vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume }));
vi.mock('../shared/outboxPublisher.js', () => ({ publishOutboxEvent: mocks.publish }));
vi.mock('../ai-worker/src/libs/taskStore.js', () => ({ taskStore: { claim: mocks.claim, complete: mocks.complete, markPublished: mocks.markPublished } }));
vi.mock('../ai-worker/src/libs/claude.js', () => ({ isConfigured: mocks.isConfigured }));
vi.mock('../ai-worker/src/jobs/resumeParser.js', () => ({ parseResume: mocks.parseResume }));
vi.mock('../ai-worker/src/jobs/smartMatching.js', () => ({ matchCv: mocks.matchCv }));
vi.mock('../ai-worker/src/jobs/moderation.js', () => ({ moderateJob: mocks.moderateJob }));
vi.mock('../ai-worker/src/jobs/coverLetter.js', () => ({ generateCoverLetter: mocks.generateCoverLetter }));

beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.consume.mockResolvedValue(undefined);
    mocks.publish.mockResolvedValue(undefined);
    mocks.isConfigured.mockReturnValue(true);
    mocks.claim.mockImplementation(async (identity) => ({ acquired: true, record: { _id: identity.key, owner: 'owner', state: 'started' } }));
    mocks.complete.mockResolvedValue(undefined);
    mocks.markPublished.mockResolvedValue(undefined);
});

describe('AI RabbitMQ task consumer', () => {
    it('registers every supported task with configured concurrency', async () => {
        vi.stubEnv('AI_CONCURRENCY', '7');
        const { startTaskConsumer, handlers, handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await startTaskConsumer();
        expect(mocks.consume).toHaveBeenCalledWith('ai-worker.jobs', Object.keys(handlers), handleTask, { prefetch: 7 });
        vi.unstubAllEnvs();
    });

    it('uses concurrency 2 by default', async () => {
        const { startTaskConsumer } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await startTaskConsumer();
        expect(mocks.consume.mock.calls[0][3]).toEqual({ prefetch: 2 });
    });

    it.each([
        ['ai.moderate_job', 'moderate_job', 'moderateJob'],
        ['ai.parse_resume', 'parse_resume', 'parseResume'],
        ['ai.match_cv', 'match_cv', 'matchCv'],
        ['ai.cover_letter', 'cover_letter', 'generateCoverLetter']
    ])('executes %s and publishes a successful result', async (routingKey, type, fnName) => {
        mocks[fnName].mockResolvedValue({ answer: type });
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        const payload = { taskId: 't1', jobId: 2, input: 'x' };
        await handleTask(payload, routingKey);
        expect(mocks[fnName]).toHaveBeenCalledWith(payload);
        expect(mocks.publish).toHaveBeenCalledWith('ai.result', {
            taskId: 't1', jobId: 2, type, ok: true, result: { answer: type }
        }, expect.objectContaining({ producer: 'ai-worker', aggregateId: routingKey === 'ai.moderate_job' ? '2' : 't1' }));
    });

    it('publishes a deterministic configuration failure without invoking the model', async () => {
        mocks.isConfigured.mockReturnValue(false);
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await handleTask({ taskId: 't', jobId: 1 }, 'ai.parse_resume');
        expect(mocks.parseResume).not.toHaveBeenCalled();
        expect(mocks.publish).toHaveBeenCalledWith('ai.result', expect.objectContaining({
            taskId: 't', type: 'parse_resume', ok: false,
            error: 'Máy chủ chưa cấu hình ANTHROPIC_API_KEY'
        }), expect.objectContaining({ producer: 'ai-worker', aggregateId: 't' }));
    });

    it('turns model exceptions into failed task results instead of rethrowing', async () => {
        mocks.matchCv.mockRejectedValue(new Error('quota exceeded'));
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await expect(handleTask({ taskId: 't', jobId: 1 }, 'ai.match_cv')).resolves.toBeUndefined();
        expect(mocks.publish).toHaveBeenCalledWith('ai.result', {
            taskId: 't', jobId: 1, type: 'match_cv', ok: false, error: 'quota exceeded'
        }, expect.objectContaining({ producer: 'ai-worker', aggregateId: 't' }));
    });

    it('ignores an unknown routing key', async () => {
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await expect(handleTask({}, 'unknown')).resolves.toBeUndefined();
        expect(mocks.publish).not.toHaveBeenCalled();
    });

    it('lets confirmed publish failures escape without emitting a contradictory failed result', async () => {
        mocks.matchCv.mockResolvedValue({ score: 90 });
        mocks.publish.mockRejectedValue(new Error('confirm lost'));
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await expect(handleTask({ taskId: 'publish-fails' }, 'ai.match_cv', { eventId: 'event-1' })).rejects.toThrow('confirm lost');
        expect(mocks.complete).toHaveBeenCalledOnce();
        expect(mocks.markPublished).not.toHaveBeenCalled();
        expect(mocks.publish).toHaveBeenCalledOnce();
        expect(mocks.publish.mock.calls[0][1].ok).toBe(true);
        expect(mocks.publish.mock.calls[0][2].messageId).toMatch(/^ai-result:/);
    });

    it.each(['0', '-1', 'NaN', '1.5', '101'])('rejects unsafe/unbounded concurrency %s', async (value) => {
        vi.stubEnv('AI_CONCURRENCY', value);
        try {
            const { startTaskConsumer } = await import('../ai-worker/src/consumers/taskConsumer.js');
            await expect(startTaskConsumer()).rejects.toThrow('AI_CONCURRENCY');
            expect(mocks.consume).not.toHaveBeenCalled();
        } finally { vi.unstubAllEnvs(); }
    });
});
