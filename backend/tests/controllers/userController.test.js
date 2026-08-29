const mockService = {
  handleCreateNewUser: jest.fn(), updateUserData: jest.fn(), banUser: jest.fn(), unbanUser: jest.fn(),
  handleLogin: jest.fn(), handleChangePassword: jest.fn(), getAllUser: jest.fn(),
  getDetailUserById: jest.fn(), checkUserPhone: jest.fn(), requestResetPasswordOtp: jest.fn(),
  changePaswordByPhone: jest.fn(), setDataUserSetting: jest.fn()
};

jest.mock('../../src/services/userService', () => mockService);

const controller = require('../../src/controllers/userController');
const { createRequest, createResponse } = require('../helpers/http');

const request = (roleCode = 'EMPLOYER') => createRequest({
  body: { id: 7, userId: 999, data: { id: 33 }, value: 'body' },
  query: { id: '7', phonenumber: '0901234567', value: 'query' },
  user: { id: 7, companyId: 11, userAccountData: { roleCode } }
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

  test('profile update is restricted to the owner or an admin', async () => {
    mockService.updateUserData.mockResolvedValue({ errCode: 0 });
    await controller.handleUpdateUser(request('CANDIDATE'), createResponse());
    expect(mockService.updateUserData).toHaveBeenCalled();

    const admin = request('ADMIN');
    admin.body.id = 99;
    await controller.handleUpdateUser(admin, createResponse());
    expect(mockService.updateUserData).toHaveBeenLastCalledWith(admin.body);

    const denied = request('CANDIDATE');
    denied.body.id = 99;
    const res = createResponse();
    await controller.handleUpdateUser(denied, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errCode: 3 }));
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

  test('candidate profile reads are private while recruiter/admin may inspect another user', async () => {
    mockService.getDetailUserById.mockResolvedValue({ errCode: 0 });
    const denied = request('CANDIDATE');
    denied.query.id = '99';
    const deniedRes = createResponse();
    await controller.getDetailUserById(denied, deniedRes);
    expect(deniedRes.status).toHaveBeenCalledWith(403);

    for (const role of ['EMPLOYER', 'COMPANY', 'ADMIN']) {
      const allowed = request(role);
      allowed.query.id = '99';
      await controller.getDetailUserById(allowed, createResponse());
    }
    expect(mockService.getDetailUserById).toHaveBeenCalledTimes(3);
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
