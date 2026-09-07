const mockDb = { sequelize: { query: jest.fn() }, FollowCompany: { findAll: jest.fn() } };
jest.mock('../../src/models/index', () => mockDb);
const { enqueueManualModerationNotifications: enqueue } = require('../../src/utils/manualModerationOutbox');
const transaction = { id: 'same-posting-transaction' };
const intent = { action: 'approve', postId: 7, posterId: 8, companyId: 3, companyName: 'Example', jobTitle: 'Job', note: 'Private note',
  timeEnd: '9000000000000', companyStatusCode: 'S1', companyCensorCode: 'CS1' };
const records = () => mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'))
  .flatMap(([, options]) => Array.from({ length: options.replacements.length / 6 }, (_, index) => ({
    id: options.replacements[index * 6], payload: JSON.parse(options.replacements[index * 6 + 4]), options
  })));
beforeEach(() => {
  mockDb.sequelize.query.mockReset().mockResolvedValue([[{ engine: 'InnoDB' }]]);
  mockDb.FollowCompany.findAll.mockReset().mockResolvedValue([]);
});
test('requires the caller transaction before any DB work', async () => {
  await expect(enqueue(intent)).rejects.toThrow('transaction'); expect(mockDb.sequelize.query).not.toHaveBeenCalled();
});
test.each([[[]], [[{ engine: 'MyISAM' }]]])('fails closed when outbox is absent or not transactional: %j', async tables => {
  mockDb.sequelize.query.mockResolvedValueOnce([tables]);
  await expect(enqueue(intent, transaction)).rejects.toThrow('chưa sẵn sàng'); expect(records()).toHaveLength(0);
});
test('snapshots recipients, dedups follows, keeps author/follower roles separate and hides private note from followers', async () => {
  mockDb.FollowCompany.findAll.mockResolvedValue([{ userId: 8 }, { userId: '8' }, { userId: 9 }, { userId: null }]);
  await enqueue(intent, transaction);
  const rows = records();
  expect(rows.map(row => [row.payload.recipientId, row.payload.audience, row.payload.note])).toEqual([
    [8, 'author', 'Private note'], [8, 'follower', null], [9, 'follower', null]
  ]);
  expect(new Set(rows.map(row => row.id)).size).toBe(3);
  expect(new Set(rows.map(row => row.payload.decisionId)).size).toBe(1);
  expect(mockDb.FollowCompany.findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction, attributes: ['userId'] }));
  for (const [, options] of mockDb.sequelize.query.mock.calls) expect(options.transaction).toBe(transaction);
});
test.each(['reject', 'ban', 'reopen'])('%s queues only the author and never reads follows', async action => {
  await enqueue({ ...intent, action }, transaction);
  expect(records()).toHaveLength(1); expect(records()[0].payload.action).toBe(action);
  expect(mockDb.FollowCompany.findAll).not.toHaveBeenCalled();
});
test('an orphan company still queues author notification', async () => {
  await enqueue({ ...intent, companyId: null, companyName: null }, transaction);
  expect(records()).toHaveLength(1); expect(mockDb.FollowCompany.findAll).not.toHaveBeenCalled();
});
test('bounds insert batches and retains every distinct recipient with one snapshot', async () => {
  mockDb.FollowCompany.findAll.mockResolvedValue(Array.from({ length: 205 }, (_, i) => ({ userId: i + 10 })));
  await enqueue(intent, transaction);
  expect(records()).toHaveLength(206);
  const inserts = mockDb.sequelize.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO outbox_events'));
  expect(inserts.map(([, opts]) => opts.replacements.length / 6)).toEqual([100, 100, 6]);
  expect(mockDb.FollowCompany.findAll).toHaveBeenCalledTimes(1);
});

test.each([null, undefined, '', true, {}, 'bad', '0', '-1', '2e12', ' 2000000000000 ', '2000000000000.0',
  '8640000000000001', '9007199254740992', '1700000000000'])('invalid/expired deadline %j keeps the author but never reads followers', async timeEnd => {
  await enqueue({ ...intent, timeEnd }, transaction);
  expect(mockDb.FollowCompany.findAll).not.toHaveBeenCalled();
  expect(records()).toHaveLength(1); expect(records()[0].payload).toMatchObject({ audience: 'author', note: 'Private note' });
});

test.each([{ companyId: null }, { companyId: 0 }, { companyId: -1 }, { companyStatusCode: 'S2' }, { companyStatusCode: null },
  { companyStatusCode: undefined }, { companyCensorCode: 'CS2' }, { companyCensorCode: null }, { companyCensorCode: undefined }])
('ineligible/missing company context %j keeps only the author', async patch => {
  await enqueue({ ...intent, ...patch }, transaction);
  expect(mockDb.FollowCompany.findAll).not.toHaveBeenCalled(); expect(records()).toHaveLength(1);
});

test.each([-1, 0, 1])('deadline relative to the snapshot clock (%s ms) uses strictly future eligibility', async delta => {
  const now = 1900000000000, clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  mockDb.FollowCompany.findAll.mockResolvedValue([{ userId: 9 }]);
  try {
    await enqueue({ ...intent, timeEnd: String(now + delta) }, transaction);
    expect(records()).toHaveLength(delta > 0 ? 2 : 1);
    expect(mockDb.FollowCompany.findAll).toHaveBeenCalledTimes(delta > 0 ? 1 : 0);
  } finally { clock.mockRestore(); }
});

test('eligibility context never leaks into saved event payloads', async () => {
  mockDb.FollowCompany.findAll.mockResolvedValue([{ userId: 9 }]);
  await enqueue(intent, transaction);
  for (const { payload } of records()) expect(Object.keys(payload).sort()).toEqual([
    'action', 'audience', 'companyName', 'decisionId', 'jobId', 'jobTitle', 'note', 'recipientId'
  ]);
});
test('propagates a later batch failure for the caller to roll back all writes', async () => {
  mockDb.FollowCompany.findAll.mockResolvedValue(Array.from({ length: 100 }, (_, i) => ({ userId: i + 10 })));
  mockDb.sequelize.query.mockResolvedValueOnce([[{ engine: 'InnoDB' }]]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('insert failed'));
  await expect(enqueue(intent, transaction)).rejects.toThrow('insert failed');
});
test('validates payload before insertion and preserves SQL-looking data as bound values', async () => {
  await expect(enqueue({ ...intent, action: 'invalid' }, transaction)).rejects.toThrow('EVENT_PAYLOAD_INVALID');
  expect(records()).toHaveLength(0);
  const note = "'); DROP TABLE posts; --";
  await enqueue({ ...intent, note }, transaction);
  expect(records()[0].payload.note).toBe(note);
  expect(mockDb.sequelize.query.mock.calls.at(-1)[0]).not.toContain(note);
});
