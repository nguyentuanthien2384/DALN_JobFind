import { randomUUID } from 'crypto';
import db from '../models/index';
import { serializeEventPayload } from './eventContract';
import { assertTransactionalLegacyOutbox } from './legacyOutbox';

const EVENT = 'notification.manual_moderation_requested';
const BATCH_SIZE = 100;

// Transitional shared-DB adapter: Job Core's existing confirmed relay owns
// delivery. Never start a second legacy relay or publish before this TX commits.
export const enqueueManualModerationNotifications = async (intent, transaction) => {
    await assertTransactionalLegacyOutbox(transaction);
    // Freeze recipients with one read inside the decision transaction. Retries
    // never reread the changing follower list. Dedup legacy duplicate follow rows.
    const followers = intent.action === 'approve' && intent.companyId
        ? await db.FollowCompany.findAll({ where: { companyId: intent.companyId }, attributes: ['userId'],
            order: [['userId', 'ASC']], raw: true, transaction }) : [];
    const recipientIds = [...new Set(followers.map(row => Number(row.userId))
        .filter(id => Number.isSafeInteger(id) && id > 0))];
    const decisionId = randomUUID();
    const base = { decisionId, jobId: intent.postId, action: intent.action,
        jobTitle: intent.jobTitle ?? null, companyName: intent.companyName ?? null };
    const recipients = [{ recipientId: intent.posterId, audience: 'author', note: intent.note },
        ...recipientIds.map(recipientId => ({ recipientId, audience: 'follower', note: null }))];
    const createdAt = new Date();
    for (let offset = 0; offset < recipients.length; offset += BATCH_SIZE) {
        const batch = recipients.slice(offset, offset + BATCH_SIZE);
        const replacements = batch.flatMap(recipient => {
            const { json, aggregateId } = serializeEventPayload(EVENT, { ...base, ...recipient });
            return [randomUUID(), 'manual-moderation-notification', aggregateId, EVENT, json, createdAt];
        });
        await db.sequelize.query(`INSERT INTO outbox_events
            (id, aggregateType, aggregateId, eventType, payload, createdAt)
            VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`, { replacements, transaction });
    }
};
