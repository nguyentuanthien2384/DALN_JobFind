const model = () => ({ findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() });
const mockDb = { Post: model(), DetailPost: model(), User: model(), Company: model(),
  sequelize: { transaction: jest.fn(), query: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { updateLegacyPost: edit } = require('../../src/utils/jobEdit');
const { jobRevision } = require('../../src/utils/jobRevision');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let post, detail, saved, company, body;
const identity = { roleCode: 'COMPANY', companyId: 3 };
const inserts = () => mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
const payload = () => JSON.parse(inserts()[0][1].replacements[4]).job;
beforeEach(() => {
  for (const model of Object.values(mockDb)) for (const fn of Object.values(model)) fn.mockReset();
  post = { id: 7, detailPostId: 90, userId: 8, statusCode: 'PS1', isHot: 1, timePost: '1700000000000',
    timeEnd: '1701000000000', save: jest.fn() };
  detail = { id: 90, name: 'Original', descriptionHTML: '<p>Original</p>', descriptionMarkdown: 'Original', amount: 2,
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1' };
  company = { id: 3, name: 'Example', thumbnail: 'logo', statusCode: 'S1', censorCode: 'CS1' };
  body = { ...detail, id: 7, postId: 999, userId: 9, timeEnd: post.timeEnd, expectedRevision: jobRevision(post, detail) };
  saved = null;
  mockDb.sequelize.transaction.mockImplementation(work => work(transaction));
  mockDb.sequelize.query.mockImplementation(async sql => sql.includes('TABLE_NAME IN')
    ? [['users', 'companies', 'posts', 'detailposts'].map(name => ({ name, engine: 'InnoDB' }))] : [[{ engine: 'InnoDB' }]]);
  mockDb.User.findAll.mockResolvedValue([{ id: 8, companyId: 3 }, { id: 9, companyId: 3 }]);
  mockDb.Company.findOne.mockResolvedValue(company); mockDb.Post.findOne.mockResolvedValue(post);
  mockDb.DetailPost.findOne.mockImplementation(async ({ where }) => where.id === 90 ? detail : saved);
  mockDb.DetailPost.create.mockImplementation(async next => { saved = { ...next, id: 91 }; return { id: 91 }; });
});

test.each(['PS1', 'PS2', 'PS3'])('a real edit from %s commits one PS3 update with current saved content and preserved paid/owner fields', async statusCode => {
  post.statusCode = statusCode; body.expectedRevision = jobRevision(post, detail);
  const result = await edit({ ...body, name: 'Updated', amount: '3', roleCode: 'ADMIN', companyId: 999, isHot: 0, timePost: 1 }, identity);
  expect(result).toMatchObject({ errCode: 0, changed: true, editRevision: jobRevision(post, saved) });
  expect(result.editRevision).not.toBe(body.expectedRevision);
  expect(inserts()).toHaveLength(1); expect(inserts()[0][1].transaction).toBe(transaction);
  expect(inserts()[0][1].replacements.slice(1, 4)).toEqual(['legacy-job', '7', 'job.updated']);
  expect(payload()).toMatchObject({ id: 7, name: 'Updated', amount: 3, statusCode: 'PS3', userId: 8, isHot: 1,
    timeEnd: '1701000000000', timePost: '1700000000000', companyId: 3, companyName: 'Example', companyLogo: 'logo' });
  expect(detail.name).toBe('Original'); expect(post.detailPostId).toBe(91);
  expect(post.save).toHaveBeenCalledWith({ transaction, fields: ['detailPostId', 'statusCode', 'updatedAt'] });
  expect(mockDb.DetailPost.findOne).toHaveBeenLastCalledWith({ where: { id: 91 }, transaction, lock: 'UPDATE', raw: true });
  expect(mockDb.Company.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction, lock: 'UPDATE',
    attributes: ['id', 'name', 'thumbnail', 'statusCode', 'censorCode'] }));
  expect(mockDb.sequelize.query).toHaveBeenCalledWith(expect.stringContaining("SET state = 'cancelled'"), expect.objectContaining({ transaction }));
});
test('metadata-only change still creates one update and cancels AI, without a new moderation or notification request', async () => {
  expect((await edit({ ...body, amount: 4 }, identity)).changed).toBe(true);
  expect(inserts()).toHaveLength(1); expect(payload()).toMatchObject({ name: detail.name, descriptionHTML: detail.descriptionHTML, amount: 4, statusCode: 'PS3' });
  expect(inserts()[0][1].replacements[3]).toBe('job.updated');
});
test.each(['PS1', 'PS2', 'PS3'])('matching no-op from %s never forks, cancels AI, checks outbox or emits', async statusCode => {
  post.statusCode = statusCode; body.expectedRevision = jobRevision(post, detail);
  expect(await edit({ ...body, amount: '2' }, identity)).toMatchObject({ errCode: 0, changed: false, editRevision: body.expectedRevision });
  expect(mockDb.DetailPost.create).not.toHaveBeenCalled(); expect(post.save).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
  expect(mockDb.sequelize.query.mock.calls.some(([sql]) => sql.includes('outbox_events') || sql.includes("SET state = 'cancelled'"))).toBe(false);
});
test('stale revision rejects even an otherwise matching no-op before any writes', async () => {
  expect(await edit({ ...body, expectedRevision: 'jv1-' + 'a'.repeat(64) }, identity)).toMatchObject({ errCode: 4, conflict: true });
  expect(mockDb.DetailPost.create).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
});
test('the outbox and response revision use the persisted row, not values retained in the create result or submitted body', async () => {
  mockDb.DetailPost.create.mockImplementation(async next => {
    saved = { ...next, id: 91, name: 'Database-normalized title' }; return { ...next, id: 91 };
  });
  const result = await edit({ ...body, name: 'Submitted title' }, identity);
  expect(payload().name).toBe(saved.name); expect(result.editRevision).toBe(jobRevision(post, saved));
});
test('cannot report success or enqueue a guessed snapshot if the new row cannot be read', async () => {
  mockDb.DetailPost.create.mockResolvedValue({ id: 91 });
  const result = await edit({ ...body, name: 'New' }, identity);
  expect(result.errCode).toBe(2); expect(result).not.toHaveProperty('editRevision'); expect(inserts()).toHaveLength(0);
});
test.each(['detail', 'post', 'reread', 'outbox', 'commit'])('propagates %s failure without returning a success revision', async stage => {
  const error = new Error('synthetic failed write');
  if (stage === 'detail') mockDb.DetailPost.create.mockRejectedValueOnce(error);
  if (stage === 'post') post.save.mockRejectedValueOnce(error);
  if (stage === 'reread') mockDb.DetailPost.findOne.mockResolvedValueOnce(detail).mockRejectedValueOnce(error);
  if (stage === 'outbox') {
    const query = mockDb.sequelize.query.getMockImplementation();
    mockDb.sequelize.query.mockImplementation((sql, options) => sql.includes('INSERT INTO outbox_events') ? Promise.reject(error) : query(sql, options));
  }
  if (stage === 'commit') mockDb.sequelize.transaction.mockImplementation(async work => { await work(transaction); throw error; });
  await expect(edit({ ...body, name: 'New' }, identity)).rejects.toBe(error);
});
test.each([[[]], [[{ engine: 'MyISAM' }]]])('fails closed for unavailable outbox %j, never falls back to direct emit', async tables => {
  const query = mockDb.sequelize.query.getMockImplementation();
  mockDb.sequelize.query.mockImplementation((sql, options) => sql.includes("TABLE_NAME = 'outbox_events'") ? Promise.resolve([tables]) : query(sql, options));
  expect(await edit({ ...body, name: 'New' }, identity)).toMatchObject({ errCode: 2 }); expect(inserts()).toHaveLength(0);
});
test.each(['deadline', 'PS4', 'company', 'membership'])('preserves the existing %s guard before writes/outbox', async guard => {
  if (guard === 'deadline') body.timeEnd = '1702000000000';
  if (guard === 'PS4') post.statusCode = 'PS4';
  if (guard === 'company') company.censorCode = 'CS2';
  if (guard === 'membership') mockDb.User.findAll.mockResolvedValue([{ id: 8, companyId: 3 }, { id: 9, companyId: 4 }]);
  expect((await edit({ ...body, name: 'New' }, identity)).errCode).toBe(2);
  expect(mockDb.DetailPost.create).not.toHaveBeenCalled(); expect(inserts()).toHaveLength(0);
});
test('ADMIN can edit with missing owner/company without changing authorship or inventing company approval', async () => {
  mockDb.User.findAll.mockResolvedValue([{ id: 9, companyId: null }]);
  expect((await edit({ ...body, name: 'New' }, { roleCode: 'ADMIN' })).changed).toBe(true);
  expect(payload()).toMatchObject({ userId: 8, companyId: null, companyName: null, companyStatusCode: null });
});
test('old clients without revision still get a durable event but not optimistic-concurrency protection', async () => {
  delete body.expectedRevision;
  expect((await edit({ ...body, name: 'Old client edit' }, identity)).changed).toBe(true);
  expect(inserts()).toHaveLength(1);
});
