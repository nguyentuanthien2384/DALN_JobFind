const mockDb = {
  sequelize: { query: jest.fn() },
  User: { findOne: jest.fn() },
  Company: { findOne: jest.fn() }
};

jest.mock('../../src/models/index', () => mockDb);

const {
  PostingQuotaError,
  normalizePostHot,
  assertTransactionalPostingTables,
  lockPostingCompany,
  consumeLockedPostingQuota
} = require('../../src/utils/postingQuota');

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const requiredTables = ['users', 'companies', 'posts', 'detailposts'];
const transactionalTables = () => requiredTables.map(name => ({ name, engine: 'InnoDB' }));

beforeEach(() => {
  mockDb.sequelize.query.mockReset();
  mockDb.User.findOne.mockReset();
  mockDb.Company.findOne.mockReset();
});

describe('normalizePostHot', () => {
  test.each([
    [true, 1], [1, 1], ['1', 1],
    [false, 0], [0, 0], ['0', 0], [undefined, 0]
  ])('normalizes %j to %i', (input, expected) => {
    expect(normalizePostHot(input)).toBe(expected);
  });

  test.each([null, '', 'true', 'false', ' 1', '01', 2, -1, NaN, {}, []])
  ('rejects unsupported value %j with a quota validation error', input => {
    let error;
    try {
      normalizePostHot(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PostingQuotaError);
    expect(error).toMatchObject({ errCode: 2, message: 'Loại tin tuyển dụng không hợp lệ' });
  });
});

describe('assertTransactionalPostingTables', () => {
  test('checks every required table in the same transaction', async () => {
    mockDb.sequelize.query.mockResolvedValue([transactionalTables().reverse()]);

    await expect(assertTransactionalPostingTables(transaction)).resolves.toBeUndefined();

    expect(mockDb.sequelize.query).toHaveBeenCalledTimes(1);
    expect(mockDb.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('information_schema.TABLES'),
      { replacements: { tables: requiredTables }, transaction }
    );
  });

  test.each(requiredTables)('rejects when %s is missing', async missing => {
    mockDb.sequelize.query.mockResolvedValue([transactionalTables().filter(table => table.name !== missing)]);

    await expect(assertTransactionalPostingTables(transaction)).rejects.toMatchObject({
      errCode: 2,
      message: 'Chưa thể đăng tin: cấu hình giao dịch dữ liệu chưa sẵn sàng'
    });
  });

  test.each(requiredTables)('rejects when %s is not transactional', async name => {
    mockDb.sequelize.query.mockResolvedValue([transactionalTables().map(table =>
      table.name === name ? { ...table, engine: 'MyISAM' } : table
    )]);

    await expect(assertTransactionalPostingTables(transaction)).rejects.toBeInstanceOf(PostingQuotaError);
  });

  test.each([
    ['duplicate replacing a missing table', [...transactionalTables().slice(0, 3), { name: 'posts', engine: 'InnoDB' }]],
    ['wrong table-name case', transactionalTables().map(table => table.name === 'posts' ? { ...table, name: 'Posts' } : table)]
  ])('rejects %s', async (_case, tables) => {
    mockDb.sequelize.query.mockResolvedValue([tables]);

    await expect(assertTransactionalPostingTables(transaction)).rejects.toBeInstanceOf(PostingQuotaError);
  });

  test('propagates a failed schema lookup', async () => {
    const failure = new Error('database unavailable');
    mockDb.sequelize.query.mockRejectedValue(failure);

    await expect(assertTransactionalPostingTables(transaction)).rejects.toBe(failure);
  });
});

describe('lockPostingCompany', () => {
  const approvedCompany = () => ({ id: 12, statusCode: 'S1', censorCode: 'CS1', allowPost: 2, allowHotPost: 1 });

  beforeEach(() => {
    mockDb.sequelize.query.mockResolvedValue([transactionalTables()]);
    mockDb.User.findOne.mockResolvedValue({ id: 7, companyId: 12 });
    mockDb.Company.findOne.mockImplementation(async () => approvedCompany());
  });

  test('locks the user before the approved company and returns the company row', async () => {
    const company = approvedCompany();
    mockDb.Company.findOne.mockResolvedValue(company);

    await expect(lockPostingCompany(7, transaction)).resolves.toBe(company);

    expect(mockDb.User.findOne).toHaveBeenCalledWith({
      where: { id: 7 }, attributes: ['id', 'companyId'], transaction,
      lock: 'UPDATE', raw: false
    });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith({
      where: { id: 12 },
      attributes: ['id', 'name', 'thumbnail', 'statusCode', 'censorCode', 'allowPost', 'allowHotPost'],
      transaction, lock: 'UPDATE', raw: false
    });
    expect(mockDb.sequelize.query.mock.invocationCallOrder[0])
      .toBeLessThan(mockDb.User.findOne.mock.invocationCallOrder[0]);
    expect(mockDb.User.findOne.mock.invocationCallOrder[0])
      .toBeLessThan(mockDb.Company.findOne.mock.invocationCallOrder[0]);
  });

  test('does not read either account row if transactional tables are unavailable', async () => {
    mockDb.sequelize.query.mockResolvedValue([[]]);

    await expect(lockPostingCompany(7, transaction)).rejects.toBeInstanceOf(PostingQuotaError);
    expect(mockDb.User.findOne).not.toHaveBeenCalled();
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  });

  test.each([null, { id: 7, companyId: null }, { id: 7, companyId: 0 }])
  ('rejects a user without company membership: %j', async user => {
    mockDb.User.findOne.mockResolvedValue(user);

    await expect(lockPostingCompany(7, transaction)).rejects.toMatchObject({
      errCode: 2, message: 'Người dùng không thuộc công ty'
    });
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  });

  test.each([
    ['missing', null],
    ['inactive', { id: 12, statusCode: 'S2', censorCode: 'CS1' }],
    ['unapproved', { id: 12, statusCode: 'S1', censorCode: 'CS2' }]
  ])('rejects a %s company', async (_state, company) => {
    mockDb.Company.findOne.mockResolvedValue(company);

    await expect(lockPostingCompany(7, transaction)).rejects.toMatchObject({
      errCode: 2, message: 'Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại'
    });
  });

  test('propagates company lookup errors', async () => {
    const failure = new Error('lookup failed');
    mockDb.Company.findOne.mockRejectedValue(failure);

    await expect(lockPostingCompany(7, transaction)).rejects.toBe(failure);
  });

  test('propagates user lookup errors without reading the company', async () => {
    const failure = new Error('user lookup failed');
    mockDb.User.findOne.mockRejectedValue(failure);

    await expect(lockPostingCompany(7, transaction)).rejects.toBe(failure);
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  });
});

describe('consumeLockedPostingQuota', () => {
  test.each([
    [0, 'allowPost', 'allowHotPost'],
    [1, 'allowHotPost', 'allowPost']
  ])('decrements only the selected quota for isHot=%i and saves it in the existing transaction', async (isHot, field, otherField) => {
    const company = { allowPost: 1, allowHotPost: 3, save: jest.fn().mockResolvedValue(undefined) };
    const originalOtherQuota = company[otherField];

    await expect(consumeLockedPostingQuota(company, isHot, transaction)).resolves.toBeUndefined();

    expect(company[field]).toBe(isHot === 1 ? 2 : 0);
    expect(company[otherField]).toBe(originalOtherQuota);
    expect(company.save).toHaveBeenCalledTimes(1);
    expect(company.save).toHaveBeenCalledWith({ transaction, fields: [field], silent: true });
  });

  test('accepts a numeric quota returned as a string by the database', async () => {
    const company = { allowPost: '2', allowHotPost: 5, save: jest.fn().mockResolvedValue(undefined) };

    await consumeLockedPostingQuota(company, 0, transaction);

    expect(company.allowPost).toBe(1);
    expect(company.save).toHaveBeenCalledWith({ transaction, fields: ['allowPost'], silent: true });
  });

  test.each([
    [0, 'allowPost', 'Công ty bạn đã hết số lần đăng bài viết bình thường'],
    [1, 'allowHotPost', 'Công ty bạn đã hết số lần đăng bài viết nổi bật']
  ])('rejects exhausted quota for isHot=%i without saving', async (isHot, field, message) => {
    const company = { allowPost: 4, allowHotPost: 4, save: jest.fn() };
    company[field] = 0;

    await expect(consumeLockedPostingQuota(company, isHot, transaction))
      .rejects.toMatchObject({ errCode: 2, message });
    expect(company[field]).toBe(0);
    expect(company.save).not.toHaveBeenCalled();
  });

  test.each([-1, 0.5, NaN, Infinity, 'invalid', '', null, undefined, Number.MAX_SAFE_INTEGER + 1])
  ('rejects an invalid quota value %j before mutating or saving', async allowance => {
    const company = { allowPost: allowance, allowHotPost: 3, save: jest.fn() };

    await expect(consumeLockedPostingQuota(company, 0, transaction)).rejects.toBeInstanceOf(PostingQuotaError);

    expect(company.allowPost).toBe(allowance);
    expect(company.allowHotPost).toBe(3);
    expect(company.save).not.toHaveBeenCalled();
  });

  test('propagates a failed save instead of reporting a consumed quota', async () => {
    const failure = new Error('write failed');
    const company = { allowPost: 2, allowHotPost: 3, save: jest.fn().mockRejectedValue(failure) };

    await expect(consumeLockedPostingQuota(company, 0, transaction)).rejects.toBe(failure);
    expect(company.save).toHaveBeenCalledWith({ transaction, fields: ['allowPost'], silent: true });
  });
});
