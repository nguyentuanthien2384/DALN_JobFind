const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(),
  update: jest.fn(), bulkCreate: jest.fn()
});
const mockDb = {
  User: model(), Company: model(), DetailPost: model(), Post: model(), Note: model(),
  FollowCompany: model(), Notification: model(), UserSkill: model(), Skill: model(), UserSetting: model(),
  Allcode: {},
  Sequelize: { where: jest.fn(() => 'where') },
  sequelize: { col: jest.fn(() => 'col'), fn: jest.fn(() => 'fn'), literal: jest.fn(() => 'literal'), query: jest.fn(), transaction: jest.fn() }
};
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockSendMail = jest.fn();

jest.mock('../../src/models/index', () => mockDb);
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const service = require('../../src/services/postService');
const { jobRevision } = require('../../src/utils/jobRevision');

const reset = () => {
  for (const item of Object.values(mockDb)) {
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  mockDb.Sequelize.where.mockReturnValue('where');
  mockDb.sequelize.col.mockReturnValue('col');
  mockDb.sequelize.fn.mockReturnValue('fn');
  mockDb.sequelize.literal.mockReturnValue('literal');
  mockDb.sequelize.query.mockImplementation(sql => Promise.resolve(sql.includes("TABLE_NAME = 'outbox_events'")
    ? [[{ engine: 'InnoDB' }]] : [['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }))]));
  mockDb.sequelize.transaction.mockImplementation(work => work(mockTransaction));
  mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 4 }]);
  mockDb.Post.findOne.mockResolvedValue({ id: 30, userId: 7, detailPostId: 20, statusCode: 'PS3', isHot: 0, timeEnd: validPost().timeEnd });
  mockDb.DetailPost.findOne.mockResolvedValue({ ...validPost(), id: 20 });
  mockSendMail.mockReset();
};

const validPost = (extra = {}) => ({
  id: 10, postId: 10, userId: 7, name: 'Node Engineer', categoryJobCode: 'IT', addressCode: 'HN',
  salaryJobCode: 'SAL1', amount: 2, timeEnd: '1893456000000', categoryJoblevelCode: 'JL1',
  categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1',
  descriptionHTML: '<p>job</p>', descriptionMarkdown: 'job', isHot: 0, note: 'note', statusCode: 'PS1',
  ...extra
});

describe('postService', () => {
  test('legacy detail read returns the revision of the same joined content used by the update writer', async () => {
    const post = { id: 10, userId: 7, statusCode: 'PS1', timeEnd: '1700000000000', isHot: 0,
      postDetailData: { ...validPost(), id: 20 } };
    mockDb.Post.findOne.mockResolvedValue(post);
    mockDb.User.findOne.mockResolvedValue({ id: 7, companyId: 4 });
    mockDb.Company.findOne.mockResolvedValue({ id: 4, statusCode: 'S1', censorCode: 'CS1' });
    const result = await service.getDetailPostById(10, { includeNonPublic: true });
    expect(result.data.editRevision).toBe(jobRevision({ ...post, detailPostId: 20 }, post.postDetailData));
    expect(result.data.editRevision).toMatch(/^jv1-[a-f0-9]{64}$/);
    expect(mockDb.Post.findOne).toHaveBeenCalledTimes(1);
  });
  test('checks a supplied revision under detail lock before no-op detection or writes', async () => {
    const post = { id: 10, detailPostId: 20, userId: 7, statusCode: 'PS1', timeEnd: validPost().timeEnd, isHot: 0, save: jest.fn() };
    const detail = { ...validPost(), id: 20 };
    mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 4 }]);
    mockDb.Company.findOne.mockResolvedValue({ statusCode: 'S1', censorCode: 'CS1' });
    mockDb.Post.findOne.mockResolvedValue(post); mockDb.DetailPost.findOne.mockResolvedValue(detail);
    const expectedRevision = jobRevision(post, detail);
    expect(await service.handleUpdatePost(validPost({ expectedRevision }))).toMatchObject({ errCode: 0, changed: false, editRevision: expectedRevision });
    expect(await service.handleUpdatePost(validPost({ expectedRevision: 'jv1-' + '0'.repeat(64) })))
      .toMatchObject({ errCode: 4, conflict: true });
    expect(mockDb.DetailPost.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction: mockTransaction, lock: 'UPDATE' }));
    expect(mockDb.DetailPost.create).not.toHaveBeenCalled(); expect(post.save).not.toHaveBeenCalled();
  });

  test.each([null, '', {}, 'jv2-' + 'a'.repeat(64)])('rejects malformed legacy revision %j before starting a transaction', async expectedRevision => {
    expect((await service.handleUpdatePost(validPost({ expectedRevision }))).errCode).toBe(1);
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
  });
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());
  beforeEach(reset);

  test('all commands and id-based queries validate required fields', async () => {
    const invalid = [
      ['handleCreateNewPost', {}], ['handleReupPost', {}], ['handleUpdatePost', {}],
      ['handleBanPost', {}], ['handleActivePost', {}], ['handleAcceptPost', {}],
      ['getListPostByAdmin', {}], ['getAllPostByAdmin', {}], ['getDetailPostById', null],
      ['getListNoteByPost', {}], ['getRelatedPost', {}], ['getRecommendedPost', {}]
    ];
    for (const [method, arg] of invalid) expect((await service[method](arg, { roleCode: 'ADMIN' })).errCode).toBe(1);
  });

  test.each([
    [0, 'allowPost'], [1, 'allowHotPost']
  ])('creates a pending post and consumes the matching allowance (isHot=%s)', async (isHot, allowance) => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    const company = { id: 4, statusCode: 'S1', censorCode: 'CS1', allowPost: 2, allowHotPost: 2, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    mockDb.DetailPost.create.mockResolvedValue({ id: 20 });
    mockDb.Post.create.mockResolvedValue({ id: 30 });
    const result = await service.handleCreateNewPost(validPost({ isHot }));
    expect(result).toEqual(expect.objectContaining({ errCode: 0, postId: 30 }));
    expect(company[allowance]).toBe(1);
    expect(mockDb.Post.create).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 'PS3', detailPostId: 20, isHot }), { transaction: mockTransaction });
    expect(mockDb.DetailPost.create).toHaveBeenCalledWith(expect.any(Object), { transaction: mockTransaction });
    expect(company.save).toHaveBeenCalledWith({ transaction: mockTransaction, fields: [allowance], silent: true });
    for (const model of [mockDb.User, mockDb.Company]) {
      expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction: mockTransaction, lock: 'UPDATE' }));
    }
  });

  test('create handles missing/banned companies and exhausted quotas', async () => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.handleCreateNewPost(validPost())).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ statusCode: 'S2' });
    expect((await service.handleCreateNewPost(validPost())).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ statusCode: 'S1', censorCode: 'CS1', allowPost: 0 });
    expect((await service.handleCreateNewPost(validPost())).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ statusCode: 'S1', censorCode: 'CS1', allowHotPost: 0 });
    expect((await service.handleCreateNewPost(validPost({ isHot: 1 }))).errCode).toBe(2);
  });

  test('re-ups an existing post and consumes normal/hot allowance', async () => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    const company = { id: 4, statusCode: 'S1', censorCode: 'CS1', allowPost: 1, allowHotPost: 1, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.handleReupPost(validPost())).errCode).toBe(2);
    const source = { id: 10, userId: 7, statusCode: 'PS1', isHot: 0, detailPostId: 20, timeEnd: '1700000000000' };
    mockDb.Post.findOne.mockResolvedValueOnce(source).mockResolvedValueOnce(source)
      .mockResolvedValueOnce({ ...source, id: 31, statusCode: 'PS3', timeEnd: validPost().timeEnd });
    mockDb.Post.create.mockResolvedValueOnce({ id: 31 });
    expect((await service.handleReupPost(validPost())).postId).toBe(31);
    expect(company.allowPost).toBe(0);
    company.allowHotPost = 0;
    mockDb.Post.findOne.mockResolvedValueOnce({ ...source, isHot: 1 }).mockResolvedValueOnce({ ...source, isHot: 1 });
    expect((await service.handleReupPost(validPost())).errCode).toBe(2);
  });

  test('update always forks changed detail, preserves author and holds locks in one transaction', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.handleUpdatePost(validPost())).errCode).toBe(2);

    const post = { id: 10, userId: 8, statusCode: 'PS1', timeEnd: validPost().timeEnd, isHot: 0, detailPostId: 20, save: jest.fn() };
    const detail = { ...validPost(), id: 20, name: 'Old', save: jest.fn() };
    mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 4 }, { id: 8, companyId: 4 }]);
    mockDb.Company.findOne.mockResolvedValue({ statusCode: 'S1', censorCode: 'CS1' });
    mockDb.Post.findOne.mockResolvedValue(post);
    mockDb.DetailPost.findOne.mockResolvedValueOnce(detail).mockResolvedValueOnce({ ...validPost(), id: 21 });
    mockDb.DetailPost.create.mockResolvedValueOnce({ id: 21 });
    expect((await service.handleUpdatePost(validPost())).errCode).toBe(0);
    expect(detail.name).toBe('Old');
    expect(detail.save).not.toHaveBeenCalled();
    expect(post.detailPostId).toBe(21);
    expect(post.userId).toBe(8);
    expect(post.statusCode).toBe('PS3');
    expect(post.save).toHaveBeenCalledWith({ transaction: mockTransaction, fields: ['detailPostId', 'statusCode', 'updatedAt'] });
    expect(mockDb.DetailPost.create).toHaveBeenCalledWith(expect.objectContaining({ genderPostCode: 'G1', amount: 2 }), { transaction: mockTransaction });
    expect(mockDb.User.findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction: mockTransaction, lock: 'UPDATE', order: [['id', 'ASC']] }));
    expect(mockDb.Company.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction: mockTransaction, lock: 'UPDATE' }));
    const inserts = mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1].transaction).toBe(mockTransaction);
    expect(JSON.parse(inserts[0][1].replacements[4]).job).toMatchObject({ id: 10, userId: 8, statusCode: 'PS3', name: 'Node Engineer' });
  });

  test.each([['0', 0], ['1', 1], [false, 0], [true, 1]])('normalizes legacy hot flag %s to %s', async (isHot, expected) => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    const company = { id: 4, statusCode: 'S1', censorCode: 'CS1', allowPost: 2, allowHotPost: 2, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    mockDb.DetailPost.create.mockResolvedValue({ id: 20 });
    mockDb.Post.create.mockResolvedValue({ id: 30 });
    expect((await service.handleCreateNewPost(validPost({ isHot }))).errCode).toBe(0);
    expect(mockDb.Post.create).toHaveBeenCalledWith(expect.objectContaining({ isHot: expected }), { transaction: mockTransaction });
    expect(company[expected ? 'allowPost' : 'allowHotPost']).toBe(2);
  });

  test.each(['handleCreateNewPost', 'handleReupPost'])('%s rejects unapproved companies, absent users and unsafe tables before writes', async method => {
    mockDb.User.findOne.mockResolvedValueOnce(null);
    expect((await service[method](validPost())).errCode).toBe(2);
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValue({ statusCode: 'S1', censorCode: 'CS2' });
    expect((await service[method](validPost())).errCode).toBe(2);
    mockDb.sequelize.query.mockResolvedValueOnce([[{ name: 'companies', engine: 'MyISAM' }]]);
    expect((await service[method](validPost())).errCode).toBe(2);
    expect(mockDb.Post.create).not.toHaveBeenCalled();
    expect(mockDb.DetailPost.create).not.toHaveBeenCalled();
  });

  test.each([null, 'false', 'true', -1, 2, {}])('refuses malformed hot flag %s without a charge', async isHot => {
    expect((await service.handleCreateNewPost(validPost({ isHot }))).errCode).toBe(2);
    expect(mockDb.User.findOne).not.toHaveBeenCalled();
    expect(mockDb.Post.create).not.toHaveBeenCalled();
  });

  test.each([0, -1, null, undefined])('refuses unavailable remaining quota %s', async allowPost => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    const company = { id: 4, statusCode: 'S1', censorCode: 'CS1', allowPost, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    expect((await service.handleCreateNewPost(validPost())).errCode).toBe(2);
    expect(company.save).not.toHaveBeenCalled();
    expect(mockDb.DetailPost.create).not.toHaveBeenCalled();
  });

  test.each(['quota', 'detail', 'post', 'commit'])('does not report success when %s fails in the transaction', async stage => {
    mockDb.User.findOne.mockResolvedValue({ companyId: 4 });
    const company = { id: 4, statusCode: 'S1', censorCode: 'CS1', allowPost: 2, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    mockDb.DetailPost.create.mockResolvedValue({ id: 20 });
    mockDb.Post.create.mockResolvedValue({ id: 30 });
    const failure = new Error('transaction failure');
    if (stage === 'quota') company.save.mockRejectedValueOnce(failure);
    if (stage === 'detail') mockDb.DetailPost.create.mockRejectedValueOnce(failure);
    if (stage === 'post') mockDb.Post.create.mockRejectedValueOnce(failure);
    if (stage === 'commit') mockDb.sequelize.transaction.mockImplementationOnce(async work => {
      await work(mockTransaction);
      throw failure;
    });
    await expect(service.handleCreateNewPost(validPost())).rejects.toBe(failure);
  });

  const moderationFixture = (statusCode = 'PS3') => {
    const post = { id: 10, userId: 7, detailPostId: 20, statusCode, timeEnd: '1700000000000', isHot: 0, save: jest.fn() };
    const detail = { ...validPost(), id: 20 };
    mockDb.Post.findOne.mockResolvedValue(post); mockDb.DetailPost.findOne.mockResolvedValue(detail);
    mockDb.User.findAll.mockResolvedValue([{ id: 1, companyId: null }, { id: 7, companyId: 4 }]);
    mockDb.User.findOne.mockResolvedValue({ email: 'author@example.com' });
    mockDb.Company.findOne.mockResolvedValue({ id: 4, name: 'Acme' });
    mockDb.FollowCompany.findAll.mockResolvedValue([]);
    mockDb.sequelize.query.mockImplementation(sql => Promise.resolve(sql.includes('TABLE_NAME IN')
      ? [['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }))]
      : [[{ engine: 'InnoDB' }]]));
    return { post, detail, payload: { id: 10, postId: 10, userId: 1, note: 'Lý do', expectedRevision: jobRevision(post, detail) } };
  };

  test.each([
    ['handleBanPost', 'PS1', 'PS4'], ['handleActivePost', 'PS4', 'PS3'],
    ['handleAcceptPost', 'PS3', 'PS1'], ['handleAcceptPost', 'PS3', 'PS2']
  ])('%s changes %s to %s with transactional note/fence/notification and no direct email', async (method, from, statusCode) => {
    const { post, payload } = moderationFixture(from);
    const result = await service[method]({ ...payload, statusCode }, { roleCode: 'ADMIN' });
    expect(result).toMatchObject({ errCode: 0, changed: true, statusCode });
    expect(result.editRevision).not.toBe(payload.expectedRevision);
    expect(result).not.toHaveProperty('notification');
    expect(post.statusCode).toBe(statusCode);
    expect(post.save).toHaveBeenCalledWith(expect.objectContaining({ transaction: mockTransaction }));
    expect(mockDb.Note.create).toHaveBeenCalledWith(expect.objectContaining({ postId: 10, userId: 1 }), { transaction: mockTransaction });
    expect(mockDb.sequelize.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'cancelled'"),
      expect.objectContaining({ transaction: mockTransaction }));
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockDb.sequelize.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO outbox_events'),
      expect.objectContaining({ transaction: mockTransaction, replacements: expect.arrayContaining([
        expect.stringContaining('"audience":"author"')
      ]) }));
    const searchWrites = mockDb.sequelize.query.mock.calls.filter(([sql, opts]) => sql.includes('INSERT INTO outbox_events') && opts.replacements[3] === 'job.updated');
    expect(searchWrites).toHaveLength(1);
    expect(searchWrites[0][1].transaction).toBe(mockTransaction);
    expect(JSON.parse(searchWrites[0][1].replacements[4]).job).toMatchObject({ id: 10, userId: 7, statusCode, name: 'Node Engineer' });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction: mockTransaction, lock: 'UPDATE',
      attributes: ['id', 'name', 'thumbnail', 'statusCode', 'censorCode'] }));
  });

  test('approval preserves its old timestamp/follower behavior but sends nothing on a stale repeat or matching no-op', async () => {
    const { post, payload } = moderationFixture();
    mockDb.FollowCompany.findAll.mockResolvedValue([{ userId: 2 }, { userId: 3 }]);
    const result = await service.handleAcceptPost({ ...payload, statusCode: 'PS1' }, { roleCode: 'ADMIN' });
    expect(post.timePost).toEqual(expect.any(Number));
    const inserts = () => mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
    expect(inserts()).toHaveLength(2);
    expect(inserts()[0][1].replacements[3]).toBe('job.updated');
    expect(inserts()[1][1].replacements.filter((_, index) => index % 6 === 4).map(JSON.parse)).toEqual([
      expect.objectContaining({ recipientId: 7, audience: 'author' }),
      expect.objectContaining({ recipientId: 2, audience: 'follower', note: null }),
      expect.objectContaining({ recipientId: 3, audience: 'follower', note: null })
    ]);
    expect((await service.handleAcceptPost({ ...payload, statusCode: 'PS1' }, { roleCode: 'ADMIN' })).httpStatus).toBe(409);
    expect(await service.handleAcceptPost({ ...payload, expectedRevision: result.editRevision, statusCode: 'PS1' }, { roleCode: 'ADMIN' }))
      .toMatchObject({ errCode: 0, changed: false });
    expect(mockDb.Note.create).toHaveBeenCalledTimes(1); expect(mockSendMail).not.toHaveBeenCalled();
    expect(mockDb.Notification.bulkCreate).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(2);
  });

  test.each(['note', 'commit'])('a failed %s never emails or notifies followers', async stage => {
    const { payload } = moderationFixture();
    if (stage === 'note') mockDb.Note.create.mockRejectedValueOnce(new Error('synthetic note'));
    else mockDb.sequelize.transaction.mockImplementationOnce(async work => { await work(mockTransaction); throw new Error('synthetic commit'); });
    await expect(service.handleAcceptPost({ ...payload, statusCode: 'PS1' }, { roleCode: 'ADMIN' })).rejects.toThrow('synthetic');
    expect(mockSendMail).not.toHaveBeenCalled(); expect(mockDb.Notification.bulkCreate).not.toHaveBeenCalled();
  });

  test('follower snapshot failure rejects the transaction, never a post-commit partial success', async () => {
    const { payload } = moderationFixture();
    mockDb.User.findOne.mockRejectedValueOnce(new Error('email lookup'));
    mockDb.FollowCompany.findAll.mockRejectedValueOnce(new Error('followers'));
    await expect(service.handleAcceptPost({ ...payload, statusCode: 'PS1' }, { roleCode: 'ADMIN' })).rejects.toThrow('followers');
    expect(mockDb.User.findOne).not.toHaveBeenCalled();
    expect(mockDb.Note.create).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ roleCode: 'EMPLOYER' }, {}, 403], [{}, { roleCode: 'ADMIN' }, 403],
    [{ roleCode: 'ADMIN' }, { expectedRevision: undefined }, 428],
    [{ roleCode: 'ADMIN' }, { expectedRevision: null }, 400],
    [{ roleCode: 'ADMIN' }, { note: ' ' }, 400], [{ roleCode: 'ADMIN' }, { note: 'a'.repeat(256) }, 400],
    [{ roleCode: 'ADMIN' }, { id: '../10' }, 400]
  ])('rejects unsafe identity/payload before mutation: %j %j', async (identity, patch, httpStatus) => {
    const { payload, post } = moderationFixture();
    expect((await service.handleAcceptPost({ ...payload, statusCode: 'PS2', ...patch }, identity)).httpStatus).toBe(httpStatus);
    expect(post.save).not.toHaveBeenCalled(); expect(mockDb.Note.create).not.toHaveBeenCalled(); expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('lists company/admin posts with pagination and filters', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.getListPostByAdmin({ companyId: 4, limit: 5, offset: 0 })).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4 });
    mockDb.User.findAll.mockResolvedValueOnce([{ id: 7 }]);
    const row = { id: 10, userId: 7, postDetailData: { ...validPost(), id: 20 } };
    const expected = { ...row, editRevision: jobRevision(row, row.postDetailData) };
    mockDb.Post.findAndCountAll.mockResolvedValue({ rows: [row], count: 1 });
    expect(await service.getListPostByAdmin({ companyId: 4, limit: '5', offset: '0', search: 'Node', censorCode: 'PS1' })).toEqual({
      errCode: 0, data: [expected], count: 1
    });
    expect(mockDb.Post.findAndCountAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 5, offset: 0, where: expect.any(Object) }));
    expect(await service.getAllPostByAdmin({ limit: '5', offset: '0', search: 'Node', censorCode: 'PS1' })).toEqual({
      errCode: 0, data: [expected], count: 1
    });
  });

  test('loads post detail and owning company', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.getDetailPostById(10)).errMessage).toBeDefined();
    const post = { id: 10, userId: 7 };
    mockDb.Post.findOne.mockResolvedValueOnce(post);
    mockDb.User.findOne.mockResolvedValueOnce({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4, file: 'private-license' });
    expect((await service.getDetailPostById(10)).data.companyData).toEqual({ id: 4 });
    expect(mockDb.Post.findOne).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 10, statusCode: 'PS1' }
    }));

    mockDb.Post.findOne.mockResolvedValueOnce(post);
    mockDb.User.findOne.mockResolvedValueOnce({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4, file: 'private-license' });
    await service.getDetailPostById(10, { includeNonPublic: true });
    expect(mockDb.Post.findOne).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 10 } }));
    const detailQuery = mockDb.Post.findOne.mock.calls.at(-1)[0].include.find(item => item.as === 'postDetailData');
    expect(detailQuery.attributes).toEqual(expect.arrayContaining(['categoryJobCode', 'addressCode', 'salaryJobCode',
      'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode']));
    expect(detailQuery.include).toHaveLength(7); // keep old associations for clients not yet migrated
  });

  test('filters active posts across array filters, hot flag and pagination', async () => {
    mockDb.DetailPost.findAll.mockResolvedValue([{ id: 20 }, { id: 21 }]);
    mockDb.Post.findAndCountAll.mockResolvedValue({ rows: ['p'], count: 1 });
    const result = await service.getFilterPost({
      salaryJobCode: ['S1', 'S2'], categoryWorktypeCode: ['W1'], experienceJobCode: ['E1'],
      categoryJoblevelCode: ['L1'], categoryJobCode: 'IT', addressCode: 'HN', search: 'Node',
      isHot: 1, limit: '10', offset: '0'
    });
    expect(result).toEqual({ errCode: 0, data: ['p'], count: 1 });
    expect(mockDb.Post.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  test('returns type statistics and total active post count', async () => {
    mockDb.Post.findAll.mockResolvedValue([{ amount: 2 }]);
    mockDb.Post.findAndCountAll.mockResolvedValue({ count: 9 });
    expect(await service.getStatisticalTypePost({ limit: 4 })).toEqual({ errCode: 0, data: [{ amount: 2 }], totalPost: 9 });
  });

  test('paginates post notes', async () => {
    mockDb.Note.findAndCountAll.mockResolvedValue({ rows: ['note'], count: 1 });
    expect(await service.getListNoteByPost({ id: 10, limit: '5', offset: '0' })).toEqual({ errCode: 0, data: ['note'], count: 1 });
  });

  test('returns related active posts, empty category peers and missing post states', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.getRelatedPost({ postId: 10 })).errCode).toBe(2);
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, detailPostId: 20 });
    mockDb.DetailPost.findOne.mockResolvedValueOnce({ id: 20, categoryJobCode: 'IT' });
    mockDb.DetailPost.findAll.mockResolvedValueOnce([]);
    expect(await service.getRelatedPost({ postId: 10 })).toEqual({ errCode: 0, data: [] });
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, detailPostId: 20 });
    mockDb.DetailPost.findOne.mockResolvedValueOnce({ id: 20, categoryJobCode: 'IT' });
    mockDb.DetailPost.findAll.mockResolvedValueOnce([{ id: 21 }]);
    mockDb.Post.findAll.mockResolvedValueOnce(['related']);
    expect(await service.getRelatedPost({ postId: 10, limit: 3 })).toEqual({ errCode: 0, data: ['related'] });
  });

  test('scores recommendations by skills/settings and falls back to newest when no match', async () => {
    mockDb.UserSkill.findAll.mockResolvedValue([{ SkillId: 1 }]);
    mockDb.Skill.findAll.mockResolvedValue([{ id: 1, name: 'Node', categoryJobCode: 'IT' }]);
    mockDb.UserSetting.findOne.mockResolvedValue({ categoryJobCode: 'IT', addressCode: 'HN' });
    mockDb.Post.findAll.mockResolvedValue([
      { id: 1, timePost: 1, postDetailData: { name: 'Node Engineer', categoryJobCode: 'IT', addressCode: 'HN' } },
      { id: 2, timePost: 2, postDetailData: { name: 'Other', categoryJobCode: 'OTHER', addressCode: 'DN' } }
    ]);
    const result = await service.getRecommendedPost({ userId: 7, limit: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(expect.objectContaining({ id: 1, matchScore: 9 }));

    mockDb.UserSkill.findAll.mockResolvedValueOnce([]);
    mockDb.UserSetting.findOne.mockResolvedValueOnce(null);
    mockDb.Post.findAll.mockResolvedValueOnce([{ id: 3, timePost: 3, postDetailData: { name: 'None' } }]);
    expect((await service.getRecommendedPost({ userId: 7 })).data[0].id).toBe(3);
  });

  test('each read workflow propagates database errors', async () => {
    const failures = [
      ['handleCreateNewPost', validPost(), mockDb.User, 'findOne'],
      ['handleReupPost', validPost(), mockDb.User, 'findOne'],
      ['handleUpdatePost', validPost(), mockDb.Post, 'findOne'],
      ['handleBanPost', validPost(), mockDb.Post, 'findOne'],
      ['handleActivePost', validPost(), mockDb.Post, 'findOne'],
      ['handleAcceptPost', validPost(), mockDb.Post, 'findOne'],
      ['getListPostByAdmin', { companyId: 4, limit: 1, offset: 0 }, mockDb.Company, 'findOne'],
      ['getAllPostByAdmin', { limit: 1, offset: 0 }, mockDb.Post, 'findAndCountAll'],
      ['getDetailPostById', 10, mockDb.Post, 'findOne'],
      ['getFilterPost', {}, mockDb.DetailPost, 'findAll'],
      ['getStatisticalTypePost', {}, mockDb.Post, 'findAll'],
      ['getListNoteByPost', { id: 10 }, mockDb.Note, 'findAndCountAll'],
      ['getRelatedPost', { postId: 10 }, mockDb.Post, 'findOne'],
      ['getRecommendedPost', { userId: 7 }, mockDb.UserSkill, 'findAll']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      const data = ['handleBanPost', 'handleActivePost', 'handleAcceptPost'].includes(method)
        ? { ...arg, expectedRevision: 'jv1-' + 'a'.repeat(64) } : arg;
      await expect(service[method](data, { roleCode: 'ADMIN' })).rejects.toBeTruthy();
    }
  });
});
