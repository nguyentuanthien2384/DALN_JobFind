import crypto from 'node:crypto';
import { pool, withTransaction } from './db.js';
import { publishOutboxEvent } from '../../../shared/outboxPublisher.js';
import { createLogger } from '../../../shared/logger.js';
import { serializeEventPayload } from '../../../shared/eventContract.js';

const logger = createLogger('job-core-service.outbox');
// Moi publish cho toi da 10s connect + 10s confirm; 10 event van nam trong lease 5 phut.
const MAX_BATCH_SIZE = 10;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Outbox nay nam trong cung MySQL voi Job Core. Muc tieu cua no la de viec ghi
// du lieu nghiep vu va viec ghi "can phat su kien" cung thanh cong hoac cung
// rollback. Relay ben duoi se phat RabbitMQ sau khi transaction da commit.
export const ensureOutboxTable = async (db = pool) => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS outbox_events (
            id             CHAR(36) NOT NULL,
            aggregateType  VARCHAR(64) NOT NULL,
            aggregateId    VARCHAR(128) NOT NULL,
            eventType      VARCHAR(128) NOT NULL,
            payload        LONGTEXT NOT NULL,
            attempts       INT UNSIGNED NOT NULL DEFAULT 0,
            lastError      TEXT NULL,
            nextAttemptAt  DATETIME(3) NULL,
            lockedAt       DATETIME(3) NULL,
            lockToken      CHAR(36) NULL,
            createdAt      DATETIME(3) NOT NULL,
            publishedAt    DATETIME(3) NULL,
            PRIMARY KEY (id),
            INDEX idx_outbox_pending (publishedAt, nextAttemptAt, createdAt),
            INDEX idx_outbox_lock (lockedAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    logger.info('bang outbox_events da san sang');
};

// Ham nay phai duoc goi bang cung connection dang ghi aggregate. Khong dung
// pool rieng o day, neu khong outbox se lai tro thanh mot dual-write problem.
export const enqueueOutboxEvent = async (
    conn,
    { aggregateType, aggregateId, eventType, payload, eventId = crypto.randomUUID() }
) => {
    const { json } = serializeEventPayload(eventType, payload, { aggregateId });
    await conn.query(
        `INSERT INTO outbox_events
         (id, aggregateType, aggregateId, eventType, payload, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            eventId,
            aggregateType,
            String(aggregateId),
            eventType,
            json,
            new Date()
        ]
    );
    return eventId;
};

const claimPendingEvents = async (limit = MAX_BATCH_SIZE) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), MAX_BATCH_SIZE);
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS);

    return withTransaction(async (conn) => {
        const [rows] = await conn.query(
            `SELECT id, eventType, payload, attempts, aggregateId, createdAt
             FROM outbox_events
             WHERE publishedAt IS NULL
               AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
               AND (lockedAt IS NULL OR lockedAt <= ?)
             ORDER BY createdAt ASC, id ASC
             LIMIT ${safeLimit}
             FOR UPDATE`,
            [now, staleBefore]
        );

        if (!rows.length) return [];

        const lockToken = crypto.randomUUID();
        const placeholders = rows.map(() => '?').join(', ');
        await conn.query(
            `UPDATE outbox_events
             SET lockedAt = ?, lockToken = ?, attempts = attempts + 1
             WHERE id IN (${placeholders})`,
            [now, lockToken, ...rows.map((row) => row.id)]
        );

        return rows.map((row) => ({
            ...row,
            lockToken,
            attempts: (Number(row.attempts) || 0) + 1
        }));
    });
};

const markPublished = async (event) => {
    await pool.query(
        `UPDATE outbox_events
         SET publishedAt = ?, lockedAt = NULL, lockToken = NULL, lastError = NULL
         WHERE id = ? AND lockToken = ? AND publishedAt IS NULL`,
        [new Date(), event.id, event.lockToken]
    );
};

const releaseForRetry = async (event, error) => {
    const delayMs = Math.min(60_000, 1000 * (2 ** Math.min(event.attempts - 1, 5)));
    await pool.query(
        `UPDATE outbox_events
         SET nextAttemptAt = ?, lastError = ?, lockedAt = NULL, lockToken = NULL
         WHERE id = ? AND lockToken = ? AND publishedAt IS NULL`,
        [
            new Date(Date.now() + delayMs),
            String(error?.message || error || 'unknown').slice(0, 2000),
            event.id,
            event.lockToken
        ]
    );
};

let relayRunning = false;
let relayTimer = null;

// Broker confirm truoc khi danh dau da gui. Neu DB fail sau confirm, event
// duoc gui lai voi cung messageId; Notification da dedup, consumer khac can tu bao ve.
export const runOutboxOnce = async () => {
    if (relayRunning) return 0;
    relayRunning = true;

    try {
        const events = await claimPendingEvents();
        let published = 0;

        for (const event of events) {
            try {
                const payload = typeof event.payload === 'string'
                    ? JSON.parse(event.payload)
                    : event.payload;
                await publishOutboxEvent(event.eventType, payload, {
                    messageId: event.id,
                    aggregateId: event.aggregateId,
                    occurredAt: event.createdAt,
                    // During the shared-DB transition the legacy writer stores
                    // only this recipient-intent type in our confirmed outbox.
                    producer: event.eventType === 'notification.manual_moderation_requested'
                        ? 'legacy-backend' : 'job-core-service'
                });
                await markPublished(event);
                published += 1;
            } catch (error) {
                logger.error('phat su kien outbox that bai', {
                    eventId: event.id,
                    eventType: event.eventType,
                    error: error.message
                });
                try {
                    await releaseForRetry(event, error);
                } catch (releaseError) {
                    logger.error('khong cap nhat duoc outbox de retry', {
                        eventId: event.id,
                        error: releaseError.message
                    });
                }
            }
        }

        return published;
    } finally {
        relayRunning = false;
    }
};

export const startOutboxRelay = ({ intervalMs = 1000 } = {}) => {
    if (relayTimer) return relayTimer;

    const tick = () => {
        runOutboxOnce().catch((error) => {
            logger.error('relay outbox gap loi', { error: error.message });
        });
    };

    tick();
    relayTimer = setInterval(tick, intervalMs);
    relayTimer.unref?.();
    return relayTimer;
};

export const stopOutboxRelay = async () => {
    clearInterval(relayTimer);
    relayTimer = null;
    while (relayRunning) await new Promise((resolve) => setTimeout(resolve, 20));
};
