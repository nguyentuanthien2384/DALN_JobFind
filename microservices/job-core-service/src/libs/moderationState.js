import { createHash, randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { enqueueOutboxEvent } from './outbox.js';
import { EVENTS } from '../../../shared/events.js';
import { APPROVAL_NOTIFICATION_POLICY } from '../../../shared/jobNotificationPolicy.js';

// Hash exactly the fields reviewed by moderation, not a timestamp or event order.
export const moderationContentHash = (job) => createHash('sha256')
    .update(JSON.stringify([String(job.name ?? ''), String(job.descriptionHTML ?? '')])).digest('hex');

export const ensureAiResultTables = async (db = pool) => {
    await db.query(`CREATE TABLE IF NOT EXISTS job_moderation_state (
        jobId BIGINT UNSIGNED NOT NULL PRIMARY KEY,
        requestId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        contentHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        state VARCHAR(20) NOT NULL,
        requestedAt DATETIME(3) NOT NULL,
        resolvedAt DATETIME(3) NULL,
        UNIQUE KEY uq_moderation_request (requestId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`CREATE TABLE IF NOT EXISTS ai_result_inbox (
        eventId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
        payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        resultType VARCHAR(32) NOT NULL,
        aggregateId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        outcome VARCHAR(32) NOT NULL,
        processedAt DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // Transactions cannot protect writes to a legacy non-transactional table.
    const required = ['posts', 'detailposts', 'ai_tasks', 'outbox_events', 'job_moderation_state', 'ai_result_inbox'];
    const [tables] = await db.query(`SELECT TABLE_NAME AS name, ENGINE AS engine
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${required.map(() => '?').join(',')})`, required);
    if (required.some((name) => !tables.some((table) => table.name === name && table.engine === 'InnoDB'))) {
        throw new Error('AI result handling requires all six participating tables to use InnoDB');
    }
};

// Caller must hold the post row lock (or have inserted it) in this transaction.
export const requestJobModeration = async (conn, job) => {
    const requestId = randomUUID();
    const contentHash = moderationContentHash(job);
    const now = new Date();
    await conn.query(`INSERT INTO job_moderation_state
        (jobId, requestId, contentHash, state, requestedAt, resolvedAt)
        VALUES (?, ?, ?, 'pending', ?, NULL)
        ON DUPLICATE KEY UPDATE requestId = ?, contentHash = ?, state = 'pending', requestedAt = ?, resolvedAt = NULL`,
    [job.id, requestId, contentHash, now, requestId, contentHash, now]);
    await enqueueOutboxEvent(conn, {
        eventId: requestId, aggregateType: 'job', aggregateId: job.id, eventType: EVENTS.AI_MODERATE_JOB,
        payload: { jobId: job.id, name: job.name, descriptionHTML: job.descriptionHTML, moderationRequestId: requestId,
            notificationPolicy: APPROVAL_NOTIFICATION_POLICY }
    });
    return requestId;
};

export const cancelJobModeration = (conn, jobId) => conn.query(
    "UPDATE job_moderation_state SET state = 'cancelled', resolvedAt = ? WHERE jobId = ?",
    [new Date(), jobId]
);
