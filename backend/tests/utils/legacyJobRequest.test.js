const mockDb = { sequelize: { query: jest.fn() } };
const mockLock = jest.fn();
jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/postingQuota', () => ({
    PostingQuotaError: class PostingQuotaError extends Error {},
    normalizePostHot: value => value === true || value === 1 || value === '1' ? 1 : 0,
    lockPostingCompany: (...args) => mockLock(...args)
}));
const { runLegacyCreateRequest, normalizeLegacyCreate } = require('../../src/utils/legacyJobRequest');
const crypto = require('crypto');
const transaction = { id: 'only-transaction' }, key = 'request-123';
const data = { userId: 7, name: 'Engineer', descriptionHTML: '<p>Job</p>', descriptionMarkdown: 'Job',
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1', amount: '2', isHot: '0', timeEnd: '1900000000000' };
const identity = { companyId: 3, roleCode: 'EMPLOYER' };
const receipt = { errCode: 0, errMessage: 'Created', postId: 15, idempotencyKey: key, replayed: false };
const savedRow = () => ({ operation: 'legacy-create', companyId: 3, postId: 15,
    requestHash: crypto.createHash('sha256').update(JSON.stringify({ version: 1, operation: 'legacy-create', input: normalizeLegacyCreate(data) })).digest('hex'),
    responseJson: JSON.stringify(receipt) });
let duplicate, saved, post, work;
const run = (extra = {}) => runLegacyCreateRequest(transaction, { data, identity, key, ...extra }, work);
beforeEach(() => {
    duplicate = false; saved = savedRow(); post = { id: 15, userId: 7 };
    work = jest.fn().mockResolvedValue({ errCode: 0, errMessage: 'Created', postId: 15 });
    mockLock.mockReset().mockResolvedValue({ id: 3 });
    mockDb.sequelize.query.mockReset().mockImplementation(async sql => {
        if (sql.includes('information_schema.STATISTICS')) return [[{ name: 'userId' }, { name: 'requestKey' }]];
        if (sql.includes('information_schema.COLUMNS')) return [[{ collationName: 'ascii_bin', keyLength: 128 }]];
        if (sql.includes('information_schema')) return [[{ engine: 'InnoDB' }]];
        if (sql.includes('INSERT INTO') && duplicate) throw { original: { code: 'ER_DUP_ENTRY' } };
        if (sql.startsWith('SELECT operation')) return [[saved]];
        if (sql.startsWith('SELECT id')) return [[post]];
        if (sql.startsWith('UPDATE')) return [undefined, 1];
        return [undefined, {}];
    });
});
test('claims before business writes and finalizes response in exactly the same transaction', async () => {
    expect(await run()).toEqual(receipt);
    expect(work).toHaveBeenCalledWith({ ...normalizeLegacyCreate(data), userId: 7 });
    const calls = mockDb.sequelize.query.mock.calls;
    expect(calls.every(([, options]) => options.transaction === transaction)).toBe(true);
    expect(calls[3][1].replacements).toEqual([7, key, 'legacy-create', saved.requestHash, 3]);
    expect(calls[4][1].replacements).toEqual([15, JSON.stringify(receipt), 7, key]);
    expect(mockDb.sequelize.query.mock.invocationCallOrder[3]).toBeLessThan(work.mock.invocationCallOrder[0]);
});
test.each(['COMPANY', 'EMPLOYER', 'ADMIN'])('replay for authorized %s checks current membership/post and never invokes quota work', async roleCode => {
    duplicate = true;
    expect(await run({ identity: { ...identity, roleCode } })).toEqual({ ...receipt, replayed: true });
    expect(mockLock).toHaveBeenCalledWith(7, transaction); expect(work).not.toHaveBeenCalled();
    expect(mockDb.sequelize.query.mock.calls.filter(([sql]) => /SHARE MODE/.test(sql))).toHaveLength(2);
    expect(mockDb.sequelize.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
test.each([null, '', 123, [], 'bad key', 'x'.repeat(129)])('rejects malformed key %j before claiming', async key => {
    await expect(run({ key })).rejects.toMatchObject({ httpStatus: 400 });
    expect(work).not.toHaveBeenCalled(); expect(mockDb.sequelize.query).not.toHaveBeenCalled();
});
test.each([{ companyId: null }, { companyId: 0 }, { companyId: {} }, { roleCode: 'CANDIDATE' }, { roleCode: undefined }])('rejects untrusted keyed scope %j', async patch => {
    await expect(run({ identity: { ...identity, ...patch } })).rejects.toMatchObject({ httpStatus: 403 });
    expect(mockDb.sequelize.query).not.toHaveBeenCalled();
});
test.each([{ name: {} }, { descriptionMarkdown: '' }, { amount: true }, { amount: '1.5' }, { timeEnd: null },
    { timeEnd: '9000000000000000' }, { userId: true }])('rejects invalid intent %j', async patch => {
    await expect(run({ data: { ...data, ...patch } })).rejects.toMatchObject({ httpStatus: patch.userId ? 403 : 400 });
    expect(work).not.toHaveBeenCalled(); expect(mockDb.sequelize.query).not.toHaveBeenCalled();
});
test.each([[[]], [[{ engine: 'MyISAM' }]]])('fails closed for unsafe ledger %j', async rows => {
    mockDb.sequelize.query.mockResolvedValueOnce([rows]);
    await expect(run()).rejects.toMatchObject({ httpStatus: 503 }); expect(work).not.toHaveBeenCalled();
});
test.each([{ operation: 'create' }, { requestHash: 'wrong' }, { responseJson: '{}' }, { responseJson: 'broken' },
    { postId: null }, { responseJson: JSON.stringify({ ...receipt, idempotencyKey: 'wrong' }) },
    { responseJson: JSON.stringify({ ...receipt, postId: 999 }) }])('replay rejects mismatched/corrupt receipt %j', async patch => {
    duplicate = true; Object.assign(saved, patch);
    await expect(run()).rejects.toMatchObject({ httpStatus: 409 }); expect(work).not.toHaveBeenCalled();
});
test.each(['missing', 'reassigned', 'membership', 'tenant', 'company-banned'])('rechecks replay authorization for %s', async problem => {
    duplicate = true;
    if (problem === 'missing') post = null;
    if (problem === 'reassigned') post.userId = 8;
    if (problem === 'membership') mockLock.mockResolvedValue({ id: 4 });
    if (problem === 'tenant') saved.companyId = 4;
    if (problem === 'company-banned') mockLock.mockRejectedValue(new Error('Company banned'));
    await expect(run()).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
});
test('hash is invariant to equivalent numeric types/property order and ignored identity/status fields', async () => {
    duplicate = true;
    const equivalent = { ...Object.fromEntries(Object.entries(data).reverse()), userId: '7', amount: 2, timeEnd: 1900000000000,
        isHot: false, statusCode: 'PS1', companyId: 99, idempotencyKey: 'spoof' };
    expect(await run({ data: equivalent })).toEqual({ ...receipt, replayed: true });
});
test('business and finalization failures propagate to the enclosing rollback; no success receipt', async () => {
    work.mockRejectedValueOnce(new Error('outbox failed')); await expect(run()).rejects.toThrow('outbox failed');
    expect(mockDb.sequelize.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    mockDb.sequelize.query.mockImplementationOnce(() => [[{ engine: 'InnoDB' }]])
        .mockResolvedValueOnce([[{ name: 'userId' }, { name: 'requestKey' }]])
        .mockResolvedValueOnce([[{ collationName: 'ascii_bin', keyLength: 128 }]])
        .mockResolvedValueOnce([undefined, 1]).mockResolvedValueOnce([undefined, 0]);
    await expect(run()).rejects.toThrow('Cannot finalize');
});
test('non-duplicate INSERT errors propagate instead of pretending to replay', async () => {
    mockDb.sequelize.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]])
        .mockResolvedValueOnce([[{ name: 'userId' }, { name: 'requestKey' }]])
        .mockResolvedValueOnce([[{ collationName: 'ascii_bin', keyLength: 128 }]])
        .mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(run()).rejects.toThrow('DB unavailable'); expect(work).not.toHaveBeenCalled(); expect(mockLock).not.toHaveBeenCalled();
});
test.each(['missing-primary', 'wrong-order', 'case-insensitive', 'short-key'])('rejects ledger schema %s before claiming', async problem => {
    mockDb.sequelize.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]])
        .mockResolvedValueOnce([problem === 'missing-primary' ? [] : problem === 'wrong-order'
            ? [{ name: 'requestKey' }, { name: 'userId' }] : [{ name: 'userId' }, { name: 'requestKey' }]])
        .mockResolvedValueOnce([[{ collationName: problem === 'case-insensitive' ? 'ascii_general_ci' : 'ascii_bin',
            keyLength: problem === 'short-key' ? 64 : 128 }]]);
    await expect(run()).rejects.toMatchObject({ httpStatus: 503 }); expect(work).not.toHaveBeenCalled();
    expect(mockDb.sequelize.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
});
