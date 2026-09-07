import { randomUUID } from 'node:crypto';
import { EVENTS } from '../../../shared/events.js';
import { APPROVAL_NOTIFICATION_POLICY } from '../../../shared/jobNotificationPolicy.js';
import { assertEventPayload, serializeEventPayload } from '../../../shared/eventContract.js';

// Called only for an applicable successful approval, inside the decision TX.
// The original request owns policy; trusting the returned AI payload or the
// currently deployed version would fan out again for older creation backlog.
export const enqueueApprovalNotifications = async (conn, post, detail, requestId) => {
    const [[event]] = await conn.query(`SELECT payload FROM outbox_events
        WHERE id = ? AND eventType = ? AND aggregateId = ? LOCK IN SHARE MODE`,
    [requestId, EVENTS.AI_MODERATE_JOB, String(post.id)]);
    if (!event) throw new Error('AI_NOTIFICATION_REQUEST_MISSING');
    let request;
    try { request = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload; }
    catch { throw new Error('AI_NOTIFICATION_REQUEST_INVALID'); }
    assertEventPayload(EVENTS.AI_MODERATE_JOB, request, { aggregateId: post.id });
    if (request.moderationRequestId !== requestId) throw new Error('AI_NOTIFICATION_REQUEST_INVALID');
    if (request.notificationPolicy !== APPROVAL_NOTIFICATION_POLICY) return;
    const deadline = Number(post.timeEnd);
    // Same canonical millisecond deadline as manual approval and reposting;
    // coercible legacy strings (spaces/exponents/decimals) are not valid dates.
    if (!['string', 'number'].includes(typeof post.timeEnd) || !/^[1-9][0-9]*$/.test(String(post.timeEnd))
        || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > 8640000000000000) return;

    // One consistent snapshot after the post lock, not locks on user/company
    // after post (which would invert the writers' lock order). A later unfollow,
    // company change or ban never rewrites a committed historical recipient list.
    const [rows] = await conn.query(`SELECT f.userId AS recipientId, c.name AS companyName
        FROM users u JOIN companies c ON c.id = u.companyId
        JOIN followcompanies f ON f.companyId = c.id
        WHERE u.id = ? AND c.statusCode = 'S1' AND c.censorCode = 'CS1'
        ORDER BY f.userId`, [post.userId]);
    const recipients = new Map();
    for (const row of rows) {
        const id = Number(row.recipientId);
        if (Number.isSafeInteger(id) && id > 0) recipients.set(id, row.companyName);
    }
    const frozen = [...recipients].map(([recipientId, companyName]) => {
        const { json } = serializeEventPayload(EVENTS.JOB_APPROVAL_NOTIFICATION_REQUESTED, {
            decisionId: requestId, jobId: post.id, recipientId, jobTitle: detail.name ?? null, companyName: companyName ?? null
        }, { aggregateId: post.id });
        return [randomUUID(), 'job-approval-notification', String(post.id), EVENTS.JOB_APPROVAL_NOTIFICATION_REQUESTED, json, new Date()];
    });
    for (let offset = 0; offset < frozen.length; offset += 100) {
        const batch = frozen.slice(offset, offset + 100);
        await conn.query(`INSERT INTO outbox_events (id, aggregateType, aggregateId, eventType, payload, createdAt)
            VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`, batch.flat());
    }
};
