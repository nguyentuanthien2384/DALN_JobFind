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

const reset = () => {
  for (const item of Object.values(mockDb)) {
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  mockDb.Sequelize.where.mockReturnValue('where');
  mockDb.sequelize.col.mockReturnValue('col');
  mockDb.sequelize.fn.mockReturnValue('fn');
  mockDb.sequelize.literal.mockReturnValue('literal');
  mockDb.sequelize.query.mockResolvedValue([['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }))]);
  mockDb.sequelize.transaction.mockImplementation(work => work(mockTransaction));
  mockSendMail.mockReset();
};

const validPost = (extra = {}) => ({
  id: 10, postId: 10, userId: 7, name: 'Node Engineer', categoryJobCode: 'IT', addressCode: 'HN',
  salaryJobCode: 'SAL1', amount: 2, timeEnd: '2026-12-31', categoryJoblevelCode: 'JL1',
  categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1',
  descriptionHTML: '<p>job</p>', descriptionMarkdown: 'job', isHot: 0, note: 'note', statusCode: 'PS1',
  ...extra
});

describe('postService', () => {
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
    for (const [method, arg] of invalid) expect((await service[method](arg)).errCode).toBe(1);
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
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, isHot: 0, detailPostId: 20 });
    mockDb.Post.create.mockResolvedValueOnce({ id: 31 });
    expect((await service.handleReupPost(validPost())).postId).toBe(31);
    expect(company.allowPost).toBe(0);
    company.allowHotPost = 0;
    mockDb.Post.findOne.mockResolvedValueOnce({ id: 10, isHot: 1, detailPostId: 20 });
    expect((await service.handleReupPost(validPost())).errCode).toBe(2);
  });

  test('update always forks changed detail, preserves author and holds locks in one transaction', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.handleUpdatePost(validPost())).errCode).toBe(2);

    const post = { id: 10, userId: 8, statusCode: 'PS1', timeEnd: validPost().timeEnd, detailPostId: 20, save: jest.fn() };
    const detail = { ...validPost(), id: 20, name: 'Old', save: jest.fn() };
    mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 4 }, { id: 8, companyId: 4 }]);
    mockDb.Company.findOne.mockResolvedValue({ statusCode: 'S1', censorCode: 'CS1' });
    mockDb.Post.findOne.mockResolvedValue(post);
    mockDb.DetailPost.findOne.mockResolvedValueOnce(detail);
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

  test.each([
    ['handleBanPost', { postId: 10, userId: 1, note: 'bad' }, 'PS4'],
    ['handleActivePost', { id: 10, userId: 1, note: 'fixed' }, 'PS3']
  ])('%s changes status, records a note and emails the author', async (method, payload, status) => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service[method](payload)).errCode).toBe(2);
    const post = { id: 10, userId: 7, save: jest.fn() };
    mockDb.Post.findOne.mockResolvedValueOnce(post);
    mockDb.User.findOne.mockResolvedValueOnce({ email: 'author@example.com' });
    expect((await service[method](payload)).errCode).toBe(0);
    expect(post.statusCode).toBe(status);
    expect(mockDb.Note.create).toHaveBeenCalledWith(expect.objectContaining({ postId: 10, userId: 1 }));
    expect(mockSendMail).toHaveBeenCalled();
  });

  test('accepting an active post timestamps it and notifies company followers', async () => {
    mockDb.Post.findOne.mockResolvedValueOnce(null);
    expect((await service.handleAcceptPost({ id: 10, statusCode: 'PS1' })).errCode).toBe(2);
    const post = { id: 10, userId: 7, detailPostId: 20, save: jest.fn() };
    mockDb.Post.findOne.mockResolvedValueOnce(post);
    mockDb.User.findOne.mockResolvedValueOnce({ email: 'a@b.com', companyId: 4 });
    mockDb.DetailPost.findOne.mockResolvedValueOnce({ name: 'Node' });
    mockDb.Company.findOne.mockResolvedValueOnce({ name: 'Acme' });
    mockDb.FollowCompany.findAll.mockResolvedValueOnce([{ userId: 2 }, { userId: 3 }]);
    const result = await service.handleAcceptPost({ id: 10, statusCode: 'PS1', userId: 1 });
    expect(result.errCode).toBe(0);
    expect(post.statusCode).toBe('PS1');
    expect(post.timePost).toEqual(expect.any(Number));
    expect(mockDb.Notification.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 2, typeCode: 'NEW_POST', link: '/detail-job/10' }),
      expect.objectContaining({ userId: 3, typeCode: 'NEW_POST', link: '/detail-job/10' })
    ]);
  });

  test('rejecting a post stores the supplied note without follower notifications', async () => {
    const post = { id: 10, userId: 7, save: jest.fn() };
    mockDb.Post.findOne.mockResolvedValue(post);
    mockDb.User.findOne.mockResolvedValue({ email: 'a@b.com' });
    expect((await service.handleAcceptPost({ id: 10, statusCode: 'PS2', userId: 1, note: 'bad' })).errCode).toBe(0);
    expect(mockDb.Note.create).toHaveBeenCalledWith(expect.objectContaining({ note: 'bad' }));
    expect(mockDb.Notification.bulkCreate).not.toHaveBeenCalled();
  });

  test('follower notification failures do not fail post approval', async () => {
    const post = { id: 10, userId: 7, detailPostId: 20, save: jest.fn() };
    mockDb.Post.findOne.mockResolvedValue(post);
    mockDb.User.findOne.mockResolvedValue({ email: 'a@b.com', companyId: 4 });
    mockDb.DetailPost.findOne.mockRejectedValue(new Error('notify db'));
    expect((await service.handleAcceptPost({ id: 10, statusCode: 'PS1', userId: 1 })).errCode).toBe(0);
  });

  test('lists company/admin posts with pagination and filters', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.getListPostByAdmin({ companyId: 4, limit: 5, offset: 0 })).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4 });
    mockDb.User.findAll.mockResolvedValueOnce([{ id: 7 }]);
    mockDb.Post.findAndCountAll.mockResolvedValue({ rows: ['p'], count: 1 });
    expect(await service.getListPostByAdmin({ companyId: 4, limit: '5', offset: '0', search: 'Node', censorCode: 'PS1' })).toEqual({
      errCode: 0, data: ['p'], count: 1
    });
    expect(mockDb.Post.findAndCountAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 5, offset: 0, where: expect.any(Object) }));
    expect(await service.getAllPostByAdmin({ limit: '5', offset: '0', search: 'Node', censorCode: 'PS1' })).toEqual({
      errCode: 0, data: ['p'], count: 1
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
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
  });
});
