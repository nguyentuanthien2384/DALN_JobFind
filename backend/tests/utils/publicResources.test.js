const mockDb = {
  Company: { findOne: jest.fn() },
  Post: { findOne: jest.fn() },
  User: {},
  Account: {}
};

jest.mock('../../src/models/index', () => mockDb);

const {
  findPublicCompany,
  findPublicPost,
  isPostOpenForApplications
} = require('../../src/utils/publicResources');

describe('public resource scope', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads only active and approved companies', async () => {
    mockDb.Company.findOne.mockResolvedValue({ id: 4 });
    await expect(findPublicCompany(4)).resolves.toEqual({ id: 4 });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4, statusCode: 'S1', censorCode: 'CS1' },
      attributes: ['id']
    }));
  });

  test('loads a public job through an active account and approved company', async () => {
    mockDb.Post.findOne.mockResolvedValue({ id: 9 });
    await findPublicPost(9);
    const query = mockDb.Post.findOne.mock.calls[0][0];
    expect(query.where).toEqual({ id: 9, statusCode: 'PS1' });
    expect(query).toEqual(expect.objectContaining({ raw: true, nest: true }));
    expect(query.include[0]).toEqual(expect.objectContaining({ required: true }));
    expect(query.include[0].include[0]).toEqual(expect.objectContaining({
      where: { statusCode: 'S1' }, required: true
    }));
    expect(query.include[0].include[1]).toEqual(expect.objectContaining({
      where: { statusCode: 'S1', censorCode: 'CS1' }, required: true
    }));
  });

  test('accepts only finite, non-expired application deadlines', () => {
    expect(isPostOpenForApplications(null, 100)).toBe(false);
    expect(isPostOpenForApplications({ timeEnd: 'invalid' }, 100)).toBe(false);
    expect(isPostOpenForApplications({ timeEnd: '99' }, 100)).toBe(false);
    expect(isPostOpenForApplications({ timeEnd: '100' }, 100)).toBe(true);
  });
});
