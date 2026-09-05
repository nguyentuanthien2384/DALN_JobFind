import { normalizeApiError, readRetryAfter, sentSessionToken } from './apiError';

test.each([
    [401, {}, 'authentication'], [403, { refresh: true }, 'authentication'], [404, { refresh: true }, 'authentication'],
    [403, { refresh: false }, 'forbidden'], [403, {}, 'forbidden'], [404, {}, 'not_found'],
    [400, {}, 'validation'], [413, {}, 'validation'], [415, {}, 'validation'],
    [409, {}, 'conflict'], [429, {}, 'rate_limit'], [503, { refresh: true }, 'unavailable'], [502, {}, 'unavailable']
])('classifies HTTP %s without conflating role, session and infrastructure failures', (status, data, errorType) => {
    expect(normalizeApiError({ response: { status, data } })).toMatchObject({ httpStatus: status, errorType });
});
test.each([['ERR_CANCELED', 'cancelled'], ['ECONNABORTED', 'timeout'], ['ETIMEDOUT', 'timeout'], ['ECONNRESET', 'network']])('normalizes %s without exposing request data', (code, errorType) => {
    const result = normalizeApiError({ code, config: { headers: { authorization: 'private-token' }, data: 'private-CV' }, message: 'private-CV' });
    expect(result).toMatchObject({ errCode: -1, httpStatus: 0, errorType });
    expect(JSON.stringify(result)).not.toContain('private');
});
test.each([0, '0', null, {}, []])('never treats a non-2xx response as business success: %j', (errCode) => {
    expect(normalizeApiError({ response: { status: 500, data: { errCode } } }).errCode).toBe(-1);
});
test('exposes only selected safe metadata and never raw proxy HTML', () => {
    const result = normalizeApiError({ response: { status: 429, headers: { 'retry-after': '30', 'x-correlation-id': 'req-1', 'set-cookie': 'private' }, data: '<html>private</html>' } });
    expect(result).toMatchObject({ retryAfterSeconds: 30, requestId: 'req-1', errorType: 'rate_limit' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(normalizeApiError({ response: { status: 503, headers: { 'x-correlation-id': 'private text' } } })).not.toHaveProperty('requestId');
});
test('understands bounded Retry-After seconds or HTTP dates', () => {
    expect(readRetryAfter('30')).toBe(30);
    expect(readRetryAfter('999999')).toBe(86400);
    expect(readRetryAfter('Sat, 05 Sep 2026 00:01:00 GMT', Date.parse('2026-09-05T00:00:00Z'))).toBe(60);
    for (const value of [undefined, {}, '', 'invalid', '-5']) expect(readRetryAfter(value)).toBeUndefined();
});
test('reads the actual outgoing token from AxiosHeaders without returning other credentials', () => {
    expect(sentSessionToken({ headers: { get: () => 'Bearer sent-token' } })).toBe('sent-token');
    expect(sentSessionToken({ headers: { authorization: 'Basic something' } })).toBeNull();
});
