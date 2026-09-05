import { createLogger } from '../../../shared/logger.js';
import { consume } from '../../../shared/rabbitmq.js';
import { publishOutboxEvent } from '../../../shared/outboxPublisher.js';
import { EVENTS, QUEUES } from '../../../shared/events.js';
import { isConfigured } from '../libs/claude.js';
import { taskStore } from '../libs/taskStore.js';
import { createTaskProcessor } from '../libs/taskProcessor.js';
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

export const publishTaskResult = (event) => publishOutboxEvent(event.eventType, event.data, {
    messageId: event.eventId, aggregateId: event.aggregateId,
    occurredAt: event.occurredAt, producer: event.producer, correlationId: event.correlationId,
    payloadVersion: event.payloadVersion ?? null // Preserve the compatibility of already-saved results.
});

export const handleTask = createTaskProcessor({
    handlers, store: taskStore, publishResult: publishTaskResult, isConfigured, logger
});

export const startTaskConsumer = async () => {
    const prefetch = Number(process.env.AI_CONCURRENCY || 2);
    if (!Number.isInteger(prefetch) || prefetch < 1 || prefetch > 100) throw new Error('AI_CONCURRENCY must be between 1 and 100');
    // No automatic handler retry yet. Saved results can be replayed without
    // calling the model; unresolved paid calls require operator investigation.
    await consume(QUEUES.AI_WORKER, Object.keys(handlers), handleTask, { prefetch });
};
