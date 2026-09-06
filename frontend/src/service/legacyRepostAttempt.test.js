import { readLegacyRepostAttempt, prepareLegacyRepostAttempt, assertPendingLegacyRepost,
    settleLegacyRepostAttempt, isLegacyRepostReceipt } from './legacyRepostAttempt';
import { prepareLegacyCreateAttempt, readLegacyCreateAttempt } from './legacyCreateAttempt';
const user = { id: 8, companyId: 9 }, sourceId = 55, slot = 'jobfind:legacy-repost:v1:8:9:55';
const payload = { userId: 8, postId: '55', timeEnd: 1924992000000, expectedRevision: 'jv1-' + 'a'.repeat(64) };
beforeEach(() => {
    jest.restoreAllMocks(); sessionStorage.clear(); localStorage.clear();
    localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
});
const prepare = (body = payload, previous = null) => prepareLegacyRepostAttempt(user, sourceId, body, previous);
test('preserves key/source/revision/deadline across reread and isolates the payload from later mutation', () => {
    const body = { ...payload }, sent = prepare(body); body.timeEnd += 999; body.expectedRevision = 'changed';
    expect(sent.key).toMatch(/^[a-f0-9]{32}$/); expect(sent.payload).toEqual(payload);
    expect(readLegacyRepostAttempt(user, sourceId)).toEqual(sent); expect(() => assertPendingLegacyRepost(user, sourceId, sent)).not.toThrow();
});
test('isolates source, user, company and create operation; never overwrites an existing unresolved attempt', () => {
    const sent = prepare();
    expect(readLegacyRepostAttempt(user, 56)).toBeNull();
    expect(readLegacyRepostAttempt({ id: 10, companyId: 9 }, sourceId)).toBeNull();
    expect(readLegacyRepostAttempt({ id: 8, companyId: 10 }, sourceId)).toBeNull();
    expect(readLegacyCreateAttempt(user)).toBeNull();
    const create = prepareLegacyCreateAttempt(user, { userId: 8, name: 'Another intent', timeEnd: payload.timeEnd }, null);
    expect(create.key).not.toBe(sent.key); expect(() => prepare()).toThrow(); expect(() => prepare(payload, sent)).toThrow();
    expect(readLegacyRepostAttempt(user, sourceId)).toEqual(sent);
});
test('date/revision correction after rejection uses the original key; old response cannot overwrite it', () => {
    const sent = prepare(), rejected = settleLegacyRepostAttempt(user, sourceId, sent, { status: 'rejected' });
    const changed = prepare({ ...payload, timeEnd: payload.timeEnd + 1000, expectedRevision: 'jv1-' + 'b'.repeat(64) }, rejected);
    expect(changed.key).toBe(sent.key); expect(changed.payload).not.toEqual(sent.payload);
    expect(() => settleLegacyRepostAttempt(user, sourceId, sent, { status: 'pending' })).toThrow();
    expect(() => assertPendingLegacyRepost(user, sourceId, sent)).toThrow();
});
test('confirmed receipt survives reread and late failure; no automatic new key for the same source', () => {
    const sent = prepare(), receipt = settleLegacyRepostAttempt(user, sourceId, sent, { status: 'succeeded', postId: 101 });
    expect(settleLegacyRepostAttempt(user, sourceId, sent, { status: 'rejected' })).toEqual(receipt);
    expect(readLegacyRepostAttempt(user, sourceId)).toEqual(receipt); expect(() => prepare(payload, receipt)).toThrow();
});
test.each(['{broken', '{}', 'null'])('corrupt stored record %s blocks dispatch without deleting evidence', raw => {
    sessionStorage.setItem(slot, raw); expect(() => readLegacyRepostAttempt(user, sourceId)).toThrow();
    expect(() => prepare()).toThrow(); expect(sessionStorage.getItem(slot)).toBe(raw);
});
test.each([{ userId: true }, { postId: 56 }, { timeEnd: 9000000000000000 }, { expectedRevision: 'bad' }, { token: 'not-allowed' }])('rejects invalid saved payload %j', patch => {
    expect(() => prepare({ ...payload, ...patch })).toThrow(); expect(sessionStorage.getItem(slot)).toBeNull();
});
test.each(['storage-full', 'ignored-write', 'read-blocked', 'no-crypto'])('prevents a new request for %s', problem => {
    if (problem === 'storage-full') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    if (problem === 'ignored-write') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    if (problem === 'read-blocked') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    if (problem === 'no-crypto') Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
    expect(() => prepare()).toThrow();
});
test.each([{ id: 99, companyId: 9 }, { id: 8, companyId: 10 }, null])('will not send an old payload under identity %j', current => {
    const sent = prepare(); localStorage.setItem('userData', JSON.stringify(current));
    expect(() => assertPendingLegacyRepost(user, sourceId, sent)).toThrow(); expect(() => prepare()).toThrow();
});
test.each([{ idempotencyKey: 'wrong' }, { sourcePostId: 56 }, { postId: 55 }, { postId: true }, { replayed: undefined }])('does not accept ambiguous receipt %j', patch => {
    const sent = prepare();
    expect(isLegacyRepostReceipt({ errCode: 0, idempotencyKey: sent.key, sourcePostId: 55, postId: 101, replayed: false, ...patch }, sent)).toBe(false);
});
test('valid receipts are bound to both IDs and the key, including replay', () => {
    const sent = prepare();
    for (const replayed of [true, false]) expect(isLegacyRepostReceipt({ errCode: 0, idempotencyKey: sent.key,
        sourcePostId: 55, postId: 101, replayed }, sent)).toBe(true);
    settleLegacyRepostAttempt(user, sourceId, sent, { status: 'blocked' });
    expect(() => assertPendingLegacyRepost(user, sourceId, sent)).toThrow(); expect(() => prepare()).toThrow();
});
