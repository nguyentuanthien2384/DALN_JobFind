import { createHash, randomUUID } from 'node:crypto';
import { pool, withTransaction } from './db.js';
import { enqueueOutboxEvent } from './outbox.js';
import { EVENTS } from '../../../shared/events.js';

// Includes base64 expansion and JSON escaping, not just the original file size.
export const MAX_AI_REQUEST_BYTES = 8 * 1024 * 1024;
const eventTypes = Object.freeze({
    parse_resume: EVENTS.AI_PARSE_RESUME,
    match_cv: EVENTS.AI_MATCH_CV,
    cover_letter: EVENTS.AI_COVER_LETTER
});

const requestError = (code, message) => Object.assign(new Error(message), { code });
const boundedJson = (value) => {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_AI_REQUEST_BYTES) {
        throw requestError('AI_REQUEST_TOO_LARGE', 'AI request exceeds 8 MiB');
    }
    return serialized;
};

export const ensureAiRequestTable = async (db = pool) => {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_request_keys (
        userId INT NOT NULL,
        requestKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        requestHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        taskId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        PRIMARY KEY (userId, requestKey),
        UNIQUE KEY uq_ai_request_task (taskId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [tables] = await db.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_request_keys'`);
    if (tables.length !== 1 || tables[0].engine !== 'InnoDB') {
        throw new Error('AI request keys require InnoDB');
    }
};

// requestData is the normalized CLIENT intent, never the current job snapshot.
// A payload factory reads that snapshot only for a newly claimed request.
export const enqueueAiTask = async ({ type, userId, input, payload, requestData, idempotencyKey }) => {
    if (!Object.hasOwn(eventTypes, type)) throw new Error('Unsupported AI task type');
    if (idempotencyKey !== undefined) {
        if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(idempotencyKey)) {
            throw requestError('AI_REQUEST_KEY_INVALID', 'Invalid Idempotency-Key');
        }
        if (!Number.isSafeInteger(userId) || userId <= 0) {
            throw requestError('AI_REQUEST_UNAUTHORIZED', 'A verified user is required');
        }
    }
    const taskId = randomUUID();
    // Bound static inputs before opening a transaction. Factories have explicit raw input.
    const initialData = typeof payload === 'function' ? null : JSON.parse(boundedJson({ ...payload, taskId }));
    if (typeof payload === 'function' && requestData === undefined) throw new Error('Missing AI client intent');
    const requestJson = boundedJson(requestData ?? payload);
    const requestHash = createHash('sha256').update(JSON.stringify({ version: 1, type, request: JSON.parse(requestJson) })).digest('hex');
    const inputJson = JSON.stringify(input);
    const now = new Date();

    return withTransaction(async (conn) => {
        if (idempotencyKey !== undefined) {
            try {
                // Reserve the key BEFORE reading mutable job data or writing any task.
                await conn.query(`INSERT INTO ai_request_keys
                    (userId, requestKey, requestHash, type, taskId, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, idempotencyKey, requestHash, type, taskId, now]);
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') throw error;
                // The duplicate insert waits for the winner's commit. These immutable
                // rows use plain reads to avoid upgrading duplicate-key shared locks.
                const [[saved]] = await conn.query(`SELECT requestHash, type, taskId FROM ai_request_keys
                    WHERE userId = ? AND requestKey = ?`, [userId, idempotencyKey]);
                if (!saved) throw error;
                if (saved.type !== type || saved.requestHash !== requestHash) {
                    throw requestError('AI_REQUEST_KEY_CONFLICT', 'Idempotency-Key was used for different input');
                }
                const [[task]] = await conn.query('SELECT id, type, userId FROM ai_tasks WHERE id = ?', [saved.taskId]);
                if (!task || task.id !== saved.taskId || task.type !== type || task.userId !== userId) {
                    throw requestError('AI_REQUEST_STATE_CONFLICT', 'Saved request needs manual reconciliation');
                }
                return saved.taskId;
            }
        }
        const data = initialData ?? JSON.parse(boundedJson({ ...await payload(conn), taskId }));
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
        return taskId;
    });
};
