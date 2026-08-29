import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    consume: vi.fn(), publish: vi.fn(), isConfigured: vi.fn(),
    parseResume: vi.fn(), matchCv: vi.fn(), moderateJob: vi.fn(), generateCoverLetter: vi.fn()
}));

vi.mock('../shared/rabbitmq.js', () => ({ consume: mocks.consume, publish: mocks.publish }));
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
        });
    });

    it('publishes a deterministic configuration failure without invoking the model', async () => {
        mocks.isConfigured.mockReturnValue(false);
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await handleTask({ taskId: 't', jobId: 1 }, 'ai.parse_resume');
        expect(mocks.parseResume).not.toHaveBeenCalled();
        expect(mocks.publish).toHaveBeenCalledWith('ai.result', expect.objectContaining({
            taskId: 't', type: 'parse_resume', ok: false,
            error: 'Máy chủ chưa cấu hình ANTHROPIC_API_KEY'
        }));
    });

    it('turns model exceptions into failed task results instead of rethrowing', async () => {
        mocks.matchCv.mockRejectedValue(new Error('quota exceeded'));
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await expect(handleTask({ taskId: 't', jobId: 1 }, 'ai.match_cv')).resolves.toBeUndefined();
        expect(mocks.publish).toHaveBeenCalledWith('ai.result', {
            taskId: 't', jobId: 1, type: 'match_cv', ok: false, error: 'quota exceeded'
        });
    });

    it('ignores an unknown routing key', async () => {
        const { handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js');
        await expect(handleTask({}, 'unknown')).resolves.toBeUndefined();
        expect(mocks.publish).not.toHaveBeenCalled();
    });
});
