import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pool, withTransaction } from './db.js';
import { publishOutboxEvent } from '../../../shared/outboxPublisher.js';
import { createLogger } from '../../../shared/logger.js';
import { serializeEventPayload } from '../../../shared/eventContract.js';

const logger = createLogger('application-service.outbox');
const schema = new URL('../../migrations/001_create_outbox_events.sql', import.meta.url);

// ===== TRANSACTIONAL OUTBOX PATTERN =====
// Van de "dual write": vua ghi PostgreSQL vua publish RabbitMQ thi co the DB commit
// nhung publish loi (mat su kien) hoac publish roi ma DB rollback (su kien "ma").
// Khong co giao dich chung giua PostgreSQL va RabbitMQ.
// Cach giai: ghi su kien vao bang outbox_events TRONG CUNG giao dich voi du lieu
// nghiep vu (enqueueOutboxEvent nhan dung client cua transaction do) => ca hai cung
// commit hoac cung rollback. Relay (runOutboxOnce, moi giay) doc dong chua gui,
// publish co publisher confirm roi moi ghi published_at.
// - FOR UPDATE OF e SKIP LOCKED: nhieu replica relay chay song song khong lay trung
//   mot dong; dong dang bi khoa duoc bo qua thay vi phai cho.
// - NOT EXISTS (earlier ...): giu dung thu tu su kien cua tung ho so (aggregate).
// - Loi publish => exponential backoff 2^attempts giay (toi da 60s), ghi last_error.
// - Bao dam at-least-once: DB loi sau khi broker confirm thi su kien duoc gui lai
//   voi CUNG messageId; consumer khu trung theo eventId.

// Bootstrap cho Compose hien tai; migration SQL cung la nguon schema duy nhat.
export const ensureOutboxTable = async () => {
    await pool.query(await readFile(schema, 'utf8'));
};

// Chi dung client cua transaction dang cap nhat ho so va lich su.
export const enqueueOutboxEvent = async (client, {
    aggregateId, eventType, payload, correlationId = null, eventId = randomUUID()
}) => {
    const { json } = serializeEventPayload(eventType, payload, { aggregateId });
    await client.query(
        `INSERT INTO outbox_events (id, aggregate_id, event_type, payload, correlation_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [eventId, aggregateId, eventType, json, correlationId]
    );
    return eventId;
};

let running = false;
let timer = null;

export const runOutboxOnce = async () => {
    if (running) return 0;
    running = true;
    let published = 0;
    try {
        for (let i = 0; i < 50; i += 1) {
            const outcome = await withTransaction(async (client) => {
                // Khoa tung event den luc broker confirm. Publisher co timeout;
                // SKIP LOCKED cho phep replica khac xu ly ho so khac song song.
                // Event sau cua cung ho so phai doi event truoc, ke ca khi retry.
                const { rows } = await client.query(`
                    SELECT e.* FROM outbox_events e
                    WHERE e.published_at IS NULL AND e.next_attempt_at <= NOW()
                      AND NOT EXISTS (
                        SELECT 1 FROM outbox_events earlier
                        WHERE earlier.aggregate_id = e.aggregate_id
                          AND earlier.sequence < e.sequence
                          AND earlier.published_at IS NULL
                      )
                    ORDER BY e.sequence
                    LIMIT 1 FOR UPDATE OF e SKIP LOCKED
                `);
                if (!rows.length) return 'empty';
                const event = rows[0];

                try {
                    await publishOutboxEvent(event.event_type, event.payload, {
                        messageId: event.id,
                        aggregateId: event.aggregate_id,
                        occurredAt: event.created_at,
                        producer: 'application-service',
                        correlationId: event.correlation_id || undefined
                    });
                } catch (error) {
                    const delaySeconds = Math.min(60, 2 ** Math.min(event.attempts, 6));
                    await client.query(
                        `UPDATE outbox_events
                         SET attempts = attempts + 1, last_error = $2,
                             next_attempt_at = NOW() + ($3 * INTERVAL '1 second')
                         WHERE id = $1`,
                        [event.id, String(error.message).slice(0, 2000), delaySeconds]
                    );
                    logger.warn('outbox cho gui lai', { eventId: event.id, eventType: event.event_type });
                    return 'retry';
                }

                // Neu DB fail sau confirm, transaction rollback va event duoc
                // gui lai voi cung messageId. Consumer can dedup o buoc tiep theo.
                await client.query(
                    `UPDATE outbox_events SET published_at = NOW(),
                     attempts = attempts + 1, last_error = NULL WHERE id = $1`,
                    [event.id]
                );
                return 'published';
            });
            if (outcome === 'empty') break;
            if (outcome === 'published') published += 1;
        }
        return published;
    } finally {
        running = false;
    }
};

export const startOutboxRelay = () => {
    if (timer) return timer;
    const tick = () => runOutboxOnce().catch((error) => {
        logger.error('relay outbox gap loi', { error: error.message });
    });
    timer = setInterval(tick, 1000);
    timer.unref?.();
    void tick();
    return timer;
};

export const stopOutboxRelay = async () => {
    clearInterval(timer);
    timer = null;
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
};
