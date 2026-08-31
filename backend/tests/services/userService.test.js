const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(),
  destroy: jest.fn(), bulkCreate: jest.fn()
});
const mockDb = {
  User: model(), Account: model(), UserSetting: model(), UserSkill: model(),
  Allcode: {}, Skill: {}
};
const mockBcrypt = {
  genSaltSync: jest.fn(() => 'salt'), hashSync: jest.fn(), compareSync: jest.fn()
};
const mockEncodeToken = jest.fn();
const mockUpload = jest.fn();
const mockIssueOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockClearOtp = jest.fn();
const mockSendMail = jest.fn();

jest.mock('../../src/models/index', () => mockDb);
jest.mock('bcryptjs', () => mockBcrypt);
jest.mock('../../src/utils/CommonUtils', () => ({ encodeToken: mockEncodeToken }));
jest.mock('../../src/utils/cloudinary', () => ({ uploader: { upload: mockUpload } }));
jest.mock('../../src/utils/otpStore', () => ({
  issueOtp: mockIssueOtp, verifyOtp: mockVerifyOtp, clearOtp: mockClearOtp
}));
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const service = require('../../src/services/userService');

const reset = () => {
  for (const item of Object.values(mockDb)) {
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  for (const fn of [mockBcrypt.hashSync, mockBcrypt.compareSync, mockEncodeToken, mockUpload, mockIssueOtp, mockVerifyOtp, mockClearOtp, mockSendMail]) fn.mockReset();
  mockBcrypt.hashSync.mockReturnValue('hashed');
  mockEncodeToken.mockReturnValue('token');
};

const validUser = (extra = {}) => ({
  phonenumber: '0901', firstName: 'An', lastName: 'Nguyen', roleCode: 'CANDIDATE',
  password: 'secret1', email: 'an@example.com', ...extra
});

describe('userService', () => {
  beforeAll(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
  afterAll(() => console.log.mockRestore());
  beforeEach(reset);

  test('all public functions validate missing input', async () => {
    const invalid = [
      ['handleCreateNewUser', {}], ['banUser', null], ['unbanUser', null], ['updateUserData', {}],
      ['handleLogin', {}], ['handleChangePassword', {}], ['getAllUser', {}], ['getDetailUserById', null],
      ['checkUserPhone', null], ['changePaswordByPhone', {}], ['requestResetPasswordOtp', {}],
      ['setDataUserSetting', {}]
    ];
    for (const [method, arg] of invalid) expect((await service[method](arg)).errCode).toBeGreaterThan(0);
  });

  test('prevents privilege escalation during registration', async () => {
    expect((await service.handleCreateNewUser(validUser({ roleCode: 'ADMIN' }))).errCode).toBe(3);
    expect((await service.handleCreateNewUser(validUser({ creatorRoleCode: 'COMPANY', roleCode: 'CANDIDATE' }))).errCode).toBe(3);
    expect((await service.handleCreateNewUser(validUser({ creatorRoleCode: 'COMPANY', roleCode: 'EMPLOYER' }))).errCode).toBe(3);
    expect((await service.handleCreateNewUser(validUser({ creatorRoleCode: 'EMPLOYER', roleCode: 'EMPLOYER' }))).errCode).toBe(3);
    expect((await service.handleCreateNewUser(validUser({ creatorRoleCode: 'CANDIDATE', roleCode: 'CANDIDATE' }))).errCode).toBe(3);
  });

  test('creates a user/account with hashed password and uploaded image', async () => {
    mockDb.Account.findOne.mockResolvedValue(null);
    mockUpload.mockResolvedValue({ url: 'avatar' });
    mockDb.User.create.mockResolvedValue({ id: 7 });
    const result = await service.handleCreateNewUser(validUser({ image: 'data' }));
    expect(result.errCode).toBe(0);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({ image: 'avatar', email: 'an@example.com' }));
    expect(mockDb.Account.create).toHaveBeenCalledWith(expect.objectContaining({
      phonenumber: '0901', password: 'hashed', roleCode: 'CANDIDATE', userId: 7
    }));
  });

  test('public registration cannot inject a company tenant id', async () => {
    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 9 });
    const result = await service.handleCreateNewUser(validUser({
      roleCode: 'EMPLOYER', companyId: 999
    }));
    expect(result.errCode).toBe(0);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: null }));
  });

  test('company creator forces its own company id and generated passwords are emailed', async () => {
    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 8 });
    const payload = validUser({
      creatorRoleCode: 'COMPANY', creatorCompanyId: 12, companyId: 999,
      roleCode: 'EMPLOYER', password: undefined, email: undefined
    });
    expect((await service.handleCreateNewUser(payload)).errCode).toBe(0);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 12 }));
    expect(mockSendMail).toHaveBeenCalled();
  });

  test('admin may create all supported roles and duplicate phones are rejected', async () => {
    mockDb.Account.findOne.mockResolvedValue({ id: 1 });
    expect((await service.handleCreateNewUser(validUser({ creatorRoleCode: 'ADMIN', roleCode: 'ADMIN' }))).errCode).toBe(1);
  });

  test('admin may assign recruiter tenant but candidate/admin accounts stay tenantless', async () => {
    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 10 });
    await service.handleCreateNewUser(validUser({
      creatorRoleCode: 'ADMIN', roleCode: 'EMPLOYER', companyId: 12
    }));
    expect(mockDb.User.create).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 12 }));

    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 11 });
    await service.handleCreateNewUser(validUser({
      creatorRoleCode: 'ADMIN', roleCode: 'CANDIDATE', companyId: 12
    }));
    expect(mockDb.User.create).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: null }));
  });

  test.each([
    ['banUser', 'S2'], ['unbanUser', 'S1']
  ])('%s changes account state and handles missing user/account', async (method, status) => {
    mockDb.User.findOne.mockResolvedValueOnce(null);
    expect((await service[method](7)).errCode).toBe(2);
    mockDb.User.findOne.mockResolvedValueOnce({ id: 7 });
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service[method](7)).errCode).toBe(2);
    const account = { statusCode: 'S0', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce({ id: 7 });
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    expect((await service[method](7)).errCode).toBe(0);
    expect(account.statusCode).toBe(status);
  });

  test('updates profile/account fields and returns the safe public projection', async () => {
    mockDb.User.findOne.mockResolvedValueOnce(null);
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.updateUserData({ id: 7 })).errCode).toBe(1);
    const user = { id: 7, companyId: 2, save: jest.fn() };
    const account = { roleCode: 'CANDIDATE', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockUpload.mockResolvedValueOnce({ url: 'avatar' });
    const result = await service.updateUserData({
      id: 7, firstName: 'A', lastName: 'B', email: 'a@b.com', image: 'data',
      roleCode: 'EMPLOYER', allowRoleChange: true, allowedRoleCodes: ['EMPLOYER']
    });
    expect(result.errCode).toBe(0);
    expect(result.user).toEqual(expect.objectContaining({ id: 7, image: 'avatar', roleCode: 'EMPLOYER' }));
  });

  test('rejects a role outside the actor scope before persisting any profile changes', async () => {
    const user = { id: 7, firstName: 'Old', save: jest.fn() };
    const account = { roleCode: 'EMPLOYER', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    const result = await service.updateUserData({
      id: 7, firstName: 'Changed', roleCode: 'ADMIN',
      allowRoleChange: true, allowedRoleCodes: ['COMPANY', 'EMPLOYER']
    });
    expect(result).toEqual(expect.objectContaining({ errCode: 3 }));
    expect(user.save).not.toHaveBeenCalled();
    expect(account.save).not.toHaveBeenCalled();
    expect(user.firstName).toBe('Old');
  });

  test('OTP request handles missing accounts/email, cooldown and masks recipient email', async () => {
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.requestResetPasswordOtp({ phonenumber: '0901' })).errCode).toBe(1);
    mockDb.Account.findOne.mockResolvedValueOnce({ userAccountData: {} });
    expect((await service.requestResetPasswordOtp({ phonenumber: '0901' })).errCode).toBe(3);
    mockDb.Account.findOne.mockResolvedValueOnce({ userAccountData: { email: 'alice@example.com' } });
    mockIssueOtp.mockReturnValueOnce({ code: null, waitSeconds: 42 });
    expect((await service.requestResetPasswordOtp({ phonenumber: '0901' })).errCode).toBe(4);
    mockDb.Account.findOne.mockResolvedValueOnce({ userAccountData: { email: 'alice@example.com' } });
    mockIssueOtp.mockReturnValueOnce({ code: '123456', waitSeconds: 0 });
    expect(await service.requestResetPasswordOtp({ phonenumber: '0901' })).toEqual(expect.objectContaining({
      errCode: 0, email: 'al***@example.com'
    }));
    expect(mockSendMail).toHaveBeenCalled();
  });

  test('password reset validates strength/account/OTP then saves a hash', async () => {
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '123', otp: '1' })).errCode).toBe(5);
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '123456', otp: '1' })).errCode).toBe(1);
    const account = { password: 'old', save: jest.fn() };
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockVerifyOtp.mockReturnValueOnce({ valid: false, errMessage: 'bad otp' });
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '123456', otp: '1' })).errCode).toBe(2);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockVerifyOtp.mockReturnValueOnce({ valid: true });
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '123456', otp: '1' })).errCode).toBe(0);
    expect(account.password).toBe('hashed');
    expect(account.save).toHaveBeenCalled();
  });

  test('login covers unknown phone, wrong password, locked account and success token claims', async () => {
    mockDb.Account.findOne.mockResolvedValueOnce(null); // check phone
    expect((await service.handleLogin({ phonenumber: '0901', password: 'x' })).errCode).toBe(2);

    mockDb.Account.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ password: 'hash', statusCode: 'S1' });
    mockBcrypt.compareSync.mockReturnValueOnce(false);
    expect((await service.handleLogin({ phonenumber: '0901', password: 'x' })).errCode).toBe(2);

    mockDb.Account.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ password: 'hash', statusCode: 'S2' });
    mockBcrypt.compareSync.mockReturnValueOnce(true);
    expect((await service.handleLogin({ phonenumber: '0901', password: 'x' })).errCode).toBe(1);

    mockDb.Account.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({
      password: 'hash', statusCode: 'S1', userId: 7, roleCode: 'EMPLOYER'
    });
    mockBcrypt.compareSync.mockReturnValueOnce(true);
    mockDb.User.findOne.mockResolvedValueOnce({ id: 7, companyId: 4 });
    const result = await service.handleLogin({ phonenumber: '0901', password: 'x' });
    expect(result).toEqual(expect.objectContaining({ errCode: 0, token: 'token' }));
    expect(mockEncodeToken).toHaveBeenCalledWith(7, 'EMPLOYER', 4);
  });

  test('authenticated password change handles missing account, wrong password and success', async () => {
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.handleChangePassword({ id: 7, password: 'newpass', oldpassword: 'old' })).errCode).toBe(3);
    const account = { password: 'hash', save: jest.fn() };
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockBcrypt.compareSync.mockReturnValueOnce(false);
    expect((await service.handleChangePassword({ id: 7, password: 'newpass', oldpassword: 'bad' })).errCode).toBe(2);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockBcrypt.compareSync.mockReturnValueOnce(true);
    expect((await service.handleChangePassword({ id: 7, password: 'newpass', oldpassword: 'old' })).errCode).toBe(0);
    expect(account.password).toBe('hashed');
  });

  test('lists users with pagination/search and loads detailed skills/file safely', async () => {
    mockDb.Account.findAndCountAll.mockResolvedValue({ rows: ['u'], count: 1 });
    expect(await service.getAllUser({ limit: '5', offset: '0', search: '090' })).toEqual({ errCode: 0, data: ['u'], count: 1 });
    expect(mockDb.Account.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 5, offset: 0, where: expect.any(Object) }));

    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.getDetailUserById(7)).errCode).toBe(2);
    const detail = {
      userAccountData: { id: 7, userSettingData: { file: Buffer.from('cv').toString('base64') } }
    };
    mockDb.Account.findOne.mockResolvedValueOnce(detail);
    mockDb.UserSkill.findAll.mockResolvedValue([{ Skill: { id: 1 } }]);
    const result = await service.getDetailUserById(7);
    expect(result.data.userAccountData.userSettingData.file).toBe('cv');
    expect(result.data.listSkills).toHaveLength(1);
  });

  test('creates/updates settings and replaces skills atomically at service level', async () => {
    mockDb.User.findOne.mockResolvedValueOnce(null);
    expect((await service.setDataUserSetting({ id: 7, data: {} })).errCode).toBe(2);
    const user = { id: 7 };
    const setting = { save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.UserSetting.findOne.mockResolvedValueOnce(setting);
    expect((await service.setDataUserSetting({ id: 7, data: { listSkills: [1, 2], isFindJob: 1 } })).errCode).toBe(0);
    expect(mockDb.UserSkill.destroy).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(mockDb.UserSkill.bulkCreate).toHaveBeenCalledWith([{ UserId: 7, SkillId: 1 }, { UserId: 7, SkillId: 2 }]);

    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.UserSetting.findOne.mockResolvedValueOnce(null);
    await service.setDataUserSetting({ id: 7, data: { salaryJobCode: 'S', isTakeMail: 1 } });
    expect(mockDb.UserSetting.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, isTakeMail: 1 }));
  });

  test('unexpected persistence failures reject each major workflow', async () => {
    const failures = [
      ['handleCreateNewUser', validUser(), mockDb.Account, 'findOne'],
      ['banUser', 7, mockDb.User, 'findOne'], ['unbanUser', 7, mockDb.User, 'findOne'],
      ['updateUserData', { id: 7 }, mockDb.User, 'findOne'],
      ['requestResetPasswordOtp', { phonenumber: 'x' }, mockDb.Account, 'findOne'],
      ['changePaswordByPhone', { phonenumber: 'x', password: '123456', otp: '1' }, mockDb.Account, 'findOne'],
      ['handleLogin', { phonenumber: 'x', password: 'x' }, mockDb.Account, 'findOne'],
      ['handleChangePassword', { id: 7, password: 'x', oldpassword: 'y' }, mockDb.Account, 'findOne'],
      ['getAllUser', { limit: 1, offset: 0 }, mockDb.Account, 'findAndCountAll'],
      ['getDetailUserById', 7, mockDb.Account, 'findOne'],
      ['setDataUserSetting', { id: 7, data: {} }, mockDb.User, 'findOne']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
  });
});
