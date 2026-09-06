import { readLegacyCreateAttempt, saveLegacyCreateAttempt, prepareLegacyCreateAttempt, settleLegacyCreateAttempt,
    clearSuccessfulLegacyCreate, assertLegacyCreateIdentity, assertPendingLegacyCreate, isLegacyCreateReceipt } from './legacyCreateAttempt';
const user = { id: 8, companyId: 9 }, name = 'jobfind:legacy-create:v1:8:9';
const payload = { userId: 8, name: 'Engineer', timeEnd: 1900000000000 };
beforeEach(() => {
    jest.restoreAllMocks(); sessionStorage.clear(); localStorage.clear();
    localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { value: require('crypto').webcrypto, configurable: true });
});
test('persists before dispatch, survives reread and isolates immutable payload from form mutation', () => {
    const input = { ...payload }, attempt = prepareLegacyCreateAttempt(user, input, null);
    input.name = 'Unsaved changes'; expect(attempt.key).toMatch(/^[a-f0-9]{32}$/);
    expect(readLegacyCreateAttempt(user)).toEqual(attempt);
    expect(attempt.payload).toEqual(payload); expect(() => assertPendingLegacyCreate(user, attempt)).not.toThrow();
    expect(readLegacyCreateAttempt({ id: 10, companyId: 9 })).toBeNull();
    expect(readLegacyCreateAttempt({ id: 8, companyId: 10 })).toBeNull();
});
test('never replaces an unresolved attempt even if a second form has stale empty state', () => {
    const attempt = prepareLegacyCreateAttempt(user, payload, null);
    for (const previous of [null, attempt]) expect(() => prepareLegacyCreateAttempt(user, payload, previous)).toThrow();
    expect(() => clearSuccessfulLegacyCreate(user)).toThrow(); expect(readLegacyCreateAttempt(user)).toEqual(attempt);
});
test('editing after rejection reuses the same key; a late old response cannot overwrite changed payload', () => {
    const sent = prepareLegacyCreateAttempt(user, payload, null);
    const rejected = settleLegacyCreateAttempt(user, sent, { status: 'rejected' });
    const changed = prepareLegacyCreateAttempt(user, { ...payload, name: 'Changed' }, rejected);
    expect(changed.key).toBe(sent.key); expect(changed.payload.name).toBe('Changed');
    expect(() => settleLegacyCreateAttempt(user, sent, { status: 'rejected' })).toThrow();
    expect(() => assertPendingLegacyCreate(user, sent)).toThrow();
});
test('keeps a confirmed receipt through reread/late failure; only explicit new-post action clears it and rotates the key', () => {
    const sent = prepareLegacyCreateAttempt(user, payload, null);
    const completed = settleLegacyCreateAttempt(user, sent, { status: 'succeeded', postId: 10 });
    expect(settleLegacyCreateAttempt(user, sent, { status: 'rejected' })).toEqual(completed);
    expect(readLegacyCreateAttempt(user)).toEqual(completed);
    clearSuccessfulLegacyCreate(user); expect(readLegacyCreateAttempt(user)).toBeNull();
    expect(prepareLegacyCreateAttempt(user, payload, null).key).not.toBe(sent.key);
});
test.each(['{bad', '{}', 'null', JSON.stringify({ version: 2 })])('corrupt persisted content %s blocks a fresh request without clearing evidence', raw => {
    sessionStorage.setItem(name, raw);
    expect(() => readLegacyCreateAttempt(user)).toThrow();
    expect(() => prepareLegacyCreateAttempt(user, payload, null)).toThrow();
    expect(sessionStorage.getItem(name)).toBe(raw);
});
test.each(['set-throws', 'set-ignored', 'get-throws', 'crypto-unavailable'])('fails before dispatch for %s', problem => {
    if (problem === 'set-throws') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    if (problem === 'set-ignored') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    if (problem === 'get-throws') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    if (problem === 'crypto-unavailable') Object.defineProperty(window, 'crypto', { configurable: true, value: undefined });
    expect(() => prepareLegacyCreateAttempt(user, payload, null)).toThrow();
});
test.each([{ id: 10, companyId: 9 }, { id: 8, companyId: 10 }, null, {}])('guards changed/absent identity %j before reusing payload', current => {
    const sent = prepareLegacyCreateAttempt(user, payload, null);
    localStorage.setItem('userData', JSON.stringify(current));
    expect(() => assertLegacyCreateIdentity(user)).toThrow(); expect(() => assertPendingLegacyCreate(user, sent)).toThrow();
});
test.each([{ errCode: 0 }, { errCode: 0, postId: 10, idempotencyKey: 'wrong', replayed: false },
    { errCode: 0, postId: true, idempotencyKey: 'a'.repeat(32), replayed: false }])('does not accept an ambiguous/mismatched receipt %j', res => {
    expect(isLegacyCreateReceipt(res, { key: 'a'.repeat(32) })).toBe(false);
});
test('does not permit malformed state or a different actor payload to be persisted', () => {
    const sent = prepareLegacyCreateAttempt(user, payload, null);
    expect(() => saveLegacyCreateAttempt(user, { ...sent, payload: { ...payload, userId: 999 } })).toThrow();
    expect(() => saveLegacyCreateAttempt(user, { ...sent, status: 'succeeded', postId: null })).toThrow();
});
