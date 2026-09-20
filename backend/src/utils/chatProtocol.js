const Ajv = require('ajv');
const { randomUUID } = require('crypto');
const ajv = new Ajv({ allErrors: false, coerceTypes: false });
const id = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const clientId = { type: 'string', minLength: 16, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const schemas = {
    'chat:send': { receiverId: id, content: { type: 'string', maxLength: 2000 }, clientMessageId: clientId,
        attachmentId: { type: 'string', pattern: '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' }, jobPostId: id },
    'chat:typing': { receiverId: id },
    'chat:read': { partnerId: id, throughMessageId: id },
    'chat:telemetry': { outcome: {enum:['ack','fallback','uncertain']}, durationMs:{type:'integer',minimum:0,maximum:30000} },
    'chat:presence': { partnerId: id },
};
const validators = Object.fromEntries(Object.entries(schemas).map(([event, properties]) => [event, ajv.compile({
    type: 'object', additionalProperties: false,
    required: event === 'chat:telemetry' ? ['outcome','durationMs'] : event === 'chat:send' ? ['receiverId', 'content', 'clientMessageId'] : [Object.keys(properties)[0]],
    properties: { ...properties, v: { const: 1 } },
    ...(event === 'chat:send' ? { allOf: [
        { anyOf: [{ properties: { content: { type: 'string', minLength: 1 } } }, { required: ['attachmentId'] }, { required: ['jobPostId'] }] },
        { not: { required: ['attachmentId', 'jobPostId'] } },
    ] } : {}),
})]));
const error = (code, errMessage, errCode = 1, retryable = false, extra = {}) => ({
    v: 1, ok: false, errCode, code, errMessage, retryable, ...extra,
});
const validate = (event, payload) => validators[event]?.(payload) === true;
const response = (result, traceId = randomUUID()) => ({
    ...result, v: 1, ok: result.errCode === 0,
    code: result.code || (result.errCode === 0 ? 'OK' : ({ 1: 'PAYLOAD_INVALID', 2: 'CHAT_NOT_ALLOWED',
        3: 'CHAT_RECEIVER_NOT_FOUND', 4: 'CHAT_MESSAGE_TOO_LONG', 5: 'CHAT_NOT_ALLOWED' }[result.errCode] || 'INTERNAL_ERROR')),
    retryable: result.retryable ?? result.errCode === -1, traceId,
});
module.exports = { validate, error, response };
