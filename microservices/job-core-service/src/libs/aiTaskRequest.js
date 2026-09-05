import { randomUUID } from 'node:crypto';
import { withTransaction } from './db.js';
import { enqueueOutboxEvent } from './outbox.js';
import { EVENTS } from '../../../shared/events.js';

// Includes base64 expansion and JSON escaping, not just the original file size.
export const MAX_AI_REQUEST_BYTES = 8 * 1024 * 1024;
const eventTypes = Object.freeze({
    parse_resume: EVENTS.AI_PARSE_RESUME,
    match_cv: EVENTS.AI_MATCH_CV,
    cover_letter: EVENTS.AI_COVER_LETTER
});

export const enqueueAiTask = async ({ type, userId, input, payload }) => {
    if (!Object.hasOwn(eventTypes, type)) throw new Error('Unsupported AI task type');
    const taskId = randomUUID();
    const serialized = JSON.stringify({ ...payload, taskId });
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AI_REQUEST_BYTES) {
        throw Object.assign(new Error('AI request exceeds 8 MiB'), { code: 'AI_REQUEST_TOO_LARGE' });
    }
    const data = JSON.parse(serialized);
    const inputJson = JSON.stringify(input);
    const now = new Date();

    await withTransaction(async (conn) => {
        // Keep only request metadata here; the outbox holds the complete worker input.
        await conn.query(
            'INSERT INTO ai_tasks (id, type, status, userId, input, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
            [taskId, type, 'pending', userId, inputJson, now, now]
        );
        await enqueueOutboxEvent(conn, {
            eventId: taskId,
            aggregateType: 'ai_task',
            aggregateId: taskId,
            eventType: eventTypes[type],
            payload: data
        });
    });
    // Return only after commit. Relay retries retain both this ID and the saved input.
    return taskId;
};
