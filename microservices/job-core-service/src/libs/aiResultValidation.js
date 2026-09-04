import { createHash } from 'node:crypto';

const taskTypes = new Set(['parse_resume', 'match_cv', 'cover_letter']);
export const aiResultError = (code, message) => Object.assign(new Error(message), { code });
const identifier = (value, name, max = 128) => {
    if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
        throw aiResultError('AI_RESULT_INVALID', `Invalid AI result ${name}`);
    }
    return value;
};
const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
};

export const validateAiResult = (payload, metadata = {}) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.ok !== 'boolean') {
        throw aiResultError('AI_RESULT_INVALID', 'AI result requires an object and boolean ok');
    }
    const moderation = payload.type === 'moderate_job';
    if (!moderation && !taskTypes.has(payload.type)) throw aiResultError('AI_RESULT_INVALID', 'Unknown AI result type');
    const aggregateId = moderation ? String(payload.jobId ?? '') : identifier(payload.taskId, 'taskId', 64);
    if (moderation) {
        if (!/^[1-9][0-9]*$/.test(aggregateId) || !Number.isSafeInteger(Number(aggregateId)) || payload.taskId != null) {
            throw aiResultError('AI_RESULT_INVALID', 'Invalid moderation target');
        }
        // Old results cannot prove which content was reviewed. Quarantine them,
        // rather than guessing from arrival time or automatically changing a job.
        if (typeof payload.moderationRequestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(payload.moderationRequestId)) {
            throw aiResultError('AI_RESULT_UNCORRELATED', 'Moderation result has no valid request token; manual investigation required');
        }
        if (payload.ok && (typeof payload.result?.approved !== 'boolean' ||
            (payload.result.reason != null && typeof payload.result.reason !== 'string'))) {
            throw aiResultError('AI_RESULT_INVALID', 'Moderation result requires a boolean approved decision');
        }
    }
    if (payload.ok && (!payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result))) {
        throw aiResultError('AI_RESULT_INVALID', 'Successful AI result requires an object');
    }
    if (!payload.ok && typeof payload.error !== 'string') throw aiResultError('AI_RESULT_INVALID', 'Failed AI result requires an error string');
    const eventId = metadata.eventId === undefined ? null : identifier(metadata.eventId, 'eventId');
    if (metadata.aggregateId !== undefined && String(metadata.aggregateId) !== aggregateId) {
        throw aiResultError('AI_RESULT_INVALID', 'AI result aggregate ID mismatch');
    }
    const resultJson = payload.ok ? JSON.stringify(payload.result) : null;
    // Reject oversize JSON; never slice it into corrupt JSON as the old handler did.
    if (Buffer.byteLength(resultJson || payload.error, 'utf8') > 1024 * 1024) {
        throw aiResultError('AI_RESULT_INVALID', 'AI result exceeds the one MiB storage limit');
    }
    return {
        moderation, aggregateId, eventId, resultJson,
        payloadHash: createHash('sha256').update(canonical(payload)).digest('hex')
    };
};
