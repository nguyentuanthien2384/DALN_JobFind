import { createLogger } from '../../../shared/logger.js';
import { consume, publish } from '../../../shared/rabbitmq.js';
import { EVENTS, QUEUES } from '../../../shared/events.js';
import { isConfigured } from '../libs/claude.js';
import { parseResume } from '../jobs/resumeParser.js';
import { matchCv } from '../jobs/smartMatching.js';
import { moderateJob } from '../jobs/moderation.js';
import { generateCoverLetter } from '../jobs/coverLetter.js';

const logger = createLogger('ai-worker');

export const handlers = {
    [EVENTS.AI_MODERATE_JOB]: { type: 'moderate_job', run: (payload) => moderateJob(payload) },
    [EVENTS.AI_PARSE_RESUME]: { type: 'parse_resume', run: (payload) => parseResume(payload) },
    [EVENTS.AI_MATCH_CV]: { type: 'match_cv', run: (payload) => matchCv(payload) },
    [EVENTS.AI_COVER_LETTER]: { type: 'cover_letter', run: (payload) => generateCoverLetter(payload) }
};

export const handleTask = async (payload, routingKey) => {
    const handler = handlers[routingKey];
    if (!handler) {
        logger.warn('khong co ham xu ly cho su kien nay', { routingKey });
        return;
    }

    const started = Date.now();
    logger.info('nhan viec', {
        type: handler.type,
        taskId: payload.taskId,
        jobId: payload.jobId
    });

    if (!isConfigured()) {
        await publish(EVENTS.AI_RESULT, {
            taskId: payload.taskId,
            jobId: payload.jobId,
            type: handler.type,
            ok: false,
            error: 'Máy chủ chưa cấu hình ANTHROPIC_API_KEY'
        });
        return;
    }

    try {
        const result = await handler.run(payload);
        await publish(EVENTS.AI_RESULT, {
            taskId: payload.taskId,
            jobId: payload.jobId,
            type: handler.type,
            ok: true,
            result
        });
        logger.info('xong', {
            type: handler.type,
            taskId: payload.taskId,
            jobId: payload.jobId,
            durationMs: Date.now() - started
        });
    } catch (error) {
        // Bao that bai ve cho ben yeu cau thay vi nem loi ra de tin bi nack va
        // nguoi dung cho mai khong co ket qua.
        logger.error('xu ly that bai', {
            type: handler.type,
            taskId: payload.taskId,
            error: error.message
        });
        await publish(EVENTS.AI_RESULT, {
            taskId: payload.taskId,
            jobId: payload.jobId,
            type: handler.type,
            ok: false,
            error: error.message
        });
    }
};

export const startTaskConsumer = async () => {
    await consume(
        QUEUES.AI_WORKER,
        Object.keys(handlers),
        handleTask,
        { prefetch: Number(process.env.AI_CONCURRENCY || 2) }
    );
};
