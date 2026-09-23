const model = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
const mockDb = {
  Post: model(), DetailPost: model(), User: model(), Company: model(), Note: model(),
  sequelize: { transaction: jest.fn(), query: jest.fn() }
};

jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/postingQuota', () => ({
  ...jest.requireActual('../../src/utils/postingQuota'),
  assertTransactionalPostingTables: jest.fn()
}));
jest.mock('../../src/utils/moderationFence', () => ({ cancelLegacyModeration: jest.fn() }));
jest.mock('../../src/utils/legacyOutbox', () => ({ enqueueLegacyJobUpdated: jest.fn() }));
jest.mock('../../src/utils/manualModerationOutbox', () => ({ enqueueManualModerationNotifications: jest.fn() }));

const { moderateLegacyPost: moderate } = require('../../src/utils/jobModeration');
const { jobRevision } = require('../../src/utils/jobRevision');
const { assertTransactionalPostingTables, PostingQuotaError } = require('../../src/utils/postingQuota');
const { cancelLegacyModeration } = require('../../src/utils/moderationFence');
const { enqueueLegacyJobUpdated } = require('../../src/utils/legacyOutbox');
const { enqueueManualModerationNotifications } = require('../../src/utils/manualModerationOutbox');

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const admin = { roleCode: 'ADMIN' };
const now = 1800000000000;
let post, detail, owner, company, body;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  post = {
    id: 10, userId: 7, detailPostId: 20, statusCode: 'PS3', isHot: 1,
    timePost: '1700000000000', timeEnd: '1900000000000', save: jest.fn().mockResolvedValue(undefined)
  };
  detail = {
    id: 20, name: 'Kỹ sư Node.js', descriptionHTML: '<p>Nội dung đã lưu</p>', descriptionMarkdown: 'Nội dung đã lưu',
    amount: 2, categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1',
    categoryJoblevelCode: 'JL1', categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1'
  };
  owner = { id: 7, companyId: 4 };
  company = {
    id: 4, name: 'Công ty đã lưu', thumbnail: 'logo.png', statusCode: 'S1', censorCode: 'CS1',
    allowPost: 8, allowHotPost: 3, allowCv: 10, allowCvFree: 2, save: jest.fn()
  };
  body = { id: 10, postId: 10, userId: 1, note: 'Cần bổ sung mô tả', expectedRevision: jobRevision(post, detail) };
  mockDb.sequelize.transaction.mockImplementation(work => work(transaction));
  mockDb.sequelize.query.mockResolvedValue([[{ engine: 'InnoDB' }]]);
  mockDb.Post.findOne.mockImplementation(async ({ raw }) => raw ? { id: post.id, userId: post.userId } : post);
  mockDb.User.findAll.mockResolvedValue([{ id: 1, companyId: null }, owner]);
  mockDb.Company.findOne.mockResolvedValue(company);
  mockDb.DetailPost.findOne.mockResolvedValue(detail);
});

afterEach(() => jest.restoreAllMocks());

const expectNoWrites = () => {
  expect(post.save).not.toHaveBeenCalled();
  expect(company.save).not.toHaveBeenCalled();
  expect(mockDb.Note.create).not.toHaveBeenCalled();
  expect(cancelLegacyModeration).not.toHaveBeenCalled();
  expect(enqueueLegacyJobUpdated).not.toHaveBeenCalled();
  expect(enqueueManualModerationNotifications).not.toHaveBeenCalled();
};

const expectNoDatabaseWork = () => {
  expectNoWrites();
  expect(mockDb.Post.findOne).not.toHaveBeenCalled();
  expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
  expect(mockDb.sequelize.query).not.toHaveBeenCalled();
  expect(mockDb.User.findAll).not.toHaveBeenCalled();
  expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  expect(mockDb.DetailPost.findOne).not.toHaveBeenCalled();
};

const setStatus = statusCode => {
  post.statusCode = statusCode;
  body.expectedRevision = jobRevision(post, detail);
};

describe('moderateLegacyPost request stability', () => {
  test('keeps the validated revision when the caller reuses the request object during a lookup', async () => {
    mockDb.Post.findOne.mockImplementationOnce(async () => {
      body.expectedRevision = 'jv1-' + '0'.repeat(64);
      return { id: post.id, userId: post.userId };
    });

    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 0, changed: true, statusCode: 'PS2' });
    expect(mockDb.Note.create).toHaveBeenCalledWith({ postId: 10, note: 'Cần bổ sung mô tả', userId: 1 }, { transaction });
  });

  test('keeps the validated actor when the caller reuses the request object before acquiring user locks', async () => {
    mockDb.User.findAll.mockResolvedValue([{ id: 1 }, owner, { id: 99 }]);
    mockDb.Post.findOne.mockImplementationOnce(async () => {
      body.userId = 99;
      return { id: post.id, userId: post.userId };
    });

    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 0, changed: true });
    expect(mockDb.User.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: [1, 7] } }));
    expect(mockDb.Note.create).toHaveBeenCalledWith({ postId: 10, note: 'Cần bổ sung mô tả', userId: 1 }, { transaction });
  });

  test('attributes the note to the validated actor if the caller changes userId during save', async () => {
    post.save.mockImplementationOnce(async () => { body.userId = 99; });

    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 0, changed: true });
    expect(mockDb.Note.create).toHaveBeenCalledWith({ postId: 10, note: 'Cần bổ sung mô tả', userId: 1 }, { transaction });
  });
});

describe('moderateLegacyPost validation', () => {
  test.each([undefined, {}, { roleCode: 'COMPANY' }, { roleCode: 'EMPLOYER' }, { roleCode: 'CANDIDATE' }, { roleCode: 'admin' }])
  ('rejects untrusted identity %p even when the body claims ADMIN', async identity => {
    body.roleCode = 'ADMIN';
    await expect(moderate(body, 'approve', identity)).resolves.toMatchObject({ errCode: 3, httpStatus: 403 });
    expectNoDatabaseWork();
  });

  test.each(['invalid', '', undefined, null, '__proto__', 'constructor', 'toString'])
  ('rejects unknown or inherited action %p before querying', async action => {
    await expect(moderate(body, action, admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  const invalidIds = [undefined, null, '', 0, -1, 1.5, true, false, {}, [], '01', ' 1 ', '1e3', '1.0', '../1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
  test.each(invalidIds.map(value => [value]))('rejects invalid post id %p', async id => {
    await expect(moderate({ ...body, id }, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test.each(invalidIds.map(value => [value]))('rejects invalid moderator id %p', async userId => {
    await expect(moderate({ ...body, userId }, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test('ban requires postId and cannot substitute the unrelated id field', async () => {
    delete body.postId;
    await expect(moderate(body, 'ban', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test('other actions require id and cannot substitute postId', async () => {
    delete body.id;
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test('requires a revision before starting any database work', async () => {
    delete body.expectedRevision;
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 428 });
    expectNoDatabaseWork();
  });

  test.each([null, '', {}, [], true, 1, 'jv2-' + 'a'.repeat(64), 'jv1-' + 'A'.repeat(64), 'jv1-' + 'a'.repeat(63), 'jv1-' + 'a'.repeat(65)])
  ('rejects malformed revision %p before querying', async expectedRevision => {
    await expect(moderate({ ...body, expectedRevision }, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test.each([undefined, null, '', ' \n\t ', 0, true, {}, [], 'a'.repeat(256), '😀'.repeat(256)])
  ('rejects an invalid rejection reason %p', async note => {
    await expect(moderate({ ...body, note }, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test.each([['ban', 'PS1'], ['reopen', 'PS4']])('%s also requires a nonblank reason', async (action, status) => {
    setStatus(status);
    await expect(moderate({ ...body, note: ' ' }, action, admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 400 });
    expectNoDatabaseWork();
  });

  test.each(['a', 'a'.repeat(255), '😀'.repeat(255), '  Lý do giữ nguyên khoảng trắng  '])
  ('accepts and preserves a valid Unicode reason %p', async note => {
    await expect(moderate({ ...body, note }, 'reject', admin)).resolves.toMatchObject({ errCode: 0, changed: true });
    expect(mockDb.Note.create).toHaveBeenCalledWith({ postId: 10, userId: 1, note }, { transaction });
  });

  test.each([undefined, null, '', {}, 'a'.repeat(256)])('approval uses its fixed reason regardless of submitted note %p', async note => {
    await expect(moderate({ ...body, note }, 'approve', admin)).resolves.toMatchObject({ errCode: 0, changed: true });
    expect(mockDb.Note.create).toHaveBeenCalledWith({ postId: 10, userId: 1, note: 'Đã duyệt bài thành công' }, { transaction });
  });

  test.each([['reject', 'id'], ['ban', 'postId']])('accepts canonical string IDs for %s and normalizes the audit actor', async (action, field) => {
    body[field] = '10'; body.userId = '1';
    await expect(moderate(body, action, admin)).resolves.toMatchObject({ errCode: 0, changed: true });
    expect(mockDb.Post.findOne).toHaveBeenNthCalledWith(1, { where: { id: '10' }, attributes: ['id', 'userId'], raw: true });
    expect(mockDb.User.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: [1, 7] } }));
    expect(mockDb.Note.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }), { transaction });
  });
});

describe('moderateLegacyPost transitions and effects', () => {
  test.each([
    ['approve', 'PS2', 'PS1', 'Duyệt bài thành công'],
    ['approve', 'PS3', 'PS1', 'Duyệt bài thành công'],
    ['reject', 'PS3', 'PS2', 'Đã từ chối bài thành công'],
    ['ban', 'PS1', 'PS4', 'Đã chặn bài viết thành công'],
    ['ban', 'PS2', 'PS4', 'Đã chặn bài viết thành công'],
    ['ban', 'PS3', 'PS4', 'Đã chặn bài viết thành công'],
    ['reopen', 'PS4', 'PS3', 'Đã mở lại trạng thái chờ duyệt']
  ])('%s transitions %s to %s atomically while preserving content and allowances', async (action, from, target, message) => {
    setStatus(from);
    const previousPost = { ...post }, previousDetail = { ...detail }, previousCompany = { ...company };
    const note = action === 'approve' ? 'Đã duyệt bài thành công' : body.note;
    const result = await moderate(body, action, admin);

    expect(result).toEqual({ errCode: 0, changed: true, postId: 10, statusCode: target,
      editRevision: jobRevision(post, detail), errMessage: message });
    expect(result.editRevision).not.toBe(body.expectedRevision);
    expect(post).toEqual({ ...previousPost, statusCode: target, ...(action === 'approve' && { timePost: now }) });
    expect(detail).toEqual(previousDetail);
    expect(company).toEqual(previousCompany);
    expect(company.save).not.toHaveBeenCalled();
    expect(mockDb.Post.create).not.toHaveBeenCalled();
    expect(mockDb.DetailPost.create).not.toHaveBeenCalled();
    expect(post.save).toHaveBeenCalledTimes(1);
    expect(post.save).toHaveBeenCalledWith({ transaction, fields: action === 'approve'
      ? ['statusCode', 'updatedAt', 'timePost'] : ['statusCode', 'updatedAt'] });
    expect(cancelLegacyModeration).toHaveBeenCalledTimes(1);
    expect(cancelLegacyModeration).toHaveBeenCalledWith(10, transaction);
    expect(mockDb.Note.create).toHaveBeenCalledTimes(1);
    expect(mockDb.Note.create).toHaveBeenCalledWith({ postId: 10, userId: 1, note }, { transaction });
    expect(enqueueLegacyJobUpdated).toHaveBeenCalledTimes(1);
    expect(enqueueLegacyJobUpdated).toHaveBeenCalledWith({ post, detail, owner, company }, transaction);
    expect(enqueueManualModerationNotifications).toHaveBeenCalledTimes(1);
    expect(enqueueManualModerationNotifications).toHaveBeenCalledWith({
      action, postId: 10, posterId: 7, timeEnd: previousPost.timeEnd,
      companyStatusCode: 'S1', companyCensorCode: 'CS1', companyId: 4, companyName: company.name,
      jobTitle: detail.name, note
    }, transaction);
    const writeOrder = [cancelLegacyModeration, post.save, mockDb.Note.create, enqueueLegacyJobUpdated, enqueueManualModerationNotifications]
      .map(fn => fn.mock.invocationCallOrder[0]);
    expect(writeOrder).toEqual([...writeOrder].sort((a, b) => a - b));
  });

  const targets = [['approve', 'PS1'], ['reject', 'PS2'], ['ban', 'PS4'], ['reopen', 'PS3']];
  test.each(targets)('%s at target %s is a no-op with a matching revision and creates no duplicate effects', async (action, status) => {
    setStatus(status);
    const previous = { ...post };
    await expect(moderate(body, action, admin)).resolves.toEqual({ errCode: 0, changed: false, statusCode: status,
      editRevision: body.expectedRevision, errMessage: 'Trạng thái tin không thay đổi' });
    expect(post).toEqual(previous);
    expectNoWrites();
  });

  test.each(targets)('%s at target %s still rejects a stale revision before treating it as a no-op', async (action, status) => {
    setStatus(status);
    body.expectedRevision = 'jv1-' + '0'.repeat(64);
    await expect(moderate(body, action, admin)).resolves.toMatchObject({ errCode: 4, httpStatus: 409, conflict: true });
    expectNoWrites();
  });

  test.each([
    ['approve', 'PS4'], ['reject', 'PS1'], ['reject', 'PS4'], ['reopen', 'PS1'], ['reopen', 'PS2'],
    ...['approve', 'reject', 'ban', 'reopen'].flatMap(action => ['PS0', '', null, undefined].map(status => [action, status]))
  ])('refuses invalid transition %s from %p', async (action, status) => {
    setStatus(status);
    await expect(moderate(body, action, admin)).resolves.toMatchObject({ errCode: 4, httpStatus: 409, conflict: true });
    expectNoWrites();
  });

  test.each(['description', 'expiry', 'hotFlag'])('a changed %s invalidates the reviewed revision', async change => {
    if (change === 'description') detail.descriptionHTML = '<p>Nội dung mới</p>';
    if (change === 'expiry') post.timeEnd = '1950000000000';
    if (change === 'hotFlag') post.isHot = 0;
    await expect(moderate(body, 'approve', admin)).resolves.toMatchObject({ errCode: 4, httpStatus: 409, conflict: true });
    expectNoWrites();
  });

  test('uses action-specific post IDs and ignores forged ownership, content and eligibility fields', async () => {
    Object.assign(body, { id: 99, roleCode: 'CANDIDATE', companyId: 99, companyName: 'Forged',
      companyStatusCode: 'S2', companyCensorCode: 'CS2', posterId: 99, name: 'Forged title',
      detailPostId: 99, isHot: 0, timeEnd: '1', timePost: '1', statusCode: 'PS1', allowPost: 999 });
    await expect(moderate(body, 'ban', admin)).resolves.toMatchObject({ errCode: 0, postId: 10, statusCode: 'PS4' });
    expect(mockDb.Post.findOne).toHaveBeenNthCalledWith(1, { where: { id: 10 }, attributes: ['id', 'userId'], raw: true });
    expect(enqueueManualModerationNotifications).toHaveBeenCalledWith(expect.objectContaining({
      posterId: 7, companyId: 4, companyName: company.name, companyStatusCode: 'S1', companyCensorCode: 'CS1',
      jobTitle: detail.name, timeEnd: '1900000000000'
    }), transaction);
    expect(post).toMatchObject({ userId: 7, detailPostId: 20, isHot: 1, timePost: '1700000000000', timeEnd: '1900000000000' });
    expect(company.allowPost).toBe(8);
  });
});

describe('moderateLegacyPost locked context', () => {
  test.each([[1, 7, [1, 7]], [9, 7, [7, 9]], [7, 7, [7]]])
  ('locks actor %s and owner %s in sorted, deduplicated order before company, post and detail', async (actorId, ownerId, ids) => {
    body.userId = actorId;
    mockDb.User.findAll.mockResolvedValue(actorId === ownerId ? [owner] : [{ id: actorId }, owner]);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 0, changed: true });
    expect(assertTransactionalPostingTables).toHaveBeenCalledWith(transaction);
    expect(mockDb.sequelize.query).toHaveBeenCalledWith(expect.stringContaining("TABLE_NAME = 'notes'"), { transaction });
    expect(mockDb.User.findAll).toHaveBeenCalledWith({ where: { id: ids }, attributes: ['id', 'companyId'],
      order: [['id', 'ASC']], transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith({ where: { id: 4 },
      attributes: ['id', 'name', 'thumbnail', 'statusCode', 'censorCode'], transaction, lock: 'UPDATE', raw: true });
    expect(mockDb.Post.findOne).toHaveBeenNthCalledWith(2, { where: { id: 10 }, transaction, lock: 'UPDATE', raw: false });
    expect(mockDb.DetailPost.findOne).toHaveBeenCalledWith({ where: { id: 20 }, transaction, lock: 'UPDATE', raw: true });
    const lockOrder = [mockDb.User.findAll.mock.invocationCallOrder[0], mockDb.Company.findOne.mock.invocationCallOrder[0],
      mockDb.Post.findOne.mock.invocationCallOrder[1], mockDb.DetailPost.findOne.mock.invocationCallOrder[0]];
    expect(lockOrder).toEqual([...lockOrder].sort((a, b) => a - b));
  });

  test('returns 404 without opening a transaction when the initial post is missing', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 2, httpStatus: 404 });
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test('returns 404 if the post is deleted before its row lock is acquired', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, userId: 7 }).mockResolvedValueOnce(null);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 2, httpStatus: 404 });
    expect(mockDb.DetailPost.findOne).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test('returns 403 when the moderator no longer exists, before taking company or post locks', async () => {
    mockDb.User.findAll.mockResolvedValue([owner]);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 3, httpStatus: 403 });
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
    expect(mockDb.Post.findOne).toHaveBeenCalledTimes(1);
    expectNoWrites();
  });

  test('rejects an ownership change between the initial lookup and locked read', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, userId: 8 }).mockResolvedValueOnce(post);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 4, httpStatus: 409, conflict: true });
    expect(mockDb.DetailPost.findOne).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test('rejects a post whose locked detail row is missing', async () => {
    mockDb.DetailPost.findOne.mockResolvedValue(null);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 4, httpStatus: 409, conflict: true });
    expectNoWrites();
  });

  test.each(['missingOwner', 'noCompanyMembership', 'missingCompany', 'bannedCompany', 'unapprovedCompany'])
  ('allows the admin decision with %s and passes the locked eligibility context to the notification helper', async problem => {
    let expectedCompany = company;
    let expectedOwner = owner;
    if (problem === 'missingOwner') {
      mockDb.User.findAll.mockResolvedValue([{ id: 1 }]); expectedOwner = undefined; expectedCompany = null;
    }
    if (problem === 'noCompanyMembership') { owner.companyId = null; expectedCompany = null; }
    if (problem === 'missingCompany') { mockDb.Company.findOne.mockResolvedValue(null); expectedCompany = null; }
    if (problem === 'bannedCompany') company.statusCode = 'S2';
    if (problem === 'unapprovedCompany') company.censorCode = 'CS2';
    await expect(moderate(body, 'approve', admin)).resolves.toMatchObject({ errCode: 0, changed: true, statusCode: 'PS1' });
    expect(enqueueLegacyJobUpdated).toHaveBeenCalledWith({ post, detail, owner: expectedOwner, company: expectedCompany }, transaction);
    expect(enqueueManualModerationNotifications).toHaveBeenCalledWith(expect.objectContaining({
      companyId: expectedOwner?.companyId ?? null, companyName: expectedCompany?.name ?? null,
      companyStatusCode: expectedCompany?.statusCode ?? null, companyCensorCode: expectedCompany?.censorCode ?? null
    }), transaction);
    if (!expectedOwner?.companyId) expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  });
});

describe('moderateLegacyPost transactional failures', () => {
  test.each([[], [{ engine: 'MyISAM' }], [{ engine: null }], [{ engine: 'InnoDB' }, { engine: 'InnoDB' }]].map(tables => [tables]))
  ('rejects unsafe or ambiguous note-table metadata %p before acquiring entity locks', async tables => {
    mockDb.sequelize.query.mockResolvedValueOnce([tables]);
    await expect(moderate(body, 'reject', admin)).resolves.toMatchObject({ errCode: 1, httpStatus: 503 });
    expect(mockDb.User.findAll).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test('translates unsafe posting tables into 503 without checking notes or performing writes', async () => {
    assertTransactionalPostingTables.mockRejectedValueOnce(new PostingQuotaError('Posting tables unavailable'));
    await expect(moderate(body, 'reject', admin)).resolves.toEqual({ errCode: 1, httpStatus: 503, errMessage: 'Posting tables unavailable' });
    expect(mockDb.sequelize.query).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test.each(['fence', 'searchOutbox', 'notificationOutbox'])('translates a transactional safety error from %s into 503', async stage => {
    const helpers = { fence: cancelLegacyModeration, searchOutbox: enqueueLegacyJobUpdated, notificationOutbox: enqueueManualModerationNotifications };
    helpers[stage].mockRejectedValueOnce(new PostingQuotaError('Transactional storage unavailable'));
    await expect(moderate(body, 'reject', admin)).resolves.toEqual({ errCode: 1, httpStatus: 503, errMessage: 'Transactional storage unavailable' });
  });

  test.each(['initialLookup', 'transactionStart', 'postingTables', 'noteMetadata', 'users', 'company', 'lockedPost', 'detail',
    'fence', 'save', 'note', 'searchOutbox', 'notificationOutbox', 'commit'])
  ('propagates %s failure without reporting success or starting later effects', async stage => {
    const error = new Error(`Synthetic ${stage} failure`);
    const fail = fn => fn.mockRejectedValueOnce(error);
    const setup = {
      initialLookup: () => fail(mockDb.Post.findOne), transactionStart: () => fail(mockDb.sequelize.transaction),
      postingTables: () => fail(assertTransactionalPostingTables), noteMetadata: () => fail(mockDb.sequelize.query),
      users: () => fail(mockDb.User.findAll), company: () => fail(mockDb.Company.findOne),
      lockedPost: () => mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, userId: 7 }).mockRejectedValueOnce(error),
      detail: () => fail(mockDb.DetailPost.findOne), fence: () => fail(cancelLegacyModeration),
      save: () => fail(post.save), note: () => fail(mockDb.Note.create), searchOutbox: () => fail(enqueueLegacyJobUpdated),
      notificationOutbox: () => fail(enqueueManualModerationNotifications),
      commit: () => mockDb.sequelize.transaction.mockImplementationOnce(async work => { await work(transaction); throw error; })
    };
    setup[stage]();
    await expect(moderate(body, 'reject', admin)).rejects.toBe(error);
    // These mocks prove transaction participation and rejection propagation, not real SQL rollback.
    const effects = [cancelLegacyModeration, post.save, mockDb.Note.create, enqueueLegacyJobUpdated, enqueueManualModerationNotifications];
    const failedEffect = ['fence', 'save', 'note', 'searchOutbox', 'notificationOutbox'].indexOf(stage);
    if (stage !== 'commit') for (const effect of effects.slice(failedEffect + 1)) expect(effect).not.toHaveBeenCalled();
  });
});
