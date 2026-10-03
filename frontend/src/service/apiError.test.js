import { isLoginRequest, normalizeApiError, readRetryAfter, sentSessionToken } from './apiError';

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

test.each([
    ['/api/login', undefined], ['/api/auth/login', undefined], ['/api/login/', undefined], ['/API/Auth/Login', undefined],
    ['/api/login?next=%2Fjob', 'http://localhost:4000'], ['http://gateway.local/api/auth/login', undefined], ['/api/login', 'http://localhost:4000/'],
])('recognises the login request %s (base %s) so a wrong password never triggers a token refresh', (url, baseURL) => {
    expect(isLoginRequest({ url, baseURL })).toBe(true);
});
test.each([
    ['/api/login-history'], ['/api/loginx'], ['/api/auth/login/extra'], ['/api/auth/refresh'], ['/login'], [''], [undefined],
])('does not treat %p as a login request', (url) => {
    expect(isLoginRequest({ url })).toBe(false);
});
test('treats an unparsable request URL as not a login request instead of throwing', () => {
    expect(isLoginRequest({ url: '/api/login', baseURL: 'not a base url' })).toBe(false);
    expect(isLoginRequest(undefined)).toBe(false);
});
test.each([
    [408, 'timeout'], [422, 'validation'], [500, 'unavailable'], [504, 'unavailable'], [499, 'unknown'], [418, 'unknown'], [302, 'unknown'],
])('maps HTTP %i at the classification boundaries to %s', (status, errorType) => {
    expect(normalizeApiError({ response: { status, data: {} } }).errorType).toBe(errorType);
});
test('uses the server message first, then message, then a type fallback, then the status', () => {
    expect(normalizeApiError({ response: { status: 400, data: { errMessage: 'Sai ngày', message: 'other' } } }).errMessage).toBe('Sai ngày');
    expect(normalizeApiError({ response: { status: 400, data: { errMessage: '   ', message: 'Từ message' } } }).errMessage).toBe('Từ message');
    expect(normalizeApiError({ response: { status: 403, data: { errMessage: '' } } }).errMessage).toBe('Bạn không có quyền thực hiện thao tác này.');
    expect(normalizeApiError({ response: { status: 418, data: {} } }).errMessage).toBe('Lỗi máy chủ (418)');
    expect(normalizeApiError({ response: { status: 400, data: { errMessage: 'x'.repeat(2500) } } }).errMessage).toHaveLength(2000);
});
test.each([[2, 2], ['E_QUOTA', 'E_QUOTA'], [Number.NaN, -1], ['  ', -1], [true, -1]])('keeps a meaningful business errCode %p', (errCode, expected) => {
    expect(normalizeApiError({ response: { status: 409, data: { errCode } } }).errCode).toBe(expected);
});
test('reads Retry-After at its edges', () => {
    const now = Date.parse('2026-09-05T00:00:00Z');
    expect(readRetryAfter('0')).toBe(0);
    expect(readRetryAfter(45)).toBe(45);
    expect(readRetryAfter(' 12 ')).toBe(12);
    expect(readRetryAfter('86400')).toBe(86400);
    expect(readRetryAfter('Sat, 05 Sep 2026 00:00:00 GMT', now)).toBe(0);
    expect(readRetryAfter('Fri, 04 Sep 2026 23:59:59 GMT', now)).toBeUndefined();
    expect(readRetryAfter('Sat, 05 Sep 2026 00:00:01 GMT', now)).toBe(1);
    expect(normalizeApiError({ response: { status: 429, headers: { get: (name) => (name === 'retry-after' ? '7' : null) }, data: {} } }).retryAfterSeconds).toBe(7);
    expect(normalizeApiError({ response: { status: 429, headers: {}, data: {} } })).not.toHaveProperty('retryAfterSeconds');
});
