import axios from '../axios';
import { createPostService } from './userService';
import { prepareLegacyCreateAttempt, settleLegacyCreateAttempt } from './legacyCreateAttempt';
import { jobCreateMode, readJobCreateAttempt, prepareJobCreateAttempt, assertPendingJobCreate,
    sendJobCreateAttempt, settleJobCreateAttempt, clearSuccessfulJobCreate, isCoreCreateReceipt,
    jobCreateOutcome } from './jobCreateAttempt';

jest.mock('../axios', () => ({ __esModule: true, default: { post: jest.fn() } }));
jest.mock('./userService', () => ({ createPostService: jest.fn() }));
const user = { id: 8, companyId: 9 };
const name = 'jobfind:core-create:v1:8:9', oldName = 'jobfind:legacy-create:v1:8:9';
const payload = { userId: 8, companyId: 999, roleCode: 'ADMIN', id: 123, statusCode: 'PS1', editRevision: 'bogus',
    name: 'Engineer', descriptionHTML: '<p>Build APIs</p>', descriptionMarkdown: 'Build APIs', categoryJobCode: 'DEV',
    addressCode: 'HN', salaryJobCode: '', amount: '2', timeEnd: 1900000000000,
    categoryJoblevelCode: 'SENIOR', categoryWorktypeCode: 'FULL', experienceJobCode: 'E2', genderPostCode: 'ALL', isHot: 0 };
const fresh = () => prepareJobCreateAttempt(user, { ...payload }, null, 'core');
const receipt = sent => ({ errCode: 0, data: { ...sent.payload, id: 12, userId: 8, companyId: 9,
    amount: Number(sent.payload.amount), timeEnd: String(sent.payload.timeEnd), statusCode: 'PS3' } });
let originalMode;
beforeEach(() => {
    originalMode = process.env.REACT_APP_JOB_CREATE_MODE;
    delete process.env.REACT_APP_JOB_CREATE_MODE;
    jest.restoreAllMocks(); axios.post.mockReset(); createPostService.mockReset();
    sessionStorage.clear(); localStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
});
afterEach(() => {
    if (originalMode === undefined) delete process.env.REACT_APP_JOB_CREATE_MODE;
    else process.env.REACT_APP_JOB_CREATE_MODE = originalMode;
});

test('opt-in flag defaults to manual, validates exactly and does not affect saved dispatch', async () => {
    expect(jobCreateMode()).toBe('legacy'); process.env.REACT_APP_JOB_CREATE_MODE = 'core'; expect(jobCreateMode()).toBe('core');
    const sent = fresh(); process.env.REACT_APP_JOB_CREATE_MODE = 'typo'; expect(jobCreateMode).toThrow();
    expect(readJobCreateAttempt(user)).toEqual(sent);
    axios.post.mockResolvedValue(receipt(sent)); await sendJobCreateAttempt(user, sent);
    expect(axios.post).toHaveBeenCalledWith('/api/jobs', sent.payload, { headers: { 'Idempotency-Key': sent.key }, timeout: 15000 });
    expect(createPostService).not.toHaveBeenCalled();
});
test('stores writer/scope/immutable allowlisted payload before POST; Core never trusts form identity', async () => {
    const input = { ...payload }, sent = prepareJobCreateAttempt(user, input, null, 'core'); input.name = 'changed';
    expect(sent.key).toMatch(/^[a-f0-9]{32}$/); expect(readJobCreateAttempt(user)).toEqual(sent);
    expect(sent.payload.name).toBe('Engineer'); expect(sent.payload.salaryJobCode).toBeNull();
    for (const field of ['userId', 'companyId', 'roleCode', 'id', 'statusCode', 'editRevision']) expect(sent.payload).not.toHaveProperty(field);
    expect(sessionStorage.getItem(oldName)).toBeNull();
    axios.post.mockImplementation(async () => { expect(JSON.parse(sessionStorage.getItem(name))).toEqual(sent); return receipt(sent); });
    expect(jobCreateOutcome(await sendJobCreateAttempt(user, sent), sent, user)).toEqual({ status: 'succeeded', postId: 12 });
});
test('blank count uses the explicit Core default once; payload stays fixed after time passes', () => {
    const sent = prepareJobCreateAttempt(user, { ...payload, amount: '' }, null, 'core');
    expect(sent.payload.amount).toBe(1);
    jest.spyOn(Date, 'now').mockReturnValue(payload.timeEnd + 1);
    expect(readJobCreateAttempt(user)).toEqual(sent); expect(isCoreCreateReceipt(receipt(sent), sent, user)).toBe(true);
});
test.each(['pending', 'rejected', 'succeeded', 'blocked'])('preexisting legacy %s remains legacy, byte-for-byte and with original key', async status => {
    const oldPayload = { userId: 8, name: 'Old draft', timeEnd: payload.timeEnd };
    const old = prepareLegacyCreateAttempt(user, oldPayload, null);
    settleLegacyCreateAttempt(user, old, { status, ...(status === 'succeeded' && { postId: 23 }) });
    const raw = sessionStorage.getItem(oldName), saved = readJobCreateAttempt(user);
    process.env.REACT_APP_JOB_CREATE_MODE = 'core';
    expect(saved).toMatchObject({ writer: 'legacy', key: old.key, payload: oldPayload, status });
    if (status === 'pending') await sendJobCreateAttempt(user, saved);
    if (status === 'rejected') {
        const retry = prepareJobCreateAttempt(user, { ...oldPayload, name: 'corrected' }, saved, 'core');
        expect(retry).toMatchObject({ key: old.key, writer: 'legacy' }); await sendJobCreateAttempt(user, retry);
    } else expect(sessionStorage.getItem(oldName)).toBe(raw);
    expect(axios.post).not.toHaveBeenCalled(); expect(sessionStorage.getItem(name)).toBeNull();
});
test.each(['pending', 'rejected', 'succeeded', 'blocked'])('rejects two stores without deleting either (%s)', status => {
    const sent = fresh(); settleJobCreateAttempt(user, sent, { status, ...(status === 'succeeded' && { postId: 12 }) });
    prepareLegacyCreateAttempt(user, { userId: 8, name: 'Old', timeEnd: payload.timeEnd }, null);
    const coreRaw = sessionStorage.getItem(name), oldRaw = sessionStorage.getItem(oldName);
    expect(() => readJobCreateAttempt(user)).toThrow('cả hai');
    expect(() => sendJobCreateAttempt(user, sent)).toThrow(); expect(() => clearSuccessfulJobCreate(user, sent)).toThrow();
    expect(sessionStorage.getItem(name)).toBe(coreRaw); expect(sessionStorage.getItem(oldName)).toBe(oldRaw);
});
test.each(['core', 'legacy'])('unreadable %s store prevents fallback/new intent and preserves evidence', store => {
    const key = store === 'core' ? name : oldName; sessionStorage.setItem(key, '{broken');
    expect(() => readJobCreateAttempt(user)).toThrow(); expect(() => fresh()).toThrow();
    expect(sessionStorage.getItem(key)).toBe('{broken'); expect(axios.post).not.toHaveBeenCalled();
});
test.each([
    { writer: 'legacy' }, { version: 2 }, { scope: '8:10' }, { key: 'bad' }, { status: 'unknown' },
    { status: 'succeeded', postId: true }, { payload: null }, { payload: { ...payload } }
])('fails closed for a malformed saved Core record %j', patch => {
    const sent = fresh(); sessionStorage.setItem(name, JSON.stringify({ ...sent, ...patch }));
    expect(() => readJobCreateAttempt(user)).toThrow(); expect(() => fresh()).toThrow();
});
test.each(['set-throws', 'set-ignored', 'get-throws', 'no-crypto'])('never dispatches if persistence cannot be verified: %s', problem => {
    if (problem === 'set-throws') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    if (problem === 'set-ignored') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    if (problem === 'get-throws') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    if (problem === 'no-crypto') Object.defineProperty(window, 'crypto', { configurable: true, value: undefined });
    expect(() => fresh()).toThrow(); expect(axios.post).not.toHaveBeenCalled(); expect(createPostService).not.toHaveBeenCalled();
});
test.each([{ id: 10, companyId: 9 }, { id: 8, companyId: 10 }, {}, null])('identity change %j blocks sends and clearing, retaining the original intent', current => {
    const sent = fresh(); localStorage.setItem('userData', JSON.stringify(current));
    expect(() => assertPendingJobCreate(user, sent)).toThrow(); expect(() => sendJobCreateAttempt(user, sent)).toThrow();
    expect(() => clearSuccessfulJobCreate(user, sent)).toThrow(); expect(readJobCreateAttempt(user)).toEqual(sent);
});
test('rejection keeps key and writer even with corrected payload and a changed flag; late response cannot overwrite correction', () => {
    const sent = fresh(), rejected = settleJobCreateAttempt(user, sent, { status: 'rejected' });
    const retry = prepareJobCreateAttempt(user, { ...payload, amount: '3' }, rejected, 'legacy');
    expect(retry).toMatchObject({ writer: 'core', key: sent.key, payload: { amount: '3' } });
    expect(() => settleJobCreateAttempt(user, sent, { status: 'succeeded', postId: 12 })).toThrow();
    expect(() => assertPendingJobCreate(user, sent)).toThrow(); expect(readJobCreateAttempt(user)).toEqual(retry);
});
test('stale empty/duplicate/rejected views cannot replace an outstanding intent', () => {
    const sent = fresh();
    for (const previous of [null, sent, { ...sent, status: 'rejected' }]) {
        expect(() => prepareJobCreateAttempt(user, payload, previous, 'legacy')).toThrow();
    }
    expect(() => clearSuccessfulJobCreate(user, sent)).toThrow(); expect(readJobCreateAttempt(user)).toEqual(sent);
});
test.each(['succeeded', 'blocked'])('late failure does not downgrade %s, and only matching success may explicitly create another', status => {
    const sent = fresh(), done = settleJobCreateAttempt(user, sent, { status, ...(status === 'succeeded' && { postId: 12 }) });
    expect(settleJobCreateAttempt(user, sent, { status: 'rejected' })).toEqual(done);
    expect(() => clearSuccessfulJobCreate(user, { ...done, key: 'f'.repeat(32) })).toThrow();
    if (status === 'succeeded') {
        clearSuccessfulJobCreate(user, done); expect(readJobCreateAttempt(user)).toBeNull(); expect(fresh().key).not.toBe(sent.key);
    } else expect(() => clearSuccessfulJobCreate(user, done)).toThrow();
});
test('ignored storage removal cannot start another intent', () => {
    const sent = fresh(), done = settleJobCreateAttempt(user, sent, { status: 'succeeded', postId: 12 });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    expect(() => clearSuccessfulJobCreate(user, done)).toThrow(); expect(readJobCreateAttempt(user)).toEqual(done);
});
test('Core receipt comes from the accepted snapshot, not client key echo or replay flags', () => {
    const sent = fresh(); expect(isCoreCreateReceipt(receipt(sent), sent, user)).toBe(true);
    expect(jobCreateOutcome({ errCode: 0, idempotencyKey: sent.key, replayed: true, postId: 12 }, sent, user)).toEqual({ status: 'blocked' });
});
test.each([
    { id: true }, { userId: 99 }, { companyId: 10 }, { statusCode: 'PS1' }, { name: 'different' },
    { descriptionHTML: '<p>different</p>' }, { descriptionMarkdown: 'different' }, { categoryJobCode: 'different' },
    { addressCode: 'different' }, { salaryJobCode: '' }, { categoryJoblevelCode: null }, { categoryWorktypeCode: null },
    { experienceJobCode: null }, { genderPostCode: null }, { amount: true }, { amount: 3 }, { timeEnd: '1900000000001' }, { isHot: 1 }
])('rejects mismatched Core success %j, keeping the user from starting a new key', patch => {
    const sent = fresh(), res = receipt(sent); res.data = { ...res.data, ...patch };
    expect(jobCreateOutcome(res, sent, user)).toEqual({ status: 'blocked' });
});
test.each([400, 403, 409, 413, 415, 422, 429])('HTTP %s is correctable without changing the intent/key (including quota 409)', httpStatus => {
    const sent = fresh(); expect(jobCreateOutcome({ errCode: httpStatus, httpStatus }, sent, user)).toEqual({ status: 'rejected' });
});
test.each([null, { errCode: 400 }, { errCode: -1 }, { errCode: 401, httpStatus: 401 }, { errCode: 404, httpStatus: 404 },
    { errCode: 408, httpStatus: 408 }, { errCode: 500, httpStatus: 500 }, { errCode: 2, httpStatus: 503 },
    { errCode: 2, errorType: 'timeout' }, { errCode: 2, httpStatus: 400, errorType: 'cancelled' }])('uncertain response %j stays pending with no alternative endpoint or timer retry', async response => {
    const sent = fresh(); axios.post.mockResolvedValue(response);
    expect(jobCreateOutcome(await sendJobCreateAttempt(user, sent), sent, user)).toEqual({ status: 'pending' });
    expect(readJobCreateAttempt(user)).toEqual(sent); expect(axios.post).toHaveBeenCalledTimes(1); expect(createPostService).not.toHaveBeenCalled();
});
test('transport rejection preserves the stored Core intent and never invokes the old writer', async () => {
    const sent = fresh(); axios.post.mockRejectedValue(new Error('lost response'));
    await expect(sendJobCreateAttempt(user, sent)).rejects.toThrow('lost response');
    expect(readJobCreateAttempt(user)).toEqual(sent); expect(createPostService).not.toHaveBeenCalled();
});
