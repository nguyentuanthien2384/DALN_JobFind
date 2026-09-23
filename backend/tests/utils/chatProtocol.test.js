const { validate, error, response } = require('../../src/utils/chatProtocol');

const send = () => ({ v: 1, receiverId: 8, content: 'Xin chào', clientMessageId: 'chat-message-0001' });
const attachmentId = '8546b1f1-5e0d-4f1e-9476-0fdb6dffac11';

describe('chat:send payload', () => {
  test('accepts text, attachment-only and job-only messages', () => {
    expect(validate('chat:send', send())).toBe(true);
    expect(validate('chat:send', { ...send(), content: '', attachmentId })).toBe(true);
    expect(validate('chat:send', { ...send(), content: '', jobPostId: 12 })).toBe(true);
    expect(validate('chat:send', { ...send(), content: 'Xem tệp', attachmentId })).toBe(true);
    expect(validate('chat:send', { ...send(), content: 'Xem việc', jobPostId: 12 })).toBe(true);
  });

  test.each([undefined, null, {}, [], true, 7, 'text'])('rejects a non-object payload %p', payload => {
    expect(validate('chat:send', payload)).toBe(false);
  });

  test.each(['receiverId', 'content', 'clientMessageId'])('requires %s even when a media reference exists', field => {
    const payload = { ...send(), attachmentId };
    delete payload[field];
    expect(validate('chat:send', payload)).toBe(false);
  });

  test.each([
    ['senderId', 999], ['token', 'secret'], ['fileBase64', 'private PDF'], ['messageId', 99],
    ['isRead', true], ['traceId', 'forged']
  ])('rejects extra %s rather than accepting caller-controlled fields', (field, value) => {
    expect(validate('chat:send', { ...send(), [field]: value })).toBe(false);
  });

  test.each([1, Number.MAX_SAFE_INTEGER])('accepts receiver ID boundary %p', receiverId => {
    expect(validate('chat:send', { ...send(), receiverId })).toBe(true);
  });

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '8', true, null, {}, []])
  ('rejects an invalid receiver ID %p without coercion', receiverId => {
    expect(validate('chat:send', { ...send(), receiverId })).toBe(false);
  });

  test.each([1, Number.MAX_SAFE_INTEGER])('accepts job reference boundary %p', jobPostId => {
    expect(validate('chat:send', { ...send(), content: '', jobPostId })).toBe(true);
  });

  test.each([0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1, '12', null, true, {}, []])
  ('rejects an invalid job reference %p', jobPostId => {
    expect(validate('chat:send', { ...send(), content: '', jobPostId })).toBe(false);
  });

  test('requires actual content or one media reference and disallows mixed media references', () => {
    expect(validate('chat:send', { ...send(), content: '' })).toBe(false);
    expect(validate('chat:send', { ...send(), content: '', attachmentId, jobPostId: 12 })).toBe(false);
    expect(validate('chat:send', { ...send(), attachmentId, jobPostId: 12 })).toBe(false);
  });

  test.each([
    ['a', true], ['a'.repeat(2000), true], ['a'.repeat(2001), false],
    [0, false], [null, false], [[], false]
  ])('validates text length and type for %p', (content, expected) => {
    expect(validate('chat:send', { ...send(), content })).toBe(expected);
  });

  test.each([
    ['a'.repeat(16), true], ['a'.repeat(64), true], ['A_09-hello-chat01', true],
    ['a'.repeat(15), false], ['a'.repeat(65), false], ['has spaces 1234567', false],
    ['có-dấu-123456789', false], ['slash/path-12345', false], [1234567890123456, false], [null, false]
  ])('validates idempotency key %p', (clientMessageId, expected) => {
    expect(validate('chat:send', { ...send(), clientMessageId })).toBe(expected);
  });

  test.each([
    [attachmentId, true], [attachmentId.toUpperCase(), true],
    ['8546b1f1-5e0d-1f1e-9476-0fdb6dffac11', false],
    ['8546b1f1-5e0d-4f1e-0476-0fdb6dffac11', false],
    ['../attachment.pdf', false], ['', false], [null, false]
  ])('validates a version 4 attachment UUID %p', (value, expected) => {
    expect(validate('chat:send', { ...send(), content: '', attachmentId: value })).toBe(expected);
  });

  test.each([0, '1', 2, null, true])('rejects unsupported protocol version %p', v => {
    expect(validate('chat:send', { ...send(), v })).toBe(false);
  });

  test('keeps the optional version and input types unchanged', () => {
    const payload = { receiverId: 8, content: 'hello', clientMessageId: 'chat-message-0001' };
    expect(validate('chat:send', payload)).toBe(true);
    expect(payload).not.toHaveProperty('v');
    expect(validate('chat:send', { ...payload, receiverId: '8' })).toBe(false);
  });
});

describe('conversation event payloads', () => {
  test.each([
    ['chat:typing', { receiverId: 8 }],
    ['chat:read', { partnerId: 8 }],
    ['chat:read', { partnerId: 8, throughMessageId: 90 }],
    ['chat:presence', { partnerId: 8 }]
  ])('%s accepts its documented fields', (event, payload) => {
    expect(validate(event, payload)).toBe(true);
    expect(validate(event, { v: 1, ...payload })).toBe(true);
  });

  test.each(['chat:typing', 'chat:read', 'chat:presence'])('%s requires its participant ID', event => {
    expect(validate(event, {})).toBe(false);
    expect(validate(event, null)).toBe(false);
    expect(validate(event, [])).toBe(false);
  });

  test.each([
    ['chat:typing', 'receiverId'], ['chat:read', 'partnerId'],
    ['chat:read', 'throughMessageId'], ['chat:presence', 'partnerId']
  ])('%s rejects invalid %s without coercion', (event, field) => {
    const payload = event === 'chat:typing' ? { receiverId: 8 }
      : event === 'chat:read' ? { partnerId: 8, throughMessageId: 90 } : { partnerId: 8 };
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '8', null, true]) {
      expect(validate(event, { ...payload, [field]: invalid })).toBe(false);
    }
  });

  test.each(['chat:typing', 'chat:read', 'chat:presence'])('%s rejects unrecognized fields and versions', event => {
    const payload = event === 'chat:typing' ? { receiverId: 8 }
      : event === 'chat:read' ? { partnerId: 8 } : { partnerId: 8 };
    expect(validate(event, { ...payload, senderId: 7 })).toBe(false);
    expect(validate(event, { ...payload, v: 2 })).toBe(false);
  });
});

describe('chat:telemetry payload', () => {
  test.each(['ack', 'fallback', 'uncertain'])('accepts outcome %s and duration boundaries', outcome => {
    expect(validate('chat:telemetry', { outcome, durationMs: 0 })).toBe(true);
    expect(validate('chat:telemetry', { outcome, durationMs: 30000, v: 1 })).toBe(true);
  });

  test.each([
    {}, { outcome: 'ack' }, { durationMs: 100 }, { outcome: 'sent', durationMs: 100 },
    { outcome: 'ACK', durationMs: 100 }, { outcome: 'ack', durationMs: -1 },
    { outcome: 'ack', durationMs: 30001 }, { outcome: 'ack', durationMs: 1.5 },
    { outcome: 'ack', durationMs: '100' }, { outcome: 'ack', durationMs: 100, userId: 7 }
  ])('rejects incomplete, spoofed or out-of-range telemetry %p', payload => {
    expect(validate('chat:telemetry', payload)).toBe(false);
  });

  test('does not accept unregistered event names', () => {
    expect(validate('chat:delete', {})).toBe(false);
    expect(validate('__proto__', {})).toBe(false);
    expect(validate('constructor', {})).toBe(false);
    expect(validate('toString', {})).toBe(false);
    expect(validate(undefined, {})).toBe(false);
  });
});

describe('chat response envelope', () => {
  test('creates a failure with stable protocol fields and optional retry delay', () => {
    expect(error('RATE_LIMITED', 'Thử lại', 7, true, { retryAfterMs: 500 })).toEqual({
      v: 1, ok: false, errCode: 7, code: 'RATE_LIMITED', errMessage: 'Thử lại',
      retryable: true, retryAfterMs: 500
    });
    expect(error('PAYLOAD_INVALID', 'Sai dữ liệu')).toMatchObject({
      v: 1, ok: false, errCode: 1, retryable: false
    });
  });

  test.each([
    [0, 'OK', false, true], [1, 'PAYLOAD_INVALID', false, false],
    [2, 'CHAT_NOT_ALLOWED', false, false], [3, 'CHAT_RECEIVER_NOT_FOUND', false, false],
    [4, 'CHAT_MESSAGE_TOO_LONG', false, false], [5, 'CHAT_NOT_ALLOWED', false, false],
    [6, 'INTERNAL_ERROR', false, false], [-1, 'INTERNAL_ERROR', true, false]
  ])('maps errCode=%i to a stable acknowledgement', (errCode, code, retryable, ok) => {
    expect(response({ errCode, errMessage: 'Kết quả' }, 'trace-123')).toEqual({
      errCode, errMessage: 'Kết quả', v: 1, ok, code, retryable, traceId: 'trace-123'
    });
  });

  test('preserves explicit business codes and retryability while overriding stale envelope fields', () => {
    expect(response({ errCode: 7, code: 'RATE_LIMITED', retryable: true,
      retryAfterMs: 750, v: 9, ok: true, traceId: 'stale' }, 'fresh')).toMatchObject({
      errCode: 7, code: 'RATE_LIMITED', retryable: true, retryAfterMs: 750,
      v: 1, ok: false, traceId: 'fresh'
    });
  });

  test('generates a trace ID if the caller does not supply one', () => {
    const first = response({ errCode: 0 });
    const second = response({ errCode: 0 });
    expect(first.traceId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(second.traceId).not.toBe(first.traceId);
  });
});
