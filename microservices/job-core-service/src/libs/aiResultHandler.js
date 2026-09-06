import { withTransaction } from './db.js';
import { enqueueOutboxEvent } from './outbox.js';
import { moderationContentHash } from './moderationState.js';
import { validateAiResult, aiResultError } from './aiResultValidation.js';
import { EVENTS } from '../../../shared/events.js';
import { enqueueApprovalNotifications } from './approvalNotifications.js';

const claimResult = async (conn, payload, identity) => {
    if (!identity.eventId) return false;
    try {
        await conn.query(`INSERT INTO ai_result_inbox
            (eventId, payloadHash, resultType, aggregateId, outcome, processedAt)
            VALUES (?, ?, ?, ?, 'processing', ?)`,
        [identity.eventId, identity.payloadHash, payload.type, identity.aggregateId, new Date()]);
        return false;
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        // Duplicate INSERT already waited for the competing transaction and holds
        // a shared key lock. Entries are immutable after commit; no lock upgrade
        // is needed (many simultaneous duplicate upgrades can deadlock).
        const [[existing]] = await conn.query('SELECT payloadHash, outcome FROM ai_result_inbox WHERE eventId = ?', [identity.eventId]);
        if (!existing) throw error;
        if (existing.payloadHash !== identity.payloadHash) throw aiResultError('AI_RESULT_ID_CONFLICT', 'AI result event ID reused with different content');
        if (existing.outcome === 'processing') throw aiResultError('AI_RESULT_INCOMPLETE', 'AI result inbox contains an incomplete committed entry');
        return true;
    }
};

const applyTaskResult = async (conn, payload, identity) => {
    const [[task]] = await conn.query('SELECT id, type, status FROM ai_tasks WHERE id = ? FOR UPDATE', [payload.taskId]);
    if (!task || task.id !== payload.taskId) throw aiResultError('AI_RESULT_TASK_MISSING', 'AI result task does not exist');
    if (task.type !== payload.type) throw aiResultError('AI_RESULT_INVALID', 'AI result type does not match the stored task');
    if (['done', 'failed'].includes(task.status)) return 'already_completed';
    if (task.status !== 'pending') throw aiResultError('AI_RESULT_INVALID', 'Unknown stored AI task status');
    await conn.query(`UPDATE ai_tasks SET status = ?, result = ?, error = ?, updatedAt = ?
        WHERE id = ? AND status = 'pending'`,
    [payload.ok ? 'done' : 'failed', identity.resultJson, payload.ok ? null : payload.error, new Date(), payload.taskId]);
    return payload.ok ? 'applied' : 'failed';
};

const applyModerationResult = async (conn, payload, enqueue) => {
    // Job writers lock posts before moderation/detail (auth locks can precede
    // the post lock). These are current locking reads,
    // not a repeatable-read snapshot from before a concurrent edit committed.
    const [[post]] = await conn.query('SELECT id, detailPostId, statusCode, userId, timeEnd FROM posts WHERE id = ? FOR UPDATE', [payload.jobId]);
    if (!post) return 'stale';
    const [[request]] = await conn.query('SELECT requestId, contentHash, state FROM job_moderation_state WHERE jobId = ? FOR UPDATE', [payload.jobId]);
    if (!request || request.requestId !== payload.moderationRequestId || request.state !== 'pending') return 'stale';
    const [[detail]] = await conn.query('SELECT name, descriptionHTML FROM detailposts WHERE id = ? FOR UPDATE', [post.detailPostId]);
    const finish = (state) => conn.query(
        'UPDATE job_moderation_state SET state = ?, resolvedAt = ? WHERE jobId = ? AND requestId = ?',
        [state, new Date(), payload.jobId, payload.moderationRequestId]
    );
    if (post.statusCode !== 'PS3' || !detail || moderationContentHash(detail) !== request.contentHash) {
        await finish('superseded');
        return 'stale';
    }
    if (!payload.ok) {
        await finish('failed');
        return 'failed'; // Infrastructure failure is not a rejection of the job.
    }
    const statusCode = payload.result.approved ? 'PS1' : 'PS2';
    await conn.query("UPDATE posts SET statusCode = ?, updatedAt = ? WHERE id = ? AND statusCode = 'PS3'", [statusCode, new Date(), payload.jobId]);
    await finish('applied');
    // Status, request fence, notification intent and inbox commit together.
    await enqueue(conn, {
        aggregateType: 'job', aggregateId: payload.jobId, eventType: EVENTS.JOB_MODERATED,
        payload: {
            jobId: payload.jobId, posterId: post.userId ?? null, jobTitle: detail.name,
            approved: payload.result.approved, statusCode, reason: payload.result.reason || null,
            moderationRequestId: payload.moderationRequestId
        }
    });
    if (payload.result.approved) await enqueueApprovalNotifications(conn, post, detail, payload.moderationRequestId);
    return 'applied';
};

export const createAiResultHandler = ({ transaction = withTransaction, enqueue = enqueueOutboxEvent } = {}) => async (payload, metadata = {}) => {
    const identity = validateAiResult(payload, metadata);
    return transaction(async (conn) => {
        if (await claimResult(conn, payload, identity)) return { outcome: 'duplicate' };
        const outcome = identity.moderation
            ? await applyModerationResult(conn, payload, enqueue)
            : await applyTaskResult(conn, payload, identity);
        if (identity.eventId) await conn.query('UPDATE ai_result_inbox SET outcome = ?, processedAt = ? WHERE eventId = ?', [outcome, new Date(), identity.eventId]);
        return { outcome };
    });
};

export const handleAiResult = createAiResultHandler();
