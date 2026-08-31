const mockService = {
  handleCreateNewUser: jest.fn(), updateUserData: jest.fn(), banUser: jest.fn(), unbanUser: jest.fn(),
  handleLogin: jest.fn(), handleChangePassword: jest.fn(), getAllUser: jest.fn(),
  getDetailUserById: jest.fn(), checkUserPhone: jest.fn(), requestResetPasswordOtp: jest.fn(),
  changePaswordByPhone: jest.fn(), setDataUserSetting: jest.fn()
};
const mockCanAccessCandidateProfile = jest.fn();
const mockCanManageCompanyUser = jest.fn();

jest.mock('../../src/services/userService', () => mockService);
jest.mock('../../src/utils/authorization', () => ({
  canAccessCandidateProfile: mockCanAccessCandidateProfile,
  canManageCompanyUser: mockCanManageCompanyUser
}));

const controller = require('../../src/controllers/userController');
const { createRequest, createResponse } = require('../helpers/http');

const request = (roleCode = 'EMPLOYER') => createRequest({
  body: { id: 7, userId: 999, data: { id: 33 }, value: 'body' },
  query: { id: '7', phonenumber: '0901234567', value: 'query' },
  user: {
    id: 7,
    companyId: 11,
    userCompanyData: { id: 11, statusCode: 'S1', censorCode: 'CS1' },
    userAccountData: { roleCode }
  }
});

const cases = [
  ['handleCreateNewUser', 'handleCreateNewUser'],
  ['handleUpdateUser', 'updateUserData'],
  ['handleBanUser', 'banUser'],
  ['handleUnbanUser', 'unbanUser'],
  ['handleLogin', 'handleLogin'],
  ['handleChangePassword', 'handleChangePassword'],
  ['getAllUser', 'getAllUser'],
  ['getDetailUserById', 'getDetailUserById'],
  ['checkUserPhone', 'checkUserPhone'],
  ['requestResetPasswordOtp', 'requestResetPasswordOtp'],
  ['changePaswordByPhone', 'changePaswordByPhone'],
  ['setDataUserSetting', 'setDataUserSetting']
];

describe('userController', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());
  beforeEach(() => {
    mockCanAccessCandidateProfile.mockResolvedValue(true);
    mockCanManageCompanyUser.mockResolvedValue(false);
  });

  test('registration annotates the payload with the authenticated creator context', async () => {
    mockService.handleCreateNewUser.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleCreateNewUser(request(), createResponse());
    expect(mockService.handleCreateNewUser).toHaveBeenCalledWith(expect.objectContaining({
      id: 7, creatorRoleCode: 'EMPLOYER', creatorCompanyId: 11
    }));

    const guest = request();
    delete guest.user;
    mockService.handleCreateNewUser.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleCreateNewUser(guest, createResponse());
    expect(mockService.handleCreateNewUser).toHaveBeenLastCalledWith(expect.objectContaining({
      creatorRoleCode: null, creatorCompanyId: null
    }));
  });

  test('profile update is restricted to self, admin, or a same-company owner', async () => {
    mockService.updateUserData.mockResolvedValue({ errCode: 0 });
    await controller.handleUpdateUser(request('CANDIDATE'), createResponse());
    expect(mockService.updateUserData).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 7,
      allowRoleChange: false
    }));

    const admin = request('ADMIN');
    admin.body.id = 99;
    admin.body.roleCode = 'COMPANY';
    await controller.handleUpdateUser(admin, createResponse());
    expect(mockService.updateUserData).toHaveBeenLastCalledWith(expect.objectContaining({
      ...admin.body,
      allowRoleChange: true,
      allowedRoleCodes: ['ADMIN', 'COMPANY', 'EMPLOYER', 'CANDIDATE']
    }));

    const owner = request('COMPANY');
    owner.body.id = 88;
    owner.body.roleCode = 'EMPLOYER';
    mockCanManageCompanyUser.mockResolvedValueOnce(true);
    await controller.handleUpdateUser(owner, createResponse());
    expect(mockService.updateUserData).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 88,
      roleCode: 'EMPLOYER',
      allowRoleChange: true,
      allowedRoleCodes: ['COMPANY', 'EMPLOYER']
    }));

    const denied = request('CANDIDATE');
    denied.body.id = 99;
    const res = createResponse();
    await controller.handleUpdateUser(denied, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 3 }));
  });

  test('returns the current database identity and granted permission codes', async () => {
    const req = request('COMPANY');
    const res = createResponse();
    await controller.getCurrentAuthorization(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      errCode: 0,
      data: expect.objectContaining({
        userId: 7,
        roleCode: 'COMPANY',
        companyId: 11,
        companyStatusCode: 'S1',
        companyCensorCode: 'CS1',
        permissions: expect.arrayContaining(['company:manage', 'job:manage'])
      })
    }));
  });

  test('settings update has the same owner/admin boundary', async () => {
    mockService.setDataUserSetting.mockResolvedValue({ errCode: 0 });
    await controller.setDataUserSetting(request('CANDIDATE'), createResponse());
    const denied = request('CANDIDATE');
    denied.body.id = 99;
    const res = createResponse();
    await controller.setDataUserSetting(denied, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockService.setDataUserSetting).toHaveBeenCalledTimes(1);
  });

  test('candidate profile reads require self/admin/company entitlement authorization', async () => {
    mockService.getDetailUserById.mockResolvedValue({ errCode: 0 });
    const denied = request('CANDIDATE');
    denied.query.id = '99';
    mockCanAccessCandidateProfile.mockResolvedValueOnce(false);
    const deniedRes = createResponse();
    await controller.getDetailUserById(denied, deniedRes);
    expect(deniedRes.status).toHaveBeenCalledWith(403);
    expect(mockService.getDetailUserById).not.toHaveBeenCalled();

    const allowed = request('EMPLOYER');
    allowed.query.id = '99';
    await controller.getDetailUserById(allowed, createResponse());
    expect(mockCanAccessCandidateProfile).toHaveBeenLastCalledWith(allowed, '99');
    expect(mockService.getDetailUserById).toHaveBeenCalledWith('99');
  });

  test('sensitive mutations derive ids from the expected trusted location', async () => {
    mockService.banUser.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleBanUser(request(), createResponse());
    expect(mockService.banUser).toHaveBeenCalledWith(33);
    mockService.unbanUser.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleUnbanUser(request(), createResponse());
    expect(mockService.unbanUser).toHaveBeenCalledWith(33);
    mockService.handleChangePassword.mockResolvedValueOnce({ errCode: 0 });
    await controller.handleChangePassword(request(), createResponse());
    expect(mockService.handleChangePassword).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  test('basic endpoints forward their correct body/query value', async () => {
    const req = request();
    const mappings = [
      ['handleLogin', 'handleLogin', req.body],
      ['getAllUser', 'getAllUser', req.query],
      ['checkUserPhone', 'checkUserPhone', req.query.phonenumber],
      ['requestResetPasswordOtp', 'requestResetPasswordOtp', req.body],
      ['changePaswordByPhone', 'changePaswordByPhone', req.body]
    ];
    for (const [method, serviceMethod, arg] of mappings) {
      mockService[serviceMethod].mockResolvedValueOnce({ errCode: 0, data: method });
      const res = createResponse();
      await controller[method](req, res);
      expect(mockService[serviceMethod]).toHaveBeenLastCalledWith(arg);
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });

  test.each(cases)('%s converts unexpected service failures into the API error shape', async (method, serviceMethod) => {
    mockService[serviceMethod].mockRejectedValueOnce(new Error('failed'));
    const res = createResponse();
    await controller[method](request(), res);
    expect(res.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Error from server' });
  });
});
