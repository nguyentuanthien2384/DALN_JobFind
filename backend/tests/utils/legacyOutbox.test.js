const mockDb = { sequelize: { query: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { enqueueLegacyJobUpdated: enqueue } = require('../../src/utils/legacyOutbox');
const transaction = { id: 'posting-transaction' };
const fixture = () => ({
  post: { id: 7, userId: 8, detailPostId: 90, statusCode: 'PS1', timePost: 1789000000000, timeEnd: '1789999999999', isHot: 0,
    internalToken: 'PRIVATE_POST', save: jest.fn() },
  detail: { id: 90, name: 'Developer', descriptionHTML: '<p>Job</p>', descriptionMarkdown: 'Job', amount: 2,
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1', internal: 'PRIVATE_DETAIL' },
  owner: { id: 8, companyId: 3, email: 'PRIVATE_EMAIL' },
  company: { id: 3, name: 'Example', thumbnail: 'logo', statusCode: 'S2', censorCode: 'CS2', file: 'PRIVATE_LICENSE', allowPost: 20 }
});
const insert = () => mockDb.sequelize.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO outbox_events'));
beforeEach(() => mockDb.sequelize.query.mockReset().mockResolvedValue([[{ engine: 'InnoDB' }]]));

test('uses only locked snapshot fields, correct post ID and persisted legacy origin in the same transaction', async () => {
  const input = fixture(); const eventId = await enqueue(input, transaction);
  const [sql, options] = insert();
  expect(options.transaction).toBe(transaction);
  expect(options.replacements).toEqual([eventId, 'legacy-job', '7', 'job.updated', expect.any(String), expect.any(Date)]);
  expect(eventId).toMatch(/^[a-f0-9-]{36}$/);
  const { job } = JSON.parse(options.replacements[4]);
  expect(job).toEqual({ id: 7, statusCode: 'PS1', timePost: 1789000000000, timeEnd: '1789999999999', isHot: 0, userId: 8,
    name: 'Developer', descriptionHTML: '<p>Job</p>', descriptionMarkdown: 'Job', amount: 2,
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1', companyId: 3,
    companyName: 'Example', companyLogo: 'logo', companyStatusCode: 'S2', companyCensorCode: 'CS2' });
  expect(options.replacements[4]).not.toContain('PRIVATE_'); expect(sql).not.toContain('Developer');
  expect(mockDb.sequelize.query).toHaveBeenCalledTimes(2); // metadata + INSERT, no stale join/second connection
  input.post.statusCode = 'PS4'; input.detail.name = 'Later edit'; input.company.statusCode = 'S1';
  expect(JSON.parse(options.replacements[4]).job).toEqual(job);
});
test.each(['PS1', 'PS2', 'PS3', 'PS4'])('persists the exact accepted %s state and never invents job.created/moderated or AI', async statusCode => {
  const input = fixture(); input.post.statusCode = statusCode;
  await enqueue(input, transaction);
  expect(JSON.parse(insert()[1].replacements[4]).job.statusCode).toBe(statusCode);
  expect(insert()[1].replacements[3]).toBe('job.updated');
});
test.each([null, { id: 8, companyId: null }])('retains an orphan owner/company as null rather than inventing public approval: %j', async owner => {
  const input = fixture(); input.owner = owner; input.company = null;
  await enqueue(input, transaction);
  expect(JSON.parse(insert()[1].replacements[4]).job).toMatchObject({ userId: 8, companyId: null, companyName: null,
    companyLogo: null, companyStatusCode: null, companyCensorCode: null });
});
test('requires a transaction and rejects absent/nontransactional outbox without schema repair', async () => {
  await expect(enqueue(fixture())).rejects.toThrow('transaction'); expect(mockDb.sequelize.query).not.toHaveBeenCalled();
  for (const tables of [[], [{ engine: 'MyISAM' }]]) {
    mockDb.sequelize.query.mockResolvedValueOnce([tables]);
    await expect(enqueue(fixture(), transaction)).rejects.toThrow('chưa sẵn sàng');
  }
  expect(insert()).toBeUndefined();
});
test.each(['metadata', 'insert'])('propagates %s failure so the caller rolls back', async stage => {
  if (stage === 'insert') mockDb.sequelize.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]]);
  mockDb.sequelize.query.mockRejectedValueOnce(new Error('synthetic DB failure'));
  await expect(enqueue(fixture(), transaction)).rejects.toThrow('synthetic DB failure');
});
test('rejects invalid current data before inserting, instead of silently losing the search update', async () => {
  const input = fixture(); input.post.statusCode = 'INVALID';
  await expect(enqueue(input, transaction)).rejects.toThrow('EVENT_PAYLOAD_INVALID'); expect(insert()).toBeUndefined();
});
