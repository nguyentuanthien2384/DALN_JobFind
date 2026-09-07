import axios from '../axios';
import { reupPostService } from './userService';
import { prepareLegacyRepostAttempt, settleLegacyRepostAttempt } from './legacyRepostAttempt';
import { readCoreJobSnapshot, prepareCoreEditPending } from './jobEditSession';
import { jobRepostMode, readJobRepostAttempt, coreRepostSource, prepareJobRepostAttempt, assertPendingJobRepost,
    sendJobRepostAttempt, settleJobRepostAttempt, isCoreRepostReceipt, jobRepostOutcome } from './jobRepostAttempt';

jest.mock('../axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('./userService', () => ({ reupPostService: jest.fn() }));
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
const slot = 'jobfind:core-repost:v1:8:9:55', oldSlot = 'jobfind:legacy-repost:v1:8:9:55';
const revision = letter => 'jv1-' + letter.repeat(64);
const source = () => ({ id: 55, userId: 7, companyId: 9, statusCode: 'PS1', isHot: 1, timeEnd: '1700000000000',
    name: 'Engineer', descriptionHTML: '<p>Build</p>', descriptionMarkdown: null, amount: null,
    categoryJobCode: 'IT', addressCode: 'OLD', salaryJobCode: null, genderPostCode: null,
    categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null, editRevision: revision('a') });
const payload = { userId: 8, postId: '55', timeEnd: 2000000000000, expectedRevision: revision('a') };
const copy = () => coreRepostSource({ errCode: 0, data: source() }, 55, user, payload.expectedRevision);
const fresh = () => prepareJobRepostAttempt(user, 55, payload, null, 'core', copy());
const receipt = sent => ({ errCode: 0, data: { ...sent.expected, id: 101, userId: 8, companyId: 9,
    statusCode: 'PS3', timeEnd: String(sent.payload.timeEnd) } });
let originalMode;
beforeEach(() => {
    originalMode = process.env.REACT_APP_JOB_REPOST_MODE; delete process.env.REACT_APP_JOB_REPOST_MODE;
    jest.restoreAllMocks(); axios.post.mockReset(); reupPostService.mockReset();
    localStorage.clear(); sessionStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
});
afterEach(() => { if (originalMode === undefined) delete process.env.REACT_APP_JOB_REPOST_MODE; else process.env.REACT_APP_JOB_REPOST_MODE = originalMode; });

test('default manual, strict flag, stored Core dispatch survives invalid rollout with the exact HTTP allowlist', async () => {
    expect(jobRepostMode()).toBe('legacy'); process.env.REACT_APP_JOB_REPOST_MODE = 'core'; expect(jobRepostMode()).toBe('core');
    const sent = fresh(); process.env.REACT_APP_JOB_REPOST_MODE = 'CORE'; expect(jobRepostMode).toThrow();
    axios.post.mockImplementation(async () => { expect(readJobRepostAttempt(user, 55)).toEqual(sent); return receipt(sent); });
    const response = await sendJobRepostAttempt(user, 55, sent);
    expect(axios.post).toHaveBeenCalledWith('/api/jobs/55/repost', { timeEnd: payload.timeEnd, expectedRevision: payload.expectedRevision },
        { timeout: 15000, headers: { 'Idempotency-Key': sent.key } });
    expect(jobRepostOutcome(response, 55, sent, user)).toEqual({ status: 'succeeded', postId: 101 });
    expect(reupPostService).not.toHaveBeenCalled(); expect(sessionStorage.getItem(oldSlot)).toBeNull();
});
test('source teammate ownership and nullable historical fields are preserved, but new author must be the actor', () => {
    const expected = copy(), sent = prepareJobRepostAttempt(user, 55, { ...payload, statusCode: 'PS1', companyId: 99 }, null, 'core', expected);
    expected.name = 'unsaved'; expect(sent.expected.name).toBe('Engineer'); expect(sent.expected.amount).toBeNull();
    expect(sent.expected.descriptionMarkdown).toBeNull(); expect(Object.keys(sent.payload)).toHaveLength(2);
    expect(isCoreRepostReceipt(receipt(sent), 55, sent, user)).toBe(true);
    expect(isCoreRepostReceipt({ errCode: 0, data: { ...receipt(sent).data, userId: 7 } }, 55, sent, user)).toBe(false);
});
test.each(['pending', 'rejected', 'blocked', 'succeeded'])('old legacy %s retains storage format, key, payload and writer after enabling Core', async status => {
    const old = prepareLegacyRepostAttempt(user, 55, payload, null);
    settleLegacyRepostAttempt(user, 55, old, { status, ...(status === 'succeeded' && { postId: 101 }) });
    const raw = sessionStorage.getItem(oldSlot), saved = readJobRepostAttempt(user, 55);
    expect(saved).toMatchObject({ writer: 'legacy', key: old.key, payload, status }); expect(sessionStorage.getItem(oldSlot)).toBe(raw);
    if (status === 'pending') {
        await sendJobRepostAttempt(user, 55, saved); settleJobRepostAttempt(user, 55, saved, { status: 'pending' });
    }
    let corrected;
    if (status === 'rejected') {
        corrected = prepareJobRepostAttempt(user, 55, { ...payload, timeEnd: payload.timeEnd + 1 }, saved, 'core');
        await sendJobRepostAttempt(user, 55, corrected);
    }
    expect(readJobRepostAttempt(user, 55)).toMatchObject({ key: old.key, writer: 'legacy' });
    expect(JSON.parse(sessionStorage.getItem(oldSlot))).not.toHaveProperty('writer');
    const { writer, ...untagged } = corrected || saved;
    expect(sessionStorage.getItem(oldSlot)).toBe(status === 'rejected' ? JSON.stringify(untagged) : raw);
    expect(axios.post).not.toHaveBeenCalled(); expect(sessionStorage.getItem(slot)).toBeNull();
});
test.each(['pending', 'blocked', 'succeeded'])('Core %s stays pinned during rollback; no fresh key replaces evidence', status => {
    const sent = fresh(), saved = settleJobRepostAttempt(user, 55, sent, { status, ...(status === 'succeeded' && { postId: 101 }) });
    process.env.REACT_APP_JOB_REPOST_MODE = 'legacy'; expect(readJobRepostAttempt(user, 55)).toEqual(saved);
    expect(() => prepareJobRepostAttempt(user, 55, payload, saved, 'legacy', copy())).toThrow();
    expect(sessionStorage.getItem(oldSlot)).toBeNull();
});
test('Core rejected stays pinned during rollback and corrects only with its original key', () => {
    const sent = fresh(), saved = settleJobRepostAttempt(user, 55, sent, { status: 'rejected' });
    process.env.REACT_APP_JOB_REPOST_MODE = 'legacy'; expect(readJobRepostAttempt(user, 55)).toEqual(saved);
    const corrected = prepareJobRepostAttempt(user, 55, { ...payload, expectedRevision: revision('b') }, saved, 'legacy', copy());
    expect(corrected).toMatchObject({ writer: 'core', key: saved.key, payload: { expectedRevision: revision('b') } });
    expect(() => settleJobRepostAttempt(user, 55, sent, { status: 'succeeded', postId: 101 })).toThrow();
    expect(sessionStorage.getItem(oldSlot)).toBeNull();
});
test.each(['pending', 'rejected', 'blocked', 'succeeded'])('two stored intents fail closed without deleting either (%s)', status => {
    const sent = fresh(); settleJobRepostAttempt(user, 55, sent, { status, ...(status === 'succeeded' && { postId: 101 }) });
    prepareLegacyRepostAttempt(user, 55, payload, null);
    const oldRaw = sessionStorage.getItem(oldSlot), raw = sessionStorage.getItem(slot);
    expect(() => readJobRepostAttempt(user, 55)).toThrow('cả hai');
    expect(() => sendJobRepostAttempt(user, 55, sent)).toThrow();
    expect(() => settleJobRepostAttempt(user, 55, sent, { status: 'pending' })).toThrow();
    expect(sessionStorage.getItem(oldSlot)).toBe(oldRaw); expect(sessionStorage.getItem(slot)).toBe(raw);
});
test.each([slot, oldSlot])('corrupt %s blocks dispatch while retaining evidence', name => {
    const sent = fresh(); sessionStorage.setItem(name, '{bad');
    expect(() => readJobRepostAttempt(user, 55)).toThrow(); expect(() => sendJobRepostAttempt(user, 55, sent)).toThrow();
    expect(sessionStorage.getItem(name)).toBe('{bad'); expect(axios.post).not.toHaveBeenCalled();
});
test.each([
    { payload: { ...payload } }, { payload: { timeEnd: '2000000000000', expectedRevision: revision('a') } },
    { payload: { timeEnd: 0, expectedRevision: revision('a') } }, { payload: { timeEnd: 8640000000000001, expectedRevision: revision('a') } },
    { payload: { timeEnd: payload.timeEnd, expectedRevision: null } }, { expected: {} }, { writer: 'legacy' },
    { scope: '8:9:56' }, { key: 'bad' }, { status: 'succeeded', postId: 55 }, { status: 'succeeded' }
])('malformed Core record %j cannot be dispatched', patch => {
    const sent = fresh(); sessionStorage.setItem(slot, JSON.stringify({ ...sent, ...patch }));
    expect(() => readJobRepostAttempt(user, 55)).toThrow(); expect(() => sendJobRepostAttempt(user, 55, sent)).toThrow();
});
test.each([
    { editRevision: revision('b') }, { editRevision: null }, { statusCode: 'PS4' }, { timeEnd: '9999999999999' },
    { timeEnd: 'bad' }, { timeEnd: null }, { id: 56 }, { companyId: 99 }, { salaryJobCode: undefined }, { amount: '2' }
])('fresh source %j cannot replace the loaded version or bypass eligibility', patch => {
    expect(() => coreRepostSource({ errCode: 0, data: { ...source(), ...patch } }, 55, user, payload.expectedRevision)).toThrow();
    expect(sessionStorage.length).toBe(0); expect(axios.post).not.toHaveBeenCalled();
});
test.each(['PS1', 'PS2', 'PS3'])('expired %s source is eligible', statusCode => {
    expect(coreRepostSource({ errCode: 0, data: { ...source(), statusCode } }, 55, user, payload.expectedRevision)).toEqual(copy());
});
test('pending replay keeps original body/copy/key after expiry, regardless of Core edit pending or source state', async () => {
    const sent = fresh(), base = readCoreJobSnapshot({ errCode: 0, data: source() }, 55, user);
    prepareCoreEditPending(user, base, { ...base.form, name: 'New draft' });
    jest.spyOn(Date, 'now').mockReturnValue(payload.timeEnd + 1);
    axios.post.mockResolvedValue(receipt(sent)); const response = await sendJobRepostAttempt(user, 55, sent);
    expect(readJobRepostAttempt(user, 55)).toEqual(sent); expect(jobRepostOutcome(response, 55, sent, user).status).toBe('succeeded');
});
test.each(['legacy', 'core'])('new %s repost cannot bypass an unresolved Core edit', mode => {
    const base = readCoreJobSnapshot({ errCode: 0, data: source() }, 55, user);
    prepareCoreEditPending(user, base, { ...base.form, name: 'New draft' });
    expect(() => prepareJobRepostAttempt(user, 55, payload, null, mode, copy())).toThrow('đối chiếu');
    expect(sessionStorage.getItem(slot)).toBeNull(); expect(sessionStorage.getItem(oldSlot)).toBeNull();
});
test.each([{ id: 10 }, { companyId: 10 }, { roleCode: 'COMPANY' }])('identity switch %j stops dispatch, not late receipt persistence to original scope', async patch => {
    const sent = fresh(); localStorage.setItem('userData', JSON.stringify({ ...user, ...patch }));
    expect(() => sendJobRepostAttempt(user, 55, sent)).toThrow();
    expect(() => prepareJobRepostAttempt(user, 55, payload, null, 'core', copy())).toThrow();
    expect(settleJobRepostAttempt(user, 55, sent, jobRepostOutcome(receipt(sent), 55, sent, user)).status).toBe('succeeded');
});
test('admin cannot prepare a new repost', () => {
    const admin = { ...user, roleCode: 'ADMIN' }; localStorage.setItem('userData', JSON.stringify(admin));
    expect(() => prepareJobRepostAttempt(admin, 55, payload, null, 'core', copy())).toThrow('chỉ xem');
});
test('storage failure and changed payload/copy prevent HTTP; confirmed/blocked evidence wins over late errors', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('full'); }); expect(fresh).toThrow('full');
    const sent = fresh(); const changedCopy = { ...sent, expected: { ...sent.expected, name: 'Different' } };
    expect(() => assertPendingJobRepost(user, 55, changedCopy)).toThrow();
    expect(() => settleJobRepostAttempt(user, 55, changedCopy, { status: 'pending' })).toThrow();
    const success = settleJobRepostAttempt(user, 55, sent, { status: 'succeeded', postId: 101 });
    expect(settleJobRepostAttempt(user, 55, sent, { status: 'pending' })).toEqual(success);
    sessionStorage.clear(); const next = fresh(); settleJobRepostAttempt(user, 55, next, { status: 'blocked' });
    expect(settleJobRepostAttempt(user, 55, next, { status: 'pending' }).status).toBe('blocked'); expect(axios.post).not.toHaveBeenCalled();
});
test.each(['id', 'userId', 'companyId', 'statusCode', 'timeEnd', 'isHot', 'name', 'descriptionHTML', 'descriptionMarkdown',
    'categoryJobCode', 'addressCode', 'salaryJobCode', 'genderPostCode', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'amount'])
('malformed success missing %s stays blocked despite a matching client key', field => {
    const sent = fresh(), response = receipt(sent); delete response.data[field]; response.idempotencyKey = sent.key;
    expect(jobRepostOutcome(response, 55, sent, user)).toEqual({ status: 'blocked' });
});
test.each([null, {}, { errCode: 0 }, { errCode: 0, data: [] }])('incomplete response %j does not confirm success', response => {
    const sent = fresh(); expect(jobRepostOutcome(response, 55, sent, user).status).toBe(response?.errCode === 0 ? 'blocked' : 'pending');
});
test.each([400, 403, 409, 413, 415, 422, 429])('Core definite %s permits correction only with same key and writer', httpStatus => {
    const sent = fresh(); expect(jobRepostOutcome({ httpStatus, errCode: 2 }, 55, sent, user)).toEqual({ status: 'rejected' });
});
test.each([401, 404, 408, 500, 502, 503])('Core uncertain %s retains original pending payload', httpStatus => {
    const sent = fresh(); expect(jobRepostOutcome({ httpStatus, errCode: 2 }, 55, sent, user)).toEqual({ status: 'pending' });
});
test.each(['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'])('Core %s uncertainty overrides a business code', errorType => {
    const sent = fresh(); expect(jobRepostOutcome({ httpStatus: 400, errCode: 2, errorType }, 55, sent, user).status).toBe('pending');
});
test('legacy receipt/conflict/business error semantics remain unchanged', () => {
    const sent = prepareJobRepostAttempt(user, 55, payload, null, 'legacy');
    expect(jobRepostOutcome({ errCode: 0, postId: 101, sourcePostId: 55, replayed: true, idempotencyKey: sent.key }, 55, sent, user).status).toBe('succeeded');
    expect(jobRepostOutcome({ errCode: 0, postId: 101 }, 55, sent, user).status).toBe('blocked');
    expect(jobRepostOutcome({ errCode: 2 }, 55, sent, user).status).toBe('rejected');
    expect(jobRepostOutcome({ errCode: 4, conflict: true }, 55, sent, user).status).toBe('rejected');
    expect(jobRepostOutcome({ errCode: 2, errorType: 'timeout' }, 55, sent, user).status).toBe('pending');
});
