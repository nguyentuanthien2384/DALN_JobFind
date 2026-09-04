import { randomUUID } from 'node:crypto';
import { EVENTS } from '../../../shared/events.js';
import { createEventEnvelope } from '../../../shared/eventEnvelope.js';
import { taskIdentity, taskStateError } from './taskIdentity.js';

// Persistence/transport errors must escape. In particular, a failed success-result
// publish must NEVER be converted into a second, contradictory model-failure event.
export const createTaskProcessor = ({ handlers, store, publishResult, isConfigured, logger }) => {
    const active = new Map();
    const execute = async (payload, handler, identity) => {
        let record;
        if (identity.key) {
            const claim = await store.claim(identity);
            record = claim.record;
            if (!claim.acquired) {
                if (record.state === 'published') return;
                if (record.state === 'ready') {
                    if (!record.output) throw taskStateError('AI_TASK_STATE_CONFLICT', 'Saved AI result is missing');
                    await publishResult(record.output);
                    await store.markPublished(record);
                    return;
                }
                // Another replica may still be working, or it may have crashed.
                // Retain the source message in DLQ for investigation, not a new paid call.
                logger?.warn('tac vu AI chua co ket qua da luu; can doi chieu', {
                    taskKey: record._id, state: record.state, startedAt: record.startedAt
                });
                throw taskStateError('AI_TASK_UNRESOLVED', 'AI task already started without a saved result; do not automatically rerun');
            }
        } else {
            logger?.warn('tac vu kiem duyet legacy khong co ID; chua the chong trung', { jobId: payload.jobId });
        }

        logger?.info('bat dau tac vu AI', {
            type: handler.type, taskId: payload.taskId, jobId: payload.jobId, taskKey: identity.key
        });
        const base = { taskId: payload.taskId, jobId: payload.jobId, type: handler.type };
        // Echo source-controlled correlation, never a token invented by the model.
        if (handler.type === 'moderate_job' && payload.moderationRequestId !== undefined) {
            base.moderationRequestId = payload.moderationRequestId;
        }
        let data;
        if (!isConfigured()) {
            data = { ...base, ok: false, error: 'Máy chủ chưa cấu hình ANTHROPIC_API_KEY' };
        } else {
            try {
                data = { ...base, ok: true, result: await handler.run(payload) };
            } catch (error) {
                logger?.error('goi AI that bai; khong tu goi lai', { type: handler.type, taskId: payload.taskId, jobId: payload.jobId });
                data = { ...base, ok: false, error: String(error?.message || 'Lỗi xử lý AI').slice(0, 1000) };
            }
        }
        // Store exactly the JSON that will be published (no undefined fields).
        const output = createEventEnvelope({
            eventId: identity.resultEventId || randomUUID(), eventType: EVENTS.AI_RESULT,
            aggregateId: identity.aggregateId, occurredAt: new Date().toISOString(),
            producer: 'ai-worker', correlationId: record?.correlationId ?? identity.correlationId,
            data: JSON.parse(JSON.stringify(data))
        });
        if (record) await store.complete(record, output);
        await publishResult(output);
        if (record) await store.markPublished(record);
        logger?.info('da gui ket qua AI', {
            type: handler.type, taskId: payload.taskId, jobId: payload.jobId,
            taskKey: identity.key, resultEventId: output.eventId, protected: Boolean(record)
        });
    };

    return async (payload, routingKey, metadata = {}) => {
        const handler = Object.hasOwn(handlers, routingKey) ? handlers[routingKey] : null;
        if (!handler) { logger?.warn('khong co ham xu ly cho su kien nay', { routingKey }); return; }
        const identity = taskIdentity(payload, routingKey, metadata);
        const pending = identity.key && active.get(identity.key);
        if (pending) {
            if (pending.fingerprint !== identity.fingerprint) throw taskStateError('AI_TASK_ID_CONFLICT', 'AI task identity was reused with different input');
            return pending.promise;
        }
        const promise = execute(payload, handler, identity);
        if (!identity.key) return promise;
        active.set(identity.key, { fingerprint: identity.fingerprint, promise });
        try { await promise; } finally { active.delete(identity.key); }
    };
};
