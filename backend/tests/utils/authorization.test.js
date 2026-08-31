const mockFindPost = jest.fn();
const mockFindCandidateView = jest.fn();
const mockFindUser = jest.fn();

jest.mock('../../src/models/index', () => ({
  Post: { findOne: mockFindPost },
  CandidateView: { findOne: mockFindCandidateView },
  User: { findOne: mockFindUser }
}));

const authorization = require('../../src/utils/authorization');

const reqFor = (roleCode, companyId = null) => ({
  user: {
    id: 1,
    companyId,
    userAccountData: { roleCode },
    userCompanyData: companyId
      ? { id: companyId, statusCode: 'S1', censorCode: 'CS1' }
      : {}
  }
});

describe('authorization helpers', () => {
  beforeEach(() => {
    mockFindPost.mockReset();
    mockFindCandidateView.mockReset();
    mockFindUser.mockReset();
  });

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

  test('protects candidate profiles with self/admin access or a company entitlement', async () => {
    expect(await authorization.canAccessCandidateProfile({}, 4)).toBe(false);
    expect(await authorization.canAccessCandidateProfile(reqFor('CANDIDATE'), 0)).toBe(false);
    expect(await authorization.canAccessCandidateProfile(reqFor('CANDIDATE'), 1)).toBe(true);
    expect(await authorization.canAccessCandidateProfile(reqFor('ADMIN'), 9)).toBe(true);
    expect(await authorization.canAccessCandidateProfile(reqFor('CANDIDATE'), 9)).toBe(false);
    expect(await authorization.canAccessCandidateProfile(reqFor('EMPLOYER'), 9)).toBe(false);

    mockFindCandidateView.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });
    expect(await authorization.canAccessCandidateProfile(reqFor('EMPLOYER', 8), 9)).toBe(false);
    expect(await authorization.canAccessCandidateProfile(reqFor('COMPANY', 8), '9')).toBe(true);
    expect(mockFindCandidateView).toHaveBeenLastCalledWith({
      where: { companyId: 8, candidateId: 9 },
      attributes: ['id'],
      raw: true
    });
  });

  test('lets only a company owner manage users in the same tenant', async () => {
    expect(await authorization.canManageCompanyUser(reqFor('ADMIN'), 9)).toBe(true);
    expect(await authorization.canManageCompanyUser(reqFor('EMPLOYER', 8), 9)).toBe(false);
    expect(await authorization.canManageCompanyUser(reqFor('COMPANY'), 9)).toBe(false);

    mockFindUser.mockResolvedValueOnce({ id: 9, companyId: 8 });
    expect(await authorization.canManageCompanyUser(reqFor('COMPANY', 8), '9')).toBe(true);
    mockFindUser.mockResolvedValueOnce({ id: 9, companyId: 7 });
    expect(await authorization.canManageCompanyUser(reqFor('COMPANY', 8), 9)).toBe(false);
    expect(mockFindUser).toHaveBeenLastCalledWith({
      where: { id: 9 },
      attributes: ['id', 'companyId'],
      raw: true
    });
  });

  test('company owners can read same-company staff without consuming candidate entitlement', async () => {
    mockFindUser.mockResolvedValueOnce({ id: 9, companyId: 8 });
    expect(await authorization.canAccessCandidateProfile(reqFor('COMPANY', 8), 9)).toBe(true);
    expect(mockFindCandidateView).not.toHaveBeenCalled();
  });

  test('pending or banned companies cannot cross the operational tenant boundary', async () => {
    const pending = reqFor('COMPANY', 8);
    pending.user.userCompanyData.censorCode = 'CS3';
    expect(authorization.isApprovedCompany(pending)).toBe(false);
    expect(authorization.canAccessCompany(pending, 8)).toBe(false);
    expect(await authorization.canAccessPostApplicants(pending, 4)).toBe(false);
    expect(await authorization.canManageCompanyUser(pending, 9)).toBe(false);
    expect(await authorization.canAccessCandidateProfile(pending, 9)).toBe(false);
    expect(mockFindPost).not.toHaveBeenCalled();
    expect(mockFindUser).not.toHaveBeenCalled();
    expect(mockFindCandidateView).not.toHaveBeenCalled();
  });
});
