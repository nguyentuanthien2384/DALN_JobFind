const model = () => ({ findOne: jest.fn(), create: jest.fn() });
const mockDb = { Post: model(), DetailPost: model(), User: model(), Company: model(),
  sequelize: { transaction: jest.fn(), query: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { handleCreateNewPost: create } = require('../../src/services/postService');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let company, post, detail, body;
const inserts = () => mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
beforeEach(() => {
  for (const model of Object.values(mockDb)) for (const fn of Object.values(model)) fn.mockReset();
  company = { id: 3, name: 'Locked company', thumbnail: 'logo', statusCode: 'S1', censorCode: 'CS1', allowPost: 5, allowHotPost: 5, save: jest.fn() };
  body = { name: 'Submitted title', descriptionHTML: '<p>Content</p>', descriptionMarkdown: 'Content', amount: '3',
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', categoryJoblevelCode: 'JL1', categoryWorktypeCode: 'WT1',
    experienceJobCode: 'EXP1', genderPostCode: 'G1', timeEnd: 1790000000000, userId: 7, isHot: 0,
    id: 99, postId: 99, companyId: 99, statusCode: 'PS1', timePost: 1, email: 'PRIVATE' };
  post = { id: 30, userId: 7, detailPostId: 20, statusCode: 'PS3', isHot: 0, timePost: null, timeEnd: '1790000000000' };
  detail = { ...body, id: 20, name: 'Persisted title', amount: 3 };
  mockDb.sequelize.transaction.mockImplementation(work => work(transaction));
  mockDb.sequelize.query.mockImplementation(async sql => sql.includes('TABLE_NAME IN')
    ? [['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }))] : [[{ engine: 'InnoDB' }]]);
  mockDb.User.findOne.mockResolvedValue({ id: 7, companyId: 3 }); mockDb.Company.findOne.mockResolvedValue(company);
  mockDb.Post.create.mockResolvedValue({ id: 30 }); mockDb.DetailPost.create.mockResolvedValue({ id: 20 });
  mockDb.Post.findOne.mockResolvedValue(post); mockDb.DetailPost.findOne.mockResolvedValue(detail);
});
test.each([[0, 0], ['0', 0], [false, 0], [1, 1], ['1', 1], [true, 1]])('create %j saves one PS3 event with inserted DB values in the same quota transaction', async (isHot, expected) => {
  post.isHot = expected;
  expect(await create({ ...body, isHot })).toMatchObject({ errCode: 0, postId: 30 });
  expect(inserts()).toHaveLength(1);
  const [, options] = inserts()[0]; expect(options.transaction).toBe(transaction);
  expect(options.replacements.slice(1, 4)).toEqual(['legacy-job', '30', 'job.created']);
  const { job } = JSON.parse(options.replacements[4]);
  expect(job).toMatchObject({ id: 30, userId: 7, statusCode: 'PS3', timePost: null, timeEnd: post.timeEnd, isHot: expected,
    name: 'Persisted title', amount: 3, companyId: 3, companyName: company.name, companyLogo: company.thumbnail });
  expect(options.replacements[4]).not.toContain('PRIVATE'); expect(job.companyId).not.toBe(body.companyId);
  expect(company.save).toHaveBeenCalledWith({ transaction, fields: [expected ? 'allowHotPost' : 'allowPost'], silent: true });
  expect(company[expected ? 'allowHotPost' : 'allowPost']).toBe(4);
  expect(mockDb.Post.findOne).toHaveBeenCalledWith({ where: { id: 30 }, transaction, lock: 'UPDATE', raw: true });
  expect(mockDb.DetailPost.findOne).toHaveBeenCalledWith({ where: { id: 20 }, transaction, lock: 'UPDATE', raw: true });
});
test.each(['post', 'detail', 'owner', 'pointer', 'status'])('cannot report success if saved %s is missing or inconsistent', async problem => {
  if (problem === 'post') mockDb.Post.findOne.mockResolvedValue(null);
  if (problem === 'detail') mockDb.DetailPost.findOne.mockResolvedValue(null);
  if (problem === 'owner') post.userId = 8;
  if (problem === 'pointer') post.detailPostId = 90;
  if (problem === 'status') post.statusCode = 'PS1';
  expect((await create(body)).errCode).toBe(2); expect(inserts()).toHaveLength(0);
});
test.each(['quota', 'detail', 'post', 'rereadPost', 'rereadDetail', 'outbox', 'commit'])('propagates %s failure instead of reporting a successful create', async stage => {
  const failure = new Error('synthetic failure');
  const fn = { quota: company.save, detail: mockDb.DetailPost.create, post: mockDb.Post.create,
    rereadPost: mockDb.Post.findOne, rereadDetail: mockDb.DetailPost.findOne }[stage];
  if (fn) fn.mockRejectedValueOnce(failure);
  if (stage === 'outbox') {
    const query = mockDb.sequelize.query.getMockImplementation();
    mockDb.sequelize.query.mockImplementation(sql => sql.includes('INSERT INTO outbox_events') ? Promise.reject(failure) : query(sql));
  }
  if (stage === 'commit') mockDb.sequelize.transaction.mockImplementation(async work => { await work(transaction); throw failure; });
  await expect(create(body)).rejects.toBe(failure);
});
test.each([[[]], [[{ engine: 'MyISAM' }]]])('fails closed for unavailable outbox %j', async tables => {
  const query = mockDb.sequelize.query.getMockImplementation();
  mockDb.sequelize.query.mockImplementation(sql => sql.includes("TABLE_NAME = 'outbox_events'") ? Promise.resolve([tables]) : query(sql));
  expect((await create(body)).errCode).toBe(2); expect(inserts()).toHaveLength(0);
});
test('invalid persisted event data aborts before INSERT without changing contract or falling back to publish', async () => {
  post.isHot = 2;
  await expect(create(body)).rejects.toThrow('EVENT_PAYLOAD_INVALID'); expect(inserts()).toHaveLength(0);
});
