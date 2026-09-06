const model = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
const mockDb = { Post: model(), DetailPost: model(), User: model(), Company: model(),
  sequelize: { transaction: jest.fn(), query: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { repostLegacyPost: repost } = require('../../src/utils/jobRepost');
const { jobRevision } = require('../../src/utils/jobRevision');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const identity = { roleCode: 'COMPANY', companyId: 3 };
let source, detail, company, body, saved;
const inserts = () => mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
beforeEach(() => {
  for (const model of Object.values(mockDb)) for (const fn of Object.values(model)) fn.mockReset();
  source = { id: 10, userId: 8, statusCode: 'PS1', detailPostId: 20, isHot: 0, timeEnd: '1700000000000', timePost: '1690000000000' };
  detail = { id: 20, name: 'Stored content', descriptionHTML: '<p>Stored</p>', descriptionMarkdown: 'Stored', amount: 3,
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', categoryJoblevelCode: 'JL1', categoryWorktypeCode: 'WT1',
    experienceJobCode: 'EXP1', genderPostCode: 'G1' };
  company = { id: 3, name: 'Actor company', thumbnail: 'logo', statusCode: 'S1', censorCode: 'CS1', allowPost: 5, allowHotPost: 5, save: jest.fn() };
  body = { postId: 10, userId: 7, timeEnd: String(Date.now() + 86400000), expectedRevision: jobRevision(source, detail),
    id: 99, companyId: 99, roleCode: 'ADMIN', name: 'Unsaved body', isHot: 1, detailPostId: 99, statusCode: 'PS1' };
  saved = null;
  mockDb.sequelize.transaction.mockImplementation(work => work(transaction));
  mockDb.sequelize.query.mockImplementation(async sql => sql.includes('TABLE_NAME IN')
    ? [['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }))] : [[{ engine: 'InnoDB' }]]);
  mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 3 }, { id: 8, companyId: 3 }]);
  mockDb.User.findOne.mockResolvedValue({ id: 7, companyId: 3 }); mockDb.Company.findOne.mockResolvedValue(company);
  mockDb.Post.findOne.mockImplementation(async ({ where }) => where.id === 10 ? { ...source } : saved);
  mockDb.Post.create.mockImplementation(async values => { saved = { ...values, id: 30, timePost: null }; return { id: 30 }; });
  mockDb.DetailPost.findOne.mockResolvedValue(detail);
});
test.each([['PS1', 0], ['PS2', 1], ['PS3', '0']])('reposts %s/%s with original immutable detail, new actor/ID/expiry, one charge and durable PS3 event', async (statusCode, isHot) => {
  source.statusCode = statusCode; source.isHot = isHot; body.expectedRevision = jobRevision(source, detail);
  const original = { ...source }, content = { ...detail };
  expect(await repost(body, identity)).toMatchObject({ errCode: 0, postId: 30 });
  expect(source).toEqual(original); expect(detail).toEqual(content); expect(mockDb.DetailPost.create).not.toHaveBeenCalled();
  expect(mockDb.User.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { id: [7, 8] }, order: [['id', 'ASC']], transaction, lock: 'UPDATE' }));
  expect(company.save).toHaveBeenCalledWith({ transaction, fields: [Number(isHot) ? 'allowHotPost' : 'allowPost'], silent: true });
  expect(inserts()).toHaveLength(1); const [, options] = inserts()[0]; expect(options.transaction).toBe(transaction);
  expect(options.replacements.slice(1, 4)).toEqual(['legacy-job', '30', 'job.created']);
  expect(JSON.parse(options.replacements[4]).job).toMatchObject({ id: 30, userId: 7, name: detail.name, amount: 3, statusCode: 'PS3',
    timePost: null, timeEnd: body.timeEnd, isHot: Number(isHot), companyId: 3, companyName: company.name });
  expect(mockDb.sequelize.query.mock.calls.some(([sql]) => sql.includes('job_moderation_state'))).toBe(false);
});
test.each([null, true, {}, '2030-01-01', '0', -1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])('rejects invalid/past deadline %j before DB work', async timeEnd => {
  expect((await repost({ ...body, timeEnd }, identity)).errCode).toBe(1); expect(mockDb.Post.findOne).not.toHaveBeenCalled();
});
test.each([null, {}, 'wrong'])('rejects invalid optional revision %j', async expectedRevision => {
  expect((await repost({ ...body, expectedRevision }, identity)).errCode).toBe(1); expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
});
test('stale source revision fails before charging or writing even when only the deadline would differ', async () => {
  source.name = 'Unused'; detail.amount = 9;
  expect(await repost(body, identity)).toMatchObject({ errCode: 4, conflict: true });
  expect(company.save).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
});
test('keeps the submitted revision stable while an in-process caller reuses its request object', async () => {
  let start;
  mockDb.sequelize.transaction.mockImplementation(work => new Promise(resolve => { start = () => resolve(work(transaction)); }));
  const pending = repost(body, identity);
  body.expectedRevision = 'jv1-' + '0'.repeat(64);
  start();
  expect(await pending).toMatchObject({ errCode: 0, postId: 30 });
});
test.each(['missingActor', 'missingOwner', 'differentCompany', 'staleScope', 'PS4', 'missingDetail', 'ownerChanged', 'unapproved'])('fails closed on %s without charging', async problem => {
  let trusted = identity;
  if (problem === 'missingActor') mockDb.User.findAll.mockResolvedValue([{ id: 8, companyId: 3 }]);
  if (problem === 'missingOwner') mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 3 }]);
  if (problem === 'differentCompany') mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 3 }, { id: 8, companyId: 4 }]);
  if (problem === 'staleScope') trusted = { ...identity, companyId: 4 };
  if (problem === 'PS4') source.statusCode = 'PS4';
  if (problem === 'missingDetail') mockDb.DetailPost.findOne.mockResolvedValue(null);
  if (problem === 'ownerChanged') mockDb.Post.findOne.mockResolvedValueOnce({ ...source }).mockResolvedValueOnce({ ...source, userId: 9 });
  if (problem === 'unapproved') company.censorCode = 'CS2';
  expect((await repost(body, trusted)).errCode).toBe(2); expect(company.save).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
});
test('ADMIN cannot repost another company content even with its own approved quota', async () => {
  mockDb.User.findAll.mockResolvedValue([{ id: 7, companyId: 3 }, { id: 8, companyId: 4 }]);
  expect((await repost(body, { roleCode: 'ADMIN', companyId: 3 })).errCode).toBe(2);
  expect(company.save).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0); expect(source.userId).toBe(8);
});

test.each(['COMPANY', 'EMPLOYER', 'ADMIN'])('same-company %s can repost an expired source', async roleCode => {
  expect(await repost(body, { roleCode, companyId: 3 })).toMatchObject({ errCode: 0, postId: 30 });
});
test.each([null, undefined, '', true, 'bad', '1e3', ' 1700000000000 ', '0', '-1', '1700000000000.0', '8640000000000001', String(Date.now() + 86400000)])
('rejects an invalid/unexpired stored source deadline %j without charging', async timeEnd => {
  source.timeEnd = timeEnd; body.expectedRevision = jobRevision(source, detail);
  expect((await repost(body, identity)).errCode).toBe(2);
  expect(company.save).not.toHaveBeenCalled(); expect(mockDb.Post.create).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
});
test.each(['PS0', '', null, undefined])('rejects unknown source status %j', async statusCode => {
  source.statusCode = statusCode;
  expect((await repost(body, identity)).errCode).toBe(2); expect(company.save).not.toHaveBeenCalled();
});
test.each([{ roleCode: 'ADMIN', companyId: 4 }, { roleCode: 'CANDIDATE', companyId: 3 }])('rejects trusted scope/role mismatch even without a key: %j', async trusted => {
  expect((await repost(body, trusted)).errCode).toBe(2); expect(company.save).not.toHaveBeenCalled();
});
test('accepts a source expiring exactly now and rejects one extended while waiting for its row', async () => {
  const now = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    source.timeEnd = String(now); body.expectedRevision = jobRevision(source, detail);
    expect((await repost(body, identity)).errCode).toBe(0);
    company.save.mockClear();
    mockDb.Post.findOne.mockResolvedValueOnce({ ...source }).mockResolvedValueOnce({ ...source, timeEnd: String(now + 1000) });
    expect((await repost(body, identity)).errCode).toBe(2); expect(company.save).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});
test('deadline expiring while waiting for rows fails without quota writes', async () => {
  const now = Date.now(); body.timeEnd = String(now + 100);
  const clock = jest.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValue(now + 101);
  try { expect((await repost(body, identity)).errCode).toBe(2); expect(company.save).not.toHaveBeenCalled(); }
  finally { clock.mockRestore(); }
});
test.each(['quota', 'post', 'reread', 'outbox', 'commit'])('propagates %s failure without returning successful postId', async stage => {
  const error = new Error('synthetic failure');
  if (stage === 'quota') company.save.mockRejectedValueOnce(error);
  if (stage === 'post') mockDb.Post.create.mockRejectedValueOnce(error);
  if (stage === 'reread') mockDb.Post.findOne.mockResolvedValueOnce({ ...source }).mockResolvedValueOnce({ ...source }).mockRejectedValueOnce(error);
  if (stage === 'outbox') {
    const query = mockDb.sequelize.query.getMockImplementation();
    mockDb.sequelize.query.mockImplementation(sql => sql.includes('INSERT INTO outbox_events') ? Promise.reject(error) : query(sql));
  }
  if (stage === 'commit') mockDb.sequelize.transaction.mockImplementation(async work => { await work(transaction); throw error; });
  await expect(repost(body, identity)).rejects.toBe(error);
});
test('cannot return success for an inconsistent inserted row', async () => {
  mockDb.Post.create.mockImplementation(async values => { saved = { ...values, id: 30, userId: 99 }; return { id: 30 }; });
  expect((await repost(body, identity)).errCode).toBe(2); expect(inserts()).toHaveLength(0);
});
test('old clients without revision remain compatible but separate POSTs create distinct charged copies', async () => {
  delete body.expectedRevision;
  let id = 30; mockDb.Post.create.mockImplementation(async values => { saved = { ...values, id: id++, timePost: null }; return { id: saved.id }; });
  expect((await repost(body, identity)).postId).toBe(30); expect((await repost(body, identity)).postId).toBe(31);
  expect(company.allowPost).toBe(3); expect(inserts()).toHaveLength(2);
  expect(inserts()[0][1].replacements[0]).not.toBe(inserts()[1][1].replacements[0]);
});
