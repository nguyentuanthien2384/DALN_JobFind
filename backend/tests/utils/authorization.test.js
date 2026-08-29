const mockFindPost = jest.fn();

jest.mock('../../src/models/index', () => ({
  Post: { findOne: mockFindPost },
  User: {}
}));

const authorization = require('../../src/utils/authorization');

const reqFor = (roleCode, companyId = null) => ({
  user: { id: 1, companyId, userAccountData: { roleCode } }
});

describe('authorization helpers', () => {
  beforeEach(() => mockFindPost.mockReset());

  test('extracts roles and recognises admin/recruiter roles', () => {
    expect(authorization.getRole({})).toBeNull();
    expect(authorization.getRole(reqFor('ADMIN'))).toBe('ADMIN');
    expect(authorization.isAdmin(reqFor('ADMIN'))).toBe(true);
    expect(authorization.isAdmin(reqFor('EMPLOYER'))).toBe(false);
    expect(authorization.isRecruiter(reqFor('EMPLOYER'))).toBe(true);
    expect(authorization.isRecruiter(reqFor('COMPANY'))).toBe(true);
    expect(authorization.isRecruiter(reqFor('CANDIDATE'))).toBe(false);
  });

  test('normalises company ids and grants access only to admin or same company', () => {
    expect(authorization.getCompanyId(reqFor('EMPLOYER', '12'))).toBe(12);
    expect(authorization.getCompanyId(reqFor('EMPLOYER'))).toBeNull();
    expect(authorization.canAccessCompany(reqFor('ADMIN'), null)).toBe(true);
    expect(authorization.canAccessCompany(reqFor('EMPLOYER', 12), '12')).toBe(true);
    expect(authorization.canAccessCompany(reqFor('EMPLOYER', 12), '13')).toBe(false);
    expect(authorization.canAccessCompany(reqFor('EMPLOYER', 12), 'null')).toBe(false);
  });

  test('loads the owning company of a post', async () => {
    expect(await authorization.getCompanyIdOfPost(null)).toBeNull();
    mockFindPost.mockResolvedValueOnce(null);
    expect(await authorization.getCompanyIdOfPost(1)).toBeNull();
    mockFindPost.mockResolvedValueOnce({ userPostData: { companyId: '22' } });
    expect(await authorization.getCompanyIdOfPost(2)).toBe(22);
    expect(mockFindPost).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 2 }, raw: true, nest: true
    }));
  });

  test('protects applicant access by role and post ownership', async () => {
    expect(await authorization.canAccessPostApplicants(reqFor('ADMIN'), 4)).toBe(true);
    expect(await authorization.canAccessPostApplicants(reqFor('CANDIDATE', 8), 4)).toBe(false);
    mockFindPost.mockResolvedValueOnce({ userPostData: { companyId: 8 } });
    expect(await authorization.canAccessPostApplicants(reqFor('EMPLOYER', 8), 4)).toBe(true);
    mockFindPost.mockResolvedValueOnce({ userPostData: { companyId: 9 } });
    expect(await authorization.canAccessPostApplicants(reqFor('EMPLOYER', 8), 4)).toBe(false);
  });
});
