import { jobEditMode, assertJobEditorIdentity, readCoreJobSnapshot, prepareCoreEditPending,
    readCoreEditPending, assertCoreEditPending, clearCoreEditPending, acceptCoreEditResponse } from './jobEditSession';
const user = { id: 8, companyId: 9, roleCode: 'EMPLOYER' };
const key = 'jobfind:core-edit:v1:8:9:55';
const revision = letter => 'jv1-' + letter.repeat(64);
const job = () => ({ id: 55, userId: 7, companyId: 9, statusCode: 'PS1', isHot: 1, timeEnd: '1700000000000',
    name: 'Engineer', descriptionHTML: '<p>Work</p>', descriptionMarkdown: 'Work', amount: 2,
    categoryJobCode: 'IT', addressCode: 'OLD-CODE', salaryJobCode: null, genderPostCode: null,
    categoryJoblevelCode: null, categoryWorktypeCode: null, experienceJobCode: null, editRevision: revision('a') });
const baseline = () => readCoreJobSnapshot({ errCode: 0, data: job() }, 55, user);
const fresh = () => { const base = baseline(); return prepareCoreEditPending(user, base, { ...base.form, name: 'Changed' }); };
const success = () => ({ errCode: 0, data: { ...job(), name: 'Changed', statusCode: 'PS3', editRevision: revision('b') } });
let original;
beforeEach(() => {
    original = process.env.REACT_APP_JOB_EDIT_MODE; delete process.env.REACT_APP_JOB_EDIT_MODE;
    jest.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); localStorage.setItem('userData', JSON.stringify(user));
    Object.defineProperty(window, 'crypto', { configurable: true, value: require('crypto').webcrypto });
});
afterEach(() => { if (original === undefined) delete process.env.REACT_APP_JOB_EDIT_MODE; else process.env.REACT_APP_JOB_EDIT_MODE = original; });
test('separate opt-in edit flag defaults to manual, rejects typos and never mutates stored Core evidence', () => {
    expect(jobEditMode()).toBe('legacy'); const sent = fresh();
    process.env.REACT_APP_JOB_EDIT_MODE = 'core'; expect(jobEditMode()).toBe('core');
    process.env.REACT_APP_JOB_EDIT_MODE = 'CORE'; expect(jobEditMode).toThrow(); expect(readCoreEditPending(user, 55)).toEqual(sent);
});
test('same-company teammate, null codes and expired deadline form a valid immutable editing baseline', () => {
    const data = job(), before = JSON.stringify(data), base = readCoreJobSnapshot({ errCode: 0, data }, '55', user);
    expect(base).toMatchObject({ ownerId: 7, companyId: 9, form: { genderCode: '', addressCode: 'OLD-CODE', timeEnd: '1700000000000' } });
    expect(JSON.stringify(data)).toBe(before);
});
test.each([{ id: 56 }, { companyId: 10 }, { userId: null }, { amount: '2' }, { statusCode: 'PS0' }, { isHot: null },
    { salaryJobCode: undefined }, { descriptionMarkdown: undefined }, { timeEnd: undefined }, { name: null }])('rejects incomplete/foreign Core snapshot %j before editing', patch => {
    expect(() => readCoreJobSnapshot({ errCode: 0, data: { ...job(), ...patch } }, 55, user)).toThrow();
});
test('ADMIN may read cross-company/orphan historical state but the UI helper never permits ADMIN writes', () => {
    const admin = { id: 1, roleCode: 'ADMIN' }; localStorage.setItem('userData', JSON.stringify(admin));
    const base = readCoreJobSnapshot({ errCode: 0, data: { ...job(), companyId: null, userId: null } }, 55, admin);
    expect(base.ownerId).toBeNull(); expect(() => prepareCoreEditPending(admin, base, { ...base.form, name: 'Changed' })).toThrow('chỉ xem');
});
test.each([null, undefined, 'bad'])('missing/invalid revision %j remains readable but cannot be used to write', editRevision => {
    const base = readCoreJobSnapshot({ errCode: 0, data: { ...job(), editRevision } }, 55, user);
    expect(base.form.editRevision).toBeNull(); expect(() => prepareCoreEditPending(user, base, { ...base.form, name: 'Changed' })).toThrow();
});
test('no-op has no local record/request; a real patch preserves baseline revision, excludes identity and stores an isolated copy', () => {
    const base = baseline(); expect(prepareCoreEditPending(user, base, base.form)).toBeNull(); expect(sessionStorage.getItem(key)).toBeNull();
    const draft = { ...base.form, amount: '3', userId: 999, companyId: 111, statusCode: 'PS4' };
    const sent = prepareCoreEditPending(user, base, draft); draft.amount = '4'; base.form.amount = '8';
    expect(sent.patch).toEqual({ amount: 3, expectedRevision: revision('a') });
    expect(sent.draft.amount).toBe('3'); expect(sent.draft.statusCode).toBe('PS1'); expect(sent.draft).not.toHaveProperty('userId');
    expect(readCoreEditPending(user, 55)).toEqual(sent); expect(() => assertCoreEditPending(user, sent)).not.toThrow();
});
test.each([{ id: 56 }, { timeEnd: '1900000000000' }, { isHot: 0 }, { amount: '0' }])('invalid or paid-field edit %j never writes storage', patch => {
    const base = baseline(); expect(() => prepareCoreEditPending(user, base, { ...base.form, ...patch })).toThrow();
    expect(sessionStorage.getItem(key)).toBeNull();
});
test('an unresolved PUT cannot be replaced, retried implicitly or cleared with a stale token', () => {
    const sent = fresh(); expect(() => fresh()).toThrow();
    expect(() => clearCoreEditPending(user, 55, { ...sent, attemptId: 'f'.repeat(32) })).toThrow();
    expect(readCoreEditPending(user, 55)).toEqual(sent);
});
test('confirmed response matches author, tenant, paid fields, every submitted field, PS3 and a new revision', () => {
    const sent = fresh(), next = acceptCoreEditResponse(success(), sent, user);
    expect(next.form).toMatchObject({ name: 'Changed', statusCode: 'PS3', editRevision: revision('b') });
    clearCoreEditPending(user, 55, sent); expect(readCoreEditPending(user, 55)).toBeNull();
    const newer = fresh(); expect(newer.attemptId).not.toBe(sent.attemptId);
    expect(() => clearCoreEditPending(user, 55, sent)).toThrow(); expect(readCoreEditPending(user, 55)).toEqual(newer);
});
test.each([{ id: 56 }, { companyId: 10 }, { userId: 8 }, { statusCode: 'PS1' }, { editRevision: revision('a') },
    { editRevision: null }, { name: 'Different' }, { descriptionHTML: '<p>Different</p>' }, { amount: 3 },
    { addressCode: 'OTHER' }, { genderPostCode: 'G1' }, { timeEnd: '1900000000000' }, { isHot: 0 }])('mismatched success %j never clears the pending edit', patch => {
    const sent = fresh(), res = success(); res.data = { ...res.data, ...patch };
    expect(() => acceptCoreEditResponse(res, sent, user)).toThrow(); expect(readCoreEditPending(user, 55)).toEqual(sent);
});
test.each([{ ...user, id: 10 }, { ...user, companyId: 10 }, { ...user, roleCode: 'ADMIN' }, null])('changed identity %j blocks sending but late confirmed completion can only finish its original record', current => {
    const sent = fresh(); localStorage.setItem('userData', JSON.stringify(current));
    expect(() => assertJobEditorIdentity(user)).toThrow(); expect(() => assertCoreEditPending(user, sent)).toThrow();
    expect(acceptCoreEditResponse(success(), sent, user).form.name).toBe('Changed');
    clearCoreEditPending(user, 55, sent); expect(sessionStorage.getItem(key)).toBeNull();
});
test.each(['{broken', 'null', '{}'])('corrupt stored record %s locks instead of choosing another writer', raw => {
    sessionStorage.setItem(key, raw); expect(() => readCoreEditPending(user, 55)).toThrow('Không đọc được');
    expect(() => fresh()).toThrow(); expect(sessionStorage.getItem(key)).toBe(raw);
});
test.each(['writer', 'scope', 'patch', 'draft'])('altering persisted %s prevents sending or clearing a different request', field => {
    const sent = fresh(); sessionStorage.setItem(key, JSON.stringify({ ...sent, [field]: 'tampered' }));
    expect(() => assertCoreEditPending(user, sent)).toThrow(); expect(() => clearCoreEditPending(user, 55, sent)).toThrow();
});
test.each(['set-throws', 'set-ignored', 'get-throws', 'crypto'])('persistence failure %s stops before HTTP can begin', error => {
    if (error === 'set-throws') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    if (error === 'set-ignored') jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    if (error === 'get-throws') jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    if (error === 'crypto') Object.defineProperty(window, 'crypto', { configurable: true, value: undefined });
    expect(() => fresh()).toThrow();
});
test('ignored removal retains evidence rather than allowing another PUT', () => {
    const sent = fresh(); jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
    expect(() => clearCoreEditPending(user, 55, sent)).toThrow(); expect(readCoreEditPending(user, 55)).toEqual(sent);
});
