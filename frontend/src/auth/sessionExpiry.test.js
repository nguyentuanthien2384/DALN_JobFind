import { createSessionExpiryHandler, safeReturnPath } from './sessionExpiry';

const fixture = (path = '/candidate?tab=cv') => {
    localStorage.clear();
    localStorage.setItem('token_user', 'token-old');
    localStorage.setItem('userData', '{}');
    const location = { origin: 'http://localhost', pathname: path.split('?')[0], href: `http://localhost${path}`, assign: jest.fn() };
    const disconnect = jest.fn();
    const notify = jest.fn();
    return { expire: createSessionExpiryHandler({ storage: localStorage, location, disconnect, notify }), location, disconnect, notify };
};

test('concurrent failures end the matching session only once and close realtime', () => {
    const f = fixture();
    expect(f.expire('token-old')).toBe(true);
    expect(f.expire('token-old')).toBe(false);
    expect(localStorage.getItem('token_user')).toBeNull();
    expect(localStorage.getItem('userData')).toBeNull();
    expect(localStorage.getItem('lastUrl')).toBe('/candidate?tab=cv');
    expect(f.location.assign).toHaveBeenCalledWith('/login?reason=expired');
    expect(f.disconnect).toHaveBeenCalledTimes(1);
    expect(f.notify).toHaveBeenCalledTimes(1);
});
test('old-login and anonymous failures do not destroy a newer login', () => {
    const f = fixture();
    localStorage.setItem('token_user', 'token-new');
    expect(f.expire('token-old')).toBe(false);
    expect(f.expire(null)).toBe(false);
    expect(localStorage.getItem('token_user')).toBe('token-new');
    expect(f.disconnect).not.toHaveBeenCalled();
    expect(f.notify).not.toHaveBeenCalled();
    expect(f.location.assign).not.toHaveBeenCalled();
});
test('clears stale storage on login without a redirect loop or losing the return page', () => {
    const f = fixture('/login');
    localStorage.setItem('lastUrl', '/detail-job/7');
    f.expire('token-old');
    expect(localStorage.getItem('token_user')).toBeNull();
    expect(localStorage.getItem('lastUrl')).toBe('/detail-job/7');
    expect(f.location.assign).not.toHaveBeenCalled();
});
test('distinguishes inactive accounts and supports a later expired login', () => {
    const f = fixture();
    f.expire('token-old', 'inactive');
    expect(f.location.assign).toHaveBeenLastCalledWith('/login?reason=inactive');
    localStorage.setItem('token_user', 'another-token');
    f.expire('another-token');
    expect(f.location.assign).toHaveBeenCalledTimes(2);
});
test.each(['https://outside.invalid/path', '//outside.invalid', 'http://localhost//outside.invalid', 'javascript:alert(1)', '/login?reason=x', '/register', '/forget-password', '/\\outside.invalid', '\n/foo', null])('does not restore unsafe/login return URLs: %s', (value) => {
    expect(safeReturnPath(value, 'http://localhost')).toBeNull();
});
test.each(['/detail-job/7?x=1#cv', 'http://localhost/detail-job/7?x=1#cv'])('preserves same-origin return navigation: %s', (value) => {
    expect(safeReturnPath(value, 'http://localhost')).toBe('/detail-job/7?x=1#cv');
});
