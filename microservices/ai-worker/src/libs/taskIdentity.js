import { createHash } from 'node:crypto';
import { EVENTS } from '../../../shared/events.js';

const identifier = (value, name) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) {
        throw new Error(`Invalid AI ${name}`);
    }
    return value;
};

// Inputs arrive as JSON. Sorting object keys avoids false conflicts after a
// semantically identical payload is serialized with a different property order.
const canonicalJson = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};
export const fingerprint = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export const taskIdentity = (payload, routingKey, metadata = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid AI payload');
    const moderation = routingKey === EVENTS.AI_MODERATE_JOB;
    const aggregateId = moderation ? String(payload.jobId ?? '') : identifier(payload.taskId, 'taskId');
    if (moderation && (!/^[1-9][0-9]*$/.test(aggregateId) || !Number.isSafeInteger(Number(aggregateId)))) {
        throw new Error('Invalid AI jobId');
    }
    if (moderation && payload.moderationRequestId !== undefined &&
        (typeof payload.moderationRequestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(payload.moderationRequestId))) {
        throw new Error('Invalid AI moderationRequestId');
    }
    if (metadata.aggregateId !== undefined && String(metadata.aggregateId) !== aggregateId) {
        throw new Error('AI event aggregate ID mismatch');
    }
    const eventId = metadata.eventId === undefined ? null : identifier(metadata.eventId, 'eventId');
    const key = eventId ? `event:${eventId}` : moderation ? null : `task:${routingKey}:${aggregateId}`;
    const correlationId = metadata.correlationId ?? null;
    if (correlationId !== null && (typeof correlationId !== 'string' || correlationId.length > 255)) {
        throw new Error('Invalid AI correlationId');
    }
    return {
        key, eventId, routingKey, aggregateId, correlationId,
        fingerprint: fingerprint({ routingKey, payload }),
        resultEventId: key ? `ai-result:${fingerprint(key)}` : null
    };
};

export const taskStateError = (code, message) => Object.assign(new Error(message), { code });
