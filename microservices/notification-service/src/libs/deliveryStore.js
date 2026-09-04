import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { mysqlPool, saveNotification, getUserEmail } from './channels.js';

const transaction = async (fn) => {
    const connection = await mysqlPool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await fn(connection);
        await connection.commit();
        return result;
    } catch (error) {
        try { await connection.rollback(); } catch { /* Preserve the original error. */ }
        throw error;
    } finally {
        connection.release();
    }
};

export const ensureDeliveryTables = async () => {
    const sql = await readFile(new URL('../../migrations/001_create_notification_delivery.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
        await mysqlPool.query(statement);
    }
    // Atomic inbox + notification writes require all participating tables to support rollback.
    const [tables] = await mysqlPool.query(
        `SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
         ('notifications', 'notification_inbox', 'notification_deliveries')`
    );
    if (tables.length !== 3 || tables.some((table) => table.engine?.toUpperCase() !== 'INNODB')) {
        throw new Error('Notification delivery requires notifications, notification_inbox and notification_deliveries to use InnoDB');
    }
};

export const queueNotification = async ({ eventId, userId, template, recipientEmail }) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(eventId || '')) throw new Error('Invalid eventId');
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('Invalid recipientId');
    return transaction(async (db) => {
        // Duplicate-key UPDATE waits for any concurrent first delivery to commit/rollback.
        await db.query(
            `INSERT INTO notification_inbox (eventId, recipientId) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE eventId = eventId`, [eventId, userId]
        );
        const [[inbox]] = await db.query(
            'SELECT notificationId FROM notification_inbox WHERE eventId = ? AND recipientId = ? FOR UPDATE',
            [eventId, userId]
        );
        if (inbox.notificationId != null) return { duplicate: true, notificationId: inbox.notificationId };

        const notification = await saveNotification({
            userId, typeCode: template.typeCode, content: template.content, link: template.link
        }, db);
        const intents = [['realtime', { userId, notification }]];
        if (template.email) {
            const to = recipientEmail || (await getUserEmail(userId, db))?.email;
            const hash = createHash('sha256').update(JSON.stringify([eventId, String(userId)])).digest('hex');
            intents.push(['email', { ...template.email, to: to || '', messageId: `<${hash}@jobfind.local>` }]);
        }
        for (const [channel, payload] of intents) {
            await db.query(
                `INSERT INTO notification_deliveries (eventId, recipientId, channel, payload)
                 VALUES (?, ?, ?, ?)`, [eventId, userId, channel, JSON.stringify(payload)]
            );
        }
        await db.query(
            'UPDATE notification_inbox SET notificationId = ? WHERE eventId = ? AND recipientId = ?',
            [notification.id, eventId, userId]
        );
        return { duplicate: false, notificationId: notification.id };
    });
};

export const claimDelivery = async () => transaction(async (db) => {
    // Never retry a stale SMTP attempt: it may already have been accepted remotely.
    await db.query(
        `UPDATE notification_deliveries
         SET status = CASE WHEN channel = 'email' THEN 'unknown' ELSE 'pending' END,
             lastError = 'worker_interrupted', lockToken = NULL, lockedAt = NULL, updatedAt = NOW(3)
         WHERE status = 'processing' AND lockedAt < DATE_SUB(NOW(3), INTERVAL 5 MINUTE)`
    );
    const [[row]] = await db.query(
        `SELECT * FROM notification_deliveries
         WHERE status = 'pending' AND nextAttemptAt <= NOW(3)
         ORDER BY nextAttemptAt, id LIMIT 1 FOR UPDATE`
    );
    if (!row) return null;
    const token = randomUUID();
    await db.query(
        `UPDATE notification_deliveries SET status = 'processing', attempts = attempts + 1,
         lockedAt = NOW(3), lockToken = ?, updatedAt = NOW(3) WHERE id = ?`, [token, row.id]
    );
    return { ...row, attempts: row.attempts + 1, lockToken: token };
});

export const finishDelivery = async (row, { status, error = null, attempted = true }) => {
    const delay = attempted ? Math.min(60, 2 ** Math.min(row.attempts, 6)) : 60;
    const [result] = await mysqlPool.query(
        `UPDATE notification_deliveries SET status = ?, lastError = ?, attempts = GREATEST(0, attempts - ?),
         nextAttemptAt = TIMESTAMPADD(SECOND, ?, NOW(3)), lockedAt = NULL, lockToken = NULL, updatedAt = NOW(3)
         WHERE id = ? AND status = 'processing' AND lockToken = ?`,
        [status, error ? String(error).slice(0, 500) : null, attempted ? 0 : 1, delay, row.id, row.lockToken]
    );
    return result.affectedRows === 1;
};
