const mockDb = {
  sequelize: { query: jest.fn(), transaction: jest.fn() },
  Post: { findOne: jest.fn() },
  User: { findAll: jest.fn() },
  Company: { findOne: jest.fn() },
  Account: { findAll: jest.fn() },
  Cv: { findOne: jest.fn(), create: jest.fn() },
  DetailPost: { findOne: jest.fn() }
};
jest.mock('../../src/models/index', () => mockDb);

const { assertApplicationStorage, submitLegacyApplication } = require('../../src/utils/legacyApplication');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const requiredTables = ['cvs', 'users', 'accounts', 'companies', 'posts', 'detailposts', 'outbox_events'];
const tableRows = () => requiredTables.map(name => ({ name, engine: 'InnoDB' }));
const pairIndex = () => [
  { name: 'unique_cv_pair', col: 'userId', position: 1, prefixLength: null },
  { name: 'unique_cv_pair', col: 'postId', position: 2, prefixLength: null }
];
const validRequest = () => ({ userId: 1, postId: 2, file: 'private PDF bytes', description: 'Tôi muốn ứng tuyển' });
const outboxCalls = () => mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
const expectNoWrites = () => {
  expect(mockDb.Cv.create).not.toHaveBeenCalled();
  expect(outboxCalls()).toHaveLength(0);
};
let post, candidate, owner, company, candidateAccount, ownerAccount;

beforeEach(() => {
  for (const model of Object.values(mockDb)) for (const fn of Object.values(model)) fn.mockReset();
  post = { id: 2, userId: 7, detailPostId: 5, statusCode: 'PS1', timeEnd: String(Date.now() + 60000) };
  candidate = { id: 1, companyId: null, firstName: 'Lan', lastName: 'Nguyễn', email: 'lan@example.test' };
  owner = { id: 7, companyId: 3, firstName: 'Hiring', lastName: 'Manager', email: 'hr@example.test' };
  company = { id: 3, statusCode: 'S1', censorCode: 'CS1' };
  candidateAccount = { id: 11, userId: 1, roleCode: 'CANDIDATE', statusCode: 'S1', phonenumber: '0900000001' };
  ownerAccount = { id: 12, userId: 7, roleCode: 'COMPANY', statusCode: 'S1', phonenumber: '0900000007' };
  mockDb.sequelize.query.mockImplementation(async sql => {
    if (sql.includes('information_schema.TABLES')) return [tableRows()];
    if (sql.includes('information_schema.STATISTICS')) return [pairIndex()];
    return [[]];
  });
  mockDb.sequelize.transaction.mockImplementation(callback => callback(transaction));
  mockDb.Post.findOne.mockImplementation(async () => post);
  mockDb.User.findAll.mockImplementation(async () => [candidate, owner]);
  mockDb.Company.findOne.mockImplementation(async () => company);
  mockDb.Account.findAll.mockImplementation(async () => [candidateAccount, ownerAccount]);
  mockDb.Cv.findOne.mockResolvedValue(null);
  mockDb.Cv.create.mockResolvedValue({ id: 90 });
  mockDb.DetailPost.findOne.mockResolvedValue({ id: 5, name: 'Node Engineer' });
});

describe('assertApplicationStorage', () => {
  test('checks all tables and an exact two-column unique pair in the same transaction', async () => {
    await expect(assertApplicationStorage(transaction)).resolves.toBeUndefined();
    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(2);
    expect(mockDb.sequelize.query).toHaveBeenNthCalledWith(1,
      expect.stringContaining('information_schema.TABLES'),
      { replacements: { tables: requiredTables }, transaction });
    expect(mockDb.sequelize.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('information_schema.STATISTICS'), { transaction });
  });

  test('accepts case-insensitive InnoDB engines and user/post column names regardless of index order', async () => {
    mockDb.sequelize.query.mockResolvedValueOnce([tableRows().reverse().map(row => ({ ...row, engine: 'innodb' }))])
      .mockResolvedValueOnce([[...pairIndex().reverse().map(row => ({ ...row, col: row.col.toUpperCase() })),
        { name: 'another_unique', col: 'id', position: 1, prefixLength: null }]]);
    await expect(assertApplicationStorage(transaction)).resolves.toBeUndefined();
  });

  test.each(requiredTables)('rejects a missing %s table before inspecting indexes', async missing => {
    mockDb.sequelize.query.mockResolvedValueOnce([tableRows().filter(row => row.name !== missing)]);
    await expect(assertApplicationStorage(transaction)).rejects.toMatchObject({ applicationUnavailable: true });
    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(1);
  });

  test.each([null, 'MyISAM', ''])('rejects an unsafe table engine %p', async engine => {
    mockDb.sequelize.query.mockResolvedValueOnce([tableRows().map(row => row.name === 'cvs' ? { ...row, engine } : row)]);
    await expect(assertApplicationStorage(transaction)).rejects.toMatchObject({ applicationUnavailable: true });
    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['no unique index', []],
    ['separate one-column indexes', [{ name: 'one', col: 'userId' }, { name: 'two', col: 'postId' }]],
    ['three-column index', [...pairIndex(), { name: 'unique_cv_pair', col: 'id', position: 3, prefixLength: null }]],
    ['prefix index', [{ ...pairIndex()[0], prefixLength: 10 }, pairIndex()[1]]],
    ['missing post column', [{ ...pairIndex()[0] }, { ...pairIndex()[1], col: 'jobId' }]],
    ['non-string column', [{ ...pairIndex()[0], col: null }, pairIndex()[1]]]
  ])('rejects %s', async (_name, indexes) => {
    mockDb.sequelize.query.mockResolvedValueOnce([tableRows()]).mockResolvedValueOnce([indexes]);
    await expect(assertApplicationStorage(transaction)).rejects.toMatchObject({ applicationUnavailable: true });
  });

  test.each(['tables', 'indexes'])('propagates a failed %s metadata query', async stage => {
    const failure = new Error('metadata unavailable');
    if (stage === 'tables') mockDb.sequelize.query.mockRejectedValueOnce(failure);
    else mockDb.sequelize.query.mockResolvedValueOnce([tableRows()]).mockRejectedValueOnce(failure);
    await expect(assertApplicationStorage(transaction)).rejects.toBe(failure);
  });
});

describe('submitLegacyApplication input and request stability', () => {
  const invalidIds = [null, undefined, '', '0', 0, -1, 1.5, '01', ' 1', '1e0', true, {}, [], Number.MAX_SAFE_INTEGER + 1];
  test.each(invalidIds)('rejects invalid candidate ID %p without database work', async userId => {
    await expect(submitLegacyApplication({ ...validRequest(), userId })).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expect(mockDb.Post.findOne).not.toHaveBeenCalled();
  });
  test.each(invalidIds)('rejects invalid job ID %p without database work', async postId => {
    await expect(submitLegacyApplication({ ...validRequest(), postId })).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expect(mockDb.Post.findOne).not.toHaveBeenCalled();
  });
  test.each([undefined, null, '', ' \n\t ', 3, {}, []])('rejects missing or invalid PDF data %p', async file => {
    await expect(submitLegacyApplication({ ...validRequest(), file })).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expect(mockDb.Post.findOne).not.toHaveBeenCalled();
  });
  test.each([undefined, null, '', ' \n\t ', 3, {}, [], 'a'.repeat(256), '😀'.repeat(256)])
  ('rejects invalid cover letter %p before reading the job', async description => {
    await expect(submitLegacyApplication({ ...validRequest(), description })).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expect(mockDb.Post.findOne).not.toHaveBeenCalled();
  });

  test.each(['a', 'a'.repeat(255), '😀'.repeat(255)])('accepts cover letter boundary %p', async description => {
    await expect(submitLegacyApplication({ ...validRequest(), description })).resolves.toMatchObject({ errCode: 0 });
    expect(mockDb.Cv.create).toHaveBeenCalledWith(expect.objectContaining({ description }), { transaction });
  });

  test('keeps the validated request values if the caller reuses its body while the first read is pending', async () => {
    let finishLookup;
    mockDb.Post.findOne.mockImplementationOnce(() => new Promise(resolve => { finishLookup = resolve; }))
      .mockImplementation(async () => post);
    const request = validRequest();
    const pending = submitLegacyApplication(request);
    request.userId = 99;
    request.postId = 98;
    request.file = 'changed PDF';
    request.description = 'changed letter';
    finishLookup(post);

    await expect(pending).resolves.toMatchObject({ errCode: 0, cvId: 90 });
    expect(mockDb.User.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: [1, 7] } }));
    expect(mockDb.Cv.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1, postId: 2 } }));
    expect(mockDb.Cv.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, postId: 2,
      file: 'private PDF bytes', description: 'Tôi muốn ứng tuyển' }), { transaction });
  });
});

describe('submitLegacyApplication authorization and current job state', () => {
  test('returns 404 before a transaction if the requested job does not exist', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 3, httpStatus: 404 });
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test.each([
    ['candidate missing', () => { candidate = null; }],
    ['owner missing', () => { owner = null; }],
    ['owner not in a company', () => { owner.companyId = null; }]
  ])('does not apply when %s', async (_name, arrange) => {
    arrange();
    mockDb.User.findAll.mockImplementation(async () => [candidate, owner].filter(Boolean));
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 3, httpStatus: 404 });
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test.each([
    ['candidate account missing', () => { candidateAccount = null; }],
    ['candidate account disabled', () => { candidateAccount.statusCode = 'S2'; }],
    ['admin role', () => { candidateAccount.roleCode = 'ADMIN'; }],
    ['company role', () => { candidateAccount.roleCode = 'COMPANY'; }],
    ['employer role', () => { candidateAccount.roleCode = 'EMPLOYER'; }]
  ])('rejects %s under account lock', async (_name, arrange) => {
    arrange();
    mockDb.Account.findAll.mockImplementation(async () => [candidateAccount, ownerAccount].filter(Boolean));
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 3, httpStatus: 403 });
    expect(mockDb.Cv.findOne).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test('returns the existing CV ID and does not reread the job for a duplicate', async () => {
    mockDb.Cv.findOne.mockResolvedValue({ id: 44 });
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 5, httpStatus: 409, cvId: 44 });
    expect(mockDb.Post.findOne).toHaveBeenCalledTimes(1);
    expectNoWrites();
  });

  test.each([
    ['deleted under lock', () => mockDb.Post.findOne.mockResolvedValueOnce(post).mockResolvedValueOnce(null)],
    ['owner changed under lock', () => mockDb.Post.findOne.mockResolvedValueOnce(post).mockResolvedValueOnce({ ...post, userId: 8 })],
    ['pending moderation', () => { post.statusCode = 'PS3'; }],
    ['rejected moderation', () => { post.statusCode = 'PS2'; }],
    ['banned job', () => { post.statusCode = 'PS4'; }],
    ['inactive company', () => { company.statusCode = 'S2'; }],
    ['unapproved company', () => { company.censorCode = 'CS2'; }],
    ['missing company', () => { company = null; }],
    ['owner account missing', () => { ownerAccount = null; }],
    ['owner account disabled', () => { ownerAccount.statusCode = 'S2'; }]
  ])('rejects %s using locked rows before writing', async (_name, arrange) => {
    arrange();
    mockDb.Account.findAll.mockImplementation(async () => [candidateAccount, ownerAccount].filter(Boolean));
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 3, httpStatus: 404 });
    expectNoWrites();
  });

  test('rejects a post with no current detail row', async () => {
    mockDb.DetailPost.findOne.mockResolvedValue(null);
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 3, httpStatus: 404 });
    expectNoWrites();
  });

  test.each([null, undefined, 'invalid', '1e3', '0', String(Date.now() - 1)])
  ('rejects an invalid or expired deadline %p', async timeEnd => {
    post.timeEnd = timeEnd;
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 4, httpStatus: 409 });
    expectNoWrites();
  });

  test('accepts expiry exactly at the application clock and rejects one millisecond earlier', async () => {
    const now = 1900000000000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      post.timeEnd = String(now);
      await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 0, cvId: 90 });
      mockDb.Cv.create.mockClear();
      mockDb.sequelize.query.mockClear();
      post.timeEnd = String(now - 1);
      await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 4, httpStatus: 409 });
      expectNoWrites();
    } finally { clock.mockRestore(); }
  });
});

describe('submitLegacyApplication transaction and event', () => {
  test('locks users in ID order, then company, accounts, duplicate pair, job and detail', async () => {
    const request = { ...validRequest(), userId: '9', postId: '2' };
    candidate.id = 9;
    candidateAccount.userId = 9;
    mockDb.User.findAll.mockImplementation(async () => [owner, candidate]);

    await expect(submitLegacyApplication(request)).resolves.toMatchObject({ errCode: 0 });

    expect(mockDb.Post.findOne).toHaveBeenNthCalledWith(1, { where: { id: '2' }, attributes: ['id', 'userId'], raw: true });
    expect(mockDb.User.findAll).toHaveBeenCalledWith({ where: { id: [7, 9] },
      attributes: ['id', 'companyId', 'firstName', 'lastName', 'email'], order: [['id', 'ASC']],
      transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith({ where: { id: 3 },
      attributes: ['id', 'statusCode', 'censorCode'], transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.Account.findAll).toHaveBeenCalledWith({ where: { userId: [7, 9] },
      attributes: ['id', 'userId', 'roleCode', 'statusCode', 'phonenumber'],
      order: [['userId', 'ASC'], ['id', 'ASC']], transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.Cv.findOne).toHaveBeenCalledWith({ where: { userId: 9, postId: 2 },
      attributes: ['id'], transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.Post.findOne).toHaveBeenNthCalledWith(2, { where: { id: '2' },
      attributes: ['id', 'userId', 'detailPostId', 'statusCode', 'timeEnd'],
      transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.DetailPost.findOne).toHaveBeenCalledWith({ where: { id: 5 },
      attributes: ['id', 'name'], transaction, lock: 'UPDATE', raw: true });
    const order = [mockDb.User.findAll, mockDb.Company.findOne, mockDb.Account.findAll,
      mockDb.Cv.findOne, mockDb.Post.findOne, mockDb.DetailPost.findOne];
    for (let i = 1; i < order.length; i++) {
      const previous = order[i - 1] === mockDb.Post.findOne
        ? mockDb.Post.findOne.mock.invocationCallOrder[1] : order[i - 1].mock.invocationCallOrder[0];
      const current = order[i] === mockDb.Post.findOne
        ? mockDb.Post.findOne.mock.invocationCallOrder[1] : order[i].mock.invocationCallOrder[0];
      expect(previous).toBeLessThan(current);
    }
  });

  test('writes a private CV and a public event in one transaction from locked rows', async () => {
    const request = { ...validRequest(), candidateName: 'Forged', companyId: 100,
      jobTitle: 'Forged job', posterId: 100, candidateEmail: 'forged@example.test' };
    await expect(submitLegacyApplication(request)).resolves.toEqual({
      errCode: 0, cvId: 90, errMessage: 'Đã gửi CV thành công'
    });

    expect(mockDb.Cv.create).toHaveBeenCalledTimes(1);
    const [cv, options] = mockDb.Cv.create.mock.calls[0];
    expect(options).toEqual({ transaction });
    expect(cv).toMatchObject({ userId: 1, postId: 2, file: 'private PDF bytes',
      description: 'Tôi muốn ứng tuyển', isChecked: 0 });
    expect(cv.createdAt).toBeInstanceOf(Date);
    expect(cv.updatedAt).toBe(cv.createdAt);

    expect(outboxCalls()).toHaveLength(1);
    const [sql, insert] = outboxCalls()[0];
    expect(sql).toContain('INSERT INTO outbox_events');
    expect(insert.transaction).toBe(transaction);
    expect(insert.replacements.slice(1, 4)).toEqual(['legacy-application', '90', 'application.submitted']);
    expect(insert.replacements[0]).toMatch(/^[a-f0-9-]{36}$/);
    expect(insert.replacements[5]).toBe(cv.createdAt);
    expect(JSON.parse(insert.replacements[4])).toMatchObject({ cvId: 90, jobId: 2,
      jobTitle: 'Node Engineer', candidateId: 1, candidateName: 'Lan Nguyễn',
      candidateEmail: 'lan@example.test', candidatePhone: '0900000001',
      companyId: 3, posterId: 7, coverLetter: 'Tôi muốn ứng tuyển',
      appliedAt: cv.createdAt.toISOString() });
    expect(insert.replacements[4]).not.toContain('private PDF bytes');
    expect(insert.replacements[4]).not.toContain('Forged');
  });

  test('uses null for optional candidate contact fields when locked rows have none', async () => {
    candidate.firstName = '';
    candidate.lastName = null;
    candidate.email = null;
    candidateAccount.phonenumber = null;
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 0 });
    expect(JSON.parse(outboxCalls()[0][1].replacements[4])).toMatchObject({
      candidateName: null, candidateEmail: null, candidatePhone: null
    });
  });

  test('maps an insert race to the stable duplicate response', async () => {
    const conflict = Object.assign(new Error('duplicate pair'), { name: 'SequelizeUniqueConstraintError' });
    mockDb.Cv.create.mockRejectedValue(conflict);
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 5, httpStatus: 409 });
    expect(outboxCalls()).toHaveLength(0);
  });

  test.each([null, {}, { id: null }])('treats missing saved CV identity %p as service unavailable', async row => {
    mockDb.Cv.create.mockResolvedValue(row);
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 2, httpStatus: 503 });
    expect(outboxCalls()).toHaveLength(0);
  });

  test.each(['table metadata', 'index metadata'])('returns 503 when %s is unsafe', async stage => {
    if (stage === 'table metadata') mockDb.sequelize.query.mockResolvedValueOnce([[]]);
    else mockDb.sequelize.query.mockResolvedValueOnce([tableRows()]).mockResolvedValueOnce([[]]);
    await expect(submitLegacyApplication(validRequest())).resolves.toMatchObject({ errCode: 2, httpStatus: 503 });
    expect(mockDb.User.findAll).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test.each(['initial lookup', 'transaction', 'schema query', 'users', 'company', 'accounts', 'duplicate lookup',
    'locked post', 'detail', 'cv insert', 'outbox insert', 'commit'])
  ('propagates an unexpected %s failure instead of returning success', async stage => {
    const failure = new Error('synthetic failure');
    if (stage === 'initial lookup') mockDb.Post.findOne.mockRejectedValueOnce(failure);
    if (stage === 'transaction') mockDb.sequelize.transaction.mockRejectedValueOnce(failure);
    if (stage === 'schema query') mockDb.sequelize.query.mockRejectedValueOnce(failure);
    if (stage === 'users') mockDb.User.findAll.mockRejectedValueOnce(failure);
    if (stage === 'company') mockDb.Company.findOne.mockRejectedValueOnce(failure);
    if (stage === 'accounts') mockDb.Account.findAll.mockRejectedValueOnce(failure);
    if (stage === 'duplicate lookup') mockDb.Cv.findOne.mockRejectedValueOnce(failure);
    if (stage === 'locked post') mockDb.Post.findOne.mockResolvedValueOnce(post).mockRejectedValueOnce(failure);
    if (stage === 'detail') mockDb.DetailPost.findOne.mockRejectedValueOnce(failure);
    if (stage === 'cv insert') mockDb.Cv.create.mockRejectedValueOnce(failure);
    if (stage === 'outbox insert') {
      const query = mockDb.sequelize.query.getMockImplementation();
      mockDb.sequelize.query.mockImplementation((sql, options) => sql.includes('INSERT INTO outbox_events')
        ? Promise.reject(failure) : query(sql, options));
    }
    if (stage === 'commit') mockDb.sequelize.transaction.mockImplementationOnce(async work => {
      await work(transaction);
      throw failure;
    });

    await expect(submitLegacyApplication(validRequest())).rejects.toBe(failure);
    if (['initial lookup', 'transaction', 'schema query', 'users', 'company', 'accounts',
      'duplicate lookup', 'locked post', 'detail', 'cv insert'].includes(stage)) expect(outboxCalls()).toHaveLength(0);
  });
});
