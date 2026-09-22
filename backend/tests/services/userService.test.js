jest.mock('../../src/services/accountSecurityService', () => ({ saveAndRevokeSessions: jest.fn(account => account.save()) }));
const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(),
  destroy: jest.fn(), bulkCreate: jest.fn()
});
const mockDb = {
  User: model(), Account: model(), UserSetting: model(), UserSkill: model(),
  Allcode: {}, Skill: {}, sequelize: { transaction: jest.fn(), query: jest.fn() }
};
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockRollback = jest.fn();
const mockCommit = jest.fn();
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
  mockRollback.mockReset();
  mockCommit.mockReset();
  mockDb.sequelize.transaction.mockImplementation(async (_options, work) => {
    try { const result = await work(mockTransaction); mockCommit(); return result; }
    catch (error) { mockRollback(); throw error; }
  });
  mockDb.User.findAll.mockResolvedValue([]);
  mockBcrypt.hashSync.mockReturnValue('hashed');
  mockEncodeToken.mockReturnValue('token');
  process.env.EMAIL_APP = 'fixture@example.invalid';
  process.env.EMAIL_APP_PASSWORD = 'fixture-only';
  mockSendMail.mockImplementation((_options, callback) => callback(null, {}));
};

const validUser = (extra = {}) => ({
  phonenumber: '0901234567', firstName: 'An', lastName: 'Nguyen', roleCode: 'CANDIDATE',
  password: 'secret12', email: 'an@candidate.vn', ...extra
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
    const result = await service.handleCreateNewUser(validUser({ image: 'data', email: '  An@Candidate.VN  ' }));
    expect(result.errCode).toBe(0);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({ image: 'avatar', email: 'an@candidate.vn' }), { transaction: mockTransaction });
    expect(mockDb.Account.create).toHaveBeenCalledWith(expect.objectContaining({
      phonenumber: '0901234567', password: 'hashed', roleCode: 'CANDIDATE', userId: 7
    }), { transaction: mockTransaction });
  });

  test('public registration cannot inject a company tenant id', async () => {
    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 9 });
    const result = await service.handleCreateNewUser(validUser({
      roleCode: 'EMPLOYER', companyId: 999
    }));
    expect(result.errCode).toBe(0);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({ companyId: null }), { transaction: mockTransaction });
  });

  test('company creator forces its own company id and emails generated passwords to a normalized address', async () => {
    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 8 });
    const payload = validUser({
      creatorRoleCode: 'COMPANY', creatorCompanyId: 12, companyId: 999,
      roleCode: 'EMPLOYER', password: undefined, email: '  New.Hire@Candidate.VN '
    });
    expect((await service.handleCreateNewUser(payload)).errCode).toBe(0);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({
      companyId: 12, email: 'new.hire@candidate.vn'
    }), { transaction: mockTransaction });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new.hire@candidate.vn' }), expect.any(Function)
    );
  });

  test.each([
    undefined,
    '',
    'not-an-email',
    'example@gmail.com',
    'candidate@example.com',
    'candidate@mail.example.net',
    'candidate@demo.example',
    'candidate@jobfind.local',
    'candidate@example.invalid',
    'candidate@example.test',
    'candidate@demo.localhost',
    'candidate@foo..com'
  ])('rejects a missing or non-deliverable registration email: %s', async (email) => {
    const result = await service.handleCreateNewUser(validUser({
      creatorRoleCode: 'COMPANY', creatorCompanyId: 12,
      roleCode: 'EMPLOYER', password: undefined, email
    }));
    expect(result.errCode).toBeGreaterThan(0);
    expect(mockDb.User.create).not.toHaveBeenCalled();
    expect(mockDb.Account.create).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
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
    expect(mockDb.User.create).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: 12 }), { transaction: mockTransaction });

    mockDb.Account.findOne.mockResolvedValue(null);
    mockDb.User.create.mockResolvedValue({ id: 11 });
    await service.handleCreateNewUser(validUser({
      creatorRoleCode: 'ADMIN', roleCode: 'CANDIDATE', companyId: 12
    }));
    expect(mockDb.User.create).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: null }), { transaction: mockTransaction });
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
    expect((await service.updateUserData({ id: 7, email: 'missing@candidate.vn' })).errCode).toBe(1);
    const user = { id: 7, companyId: 2, save: jest.fn() };
    const account = { roleCode: 'CANDIDATE', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockUpload.mockResolvedValueOnce({ url: 'avatar' });
    const result = await service.updateUserData({
      id: 7, firstName: 'A', lastName: 'B', email: '  A@B.COM ', image: 'data',
      roleCode: 'EMPLOYER', allowRoleChange: true, allowedRoleCodes: ['EMPLOYER']
    });
    expect(result.errCode).toBe(0);
    expect(result.user).toEqual(expect.objectContaining({
      id: 7, email: 'a@b.com', image: 'avatar', roleCode: 'EMPLOYER'
    }));
  });

  test('preserves the existing email when an admin/team edit omits that field', async () => {
    const user = {
      id: 7, companyId: 2, email: 'existing@candidate.vn', image: null,
      save: jest.fn()
    };
    const account = { roleCode: 'EMPLOYER', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Account.findOne.mockResolvedValueOnce(account);

    const result = await service.updateUserData({
      id: 7, firstName: 'Updated', lastName: 'User', roleCode: 'EMPLOYER'
    });

    expect(result.errCode).toBe(0);
    expect(user.email).toBe('existing@candidate.vn');
    expect(user.save).toHaveBeenCalled();
  });

  test.each([
    undefined,
    '',
    'not-an-email',
    'example@gmail.com',
    'candidate@example.org',
    'candidate@mail.example.com',
    'candidate@demo.example',
    'candidate@jobfind.local',
    'candidate@example.invalid',
    'candidate@example.test',
    'candidate@demo.localhost',
    'candidate@foo..com'
  ])('rejects a missing or non-deliverable profile email: %s', async (email) => {
    const result = await service.updateUserData({ id: 7, email });
    expect(result.errCode).toBeGreaterThan(0);
    expect(mockDb.User.findOne).not.toHaveBeenCalled();
    expect(mockDb.Account.findOne).not.toHaveBeenCalled();
  });

  test('rejects a role outside the actor scope before persisting any profile changes', async () => {
    const user = { id: 7, firstName: 'Old', save: jest.fn() };
    const account = { roleCode: 'EMPLOYER', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    const result = await service.updateUserData({
      id: 7, firstName: 'Changed', email: 'old@candidate.vn', roleCode: 'ADMIN',
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
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '12345678', otp: '1' })).errCode).toBe(1);
    const account = { password: 'old', save: jest.fn() };
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockVerifyOtp.mockReturnValueOnce({ valid: false, errMessage: 'bad otp' });
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '12345678', otp: '1' })).errCode).toBe(2);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockVerifyOtp.mockReturnValueOnce({ valid: true });
    expect((await service.changePaswordByPhone({ phonenumber: '0901', password: '12345678', otp: '1' })).errCode).toBe(0);
    expect(account.password).toBe('hashed');
    expect(account.save).toHaveBeenCalled();
  });

  test.each(['not-configured', 'delivery-failed'])('OTP never reports sent or retains a usable code when mail is %s', async mode => {
    mockDb.Account.findOne.mockResolvedValue({ userAccountData: { email: 'fixture@example.invalid' } });
    mockIssueOtp.mockReturnValue({ code: '123456', waitSeconds: 0 });
    if (mode === 'not-configured') process.env.EMAIL_APP_PASSWORD = '';
    else mockSendMail.mockImplementation((_options, callback) => callback(new Error('private transport details')));
    const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await service.requestResetPasswordOtp({ phonenumber: '0901' });
    expect(result.errCode).toBe(503);
    expect(mockClearOtp).toHaveBeenCalledWith('0901');
    expect(JSON.stringify(console.log.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(logger.mock.calls)).not.toContain('private transport details');
    logger.mockRestore();
  });

  test('login covers unknown phone, wrong password, locked account and success token claims', async () => {
    mockDb.Account.findOne.mockResolvedValueOnce(null); // check phone
    expect((await service.handleLogin({ phonenumber: '0901', password: 'x' })).errCode).toBe(2);

    mockDb.Account.findOne.mockResolvedValueOnce({ password: 'hash', statusCode: 'S1' });
    mockBcrypt.compareSync.mockReturnValueOnce(false);
    expect((await service.handleLogin({ phonenumber: '0901', password: 'x' })).errCode).toBe(2);

    mockDb.Account.findOne.mockResolvedValueOnce({ password: 'hash', statusCode: 'S2' });
    mockBcrypt.compareSync.mockReturnValueOnce(true);
    expect((await service.handleLogin({ phonenumber: '0901', password: 'x' })).errCode).toBe(1);

    mockDb.Account.findOne.mockResolvedValueOnce({
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
    expect((await service.handleChangePassword({ id: 7, password: 'newpass1', oldpassword: 'old' })).errCode).toBe(3);
    const account = { password: 'hash', save: jest.fn() };
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockBcrypt.compareSync.mockReturnValueOnce(false);
    expect((await service.handleChangePassword({ id: 7, password: 'newpass1', oldpassword: 'bad' })).errCode).toBe(2);
    mockDb.Account.findOne.mockResolvedValueOnce(account);
    mockBcrypt.compareSync.mockReturnValueOnce(true);
    expect((await service.handleChangePassword({ id: 7, password: 'newpass1', oldpassword: 'old' })).errCode).toBe(0);
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
      ['updateUserData', { id: 7, email: 'user@candidate.vn' }, mockDb.User, 'findOne'],
      ['requestResetPasswordOtp', { phonenumber: 'x' }, mockDb.Account, 'findOne'],
      ['changePaswordByPhone', { phonenumber: 'x', password: '12345678', otp: '1' }, mockDb.Account, 'findOne'],
      ['handleLogin', { phonenumber: 'x', password: 'x' }, mockDb.Account, 'findOne'],
      ['handleChangePassword', { id: 7, password: 'newpass1', oldpassword: 'y' }, mockDb.Account, 'findOne'],
      ['getAllUser', { limit: 1, offset: 0 }, mockDb.Account, 'findAndCountAll'],
      ['getDetailUserById', 7, mockDb.Account, 'findOne'],
      ['setDataUserSetting', { id: 7, data: {} }, mockDb.User, 'findOne']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
  });

  test('email login normalizes case and preserves short legacy passwords', async () => {
    mockDb.User.findAll.mockResolvedValue([{ id: 7 }]);
    mockDb.Account.findOne.mockResolvedValue({ userId: 7, password: 'hash', statusCode: 'S1', roleCode: 'CANDIDATE' });
    mockDb.User.findOne.mockResolvedValue({ id: 7, email: 'an@candidate.vn' });
    mockBcrypt.compareSync.mockReturnValue(true);
    expect((await service.handleLogin({ identifier: '  AN@CANDIDATE.VN  ', password: 'old' })).errCode).toBe(0);
    expect(mockDb.User.findAll.mock.calls[0][0].where.logic).toBe('an@candidate.vn');
    expect(mockDb.Account.findOne).toHaveBeenCalledWith({ where: { userId: 7 }, raw: true });
    expect(mockBcrypt.compareSync).toHaveBeenCalledWith('old', 'hash');
  });

  test.each(['identifier', 'email'])('accepts an email through %s while legacy phone payload still works', async field => {
    mockDb.User.findAll.mockResolvedValue([{ id: 7 }]);
    mockDb.Account.findOne.mockResolvedValue({ userId: 7, password: 'hash', statusCode: 'S1', roleCode: 'EMPLOYER' });
    mockDb.User.findOne.mockResolvedValue({ id: 7, companyId: 4 });
    mockBcrypt.compareSync.mockReturnValue(true);
    expect((await service.handleLogin({ [field]: 'an@candidate.vn', password: 'old' })).errCode).toBe(0);
    expect((await service.handleLogin({ phonenumber: '0901', password: 'old' })).errCode).toBe(0);
  });

  test.each([{ matches: [] }, { matches: [{ id: 7 }, { id: 8 }] }])('denies missing and ambiguous legacy email with the same generic response', async ({ matches }) => {
    mockDb.User.findAll.mockResolvedValue(matches);
    const result = await service.handleLogin({ identifier: 'same@candidate.vn', password: 'correct' });
    expect(result).toEqual({ errCode: 2, errMessage: 'Email, số điện thoại hoặc mật khẩu không chính xác' });
    expect(mockDb.Account.findOne).not.toHaveBeenCalled();
    expect(mockBcrypt.compareSync).not.toHaveBeenCalled();
  });

  test.each([
    { identifier: {} }, { identifier: ['0901'] }, { identifier: 901 }, { identifier: ' ' },
    { identifier: 'a'.repeat(255) }, { identifier: '0901', password: {} },
    { identifier: '0901', password: 'á'.repeat(513) }
  ])('rejects malformed login before querying the database: %p', payload => {
    return service.handleLogin({ password: 'old', ...payload }).then(result => {
      expect(result.errCode).toBe(2);
      expect(mockDb.User.findAll).not.toHaveBeenCalled();
      expect(mockDb.Account.findOne).not.toHaveBeenCalled();
    });
  });

  test.each([undefined, '', '1234567', 'á'.repeat(37)])('public registration requires a valid password: %p', password => {
    return service.handleCreateNewUser(validUser({ password })).then(result => {
      expect(result.fieldErrors.password).toBeTruthy();
      expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });

  test('rejects an existing normalized email inside the credential transaction', async () => {
    mockDb.User.findAll.mockResolvedValue([{ id: 8 }]);
    const result = await service.handleCreateNewUser(validUser({ email: ' SAME@CANDIDATE.VN ' }));
    expect(result.errCode).toBe(4);
    expect(result.fieldErrors.email).toBeTruthy();
    expect(mockDb.User.create).not.toHaveBeenCalled();
    expect(mockDb.Account.create).not.toHaveBeenCalled();
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });

  test('locks hashed credentials in a stable order and inserts both rows in the supplied transaction', async () => {
    const outerTransaction = { LOCK: { UPDATE: 'UPDATE' }, marker: 'outer' };
    mockDb.User.create.mockResolvedValue({ id: 91 });
    const user = await service.createRegisteredAccount(validUser({ firstName: ' An ', lastName: ' Nguyễn ' }), { transaction: outerTransaction });
    expect(user.id).toBe(91);
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
    const keys = mockDb.sequelize.query.mock.calls.map(call => call[1].replacements.key);
    expect(keys).toHaveLength(2);
    expect(keys).toEqual([...keys].sort());
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
    for (const call of mockDb.sequelize.query.mock.calls) expect(call[1].transaction).toBe(outerTransaction);
    expect(mockDb.User.create).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'An', lastName: 'Nguyễn', companyId: null }), { transaction: outerTransaction });
    expect(mockDb.Account.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 91 }), { transaction: outerTransaction });
  });

  test('rolls back User insertion when Account creation fails', async () => {
    mockDb.User.create.mockResolvedValue({ id: 92 });
    mockDb.Account.create.mockRejectedValue(new Error('account write failed'));
    await expect(service.createRegisteredAccount(validUser())).rejects.toThrow('account write failed');
    expect(mockRollback).toHaveBeenCalledTimes(1);
    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockDb.User.create.mock.calls[0][1]).toEqual({ transaction: mockTransaction });
    expect(mockDb.Account.create.mock.calls[0][1]).toEqual({ transaction: mockTransaction });
  });

  test('retries owned transactions on deadlock and does not retry a supplied transaction', async () => {
    const deadlock = Object.assign(new Error('deadlock'), { original: { errno: 1213 } });
    mockDb.sequelize.query.mockRejectedValueOnce(deadlock).mockResolvedValue(undefined);
    mockDb.User.create.mockResolvedValue({ id: 93 });
    expect((await service.createRegisteredAccount(validUser())).id).toBe(93);
    expect(mockDb.sequelize.transaction).toHaveBeenCalledTimes(2);
    expect(mockRollback).toHaveBeenCalledTimes(1);
    mockDb.sequelize.query.mockRejectedValueOnce(deadlock);
    await expect(service.createRegisteredAccount(validUser(), { transaction: mockTransaction })).rejects.toThrow('deadlock');
    expect(mockDb.sequelize.transaction).toHaveBeenCalledTimes(2);
  });

  test('blocks assigning a duplicate email during a profile update', async () => {
    const user = { id: 7, email: 'old@candidate.vn', save: jest.fn() };
    const account = { roleCode: 'CANDIDATE', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValue(user);
    mockDb.Account.findOne.mockResolvedValue(account);
    mockDb.User.findAll.mockResolvedValue([{ id: 8 }]);
    const result = await service.updateUserData({ id: 7, email: ' TAKEN@CANDIDATE.VN ' });
    expect(result.errCode).toBe(4);
    expect(result.fieldErrors.email).toBeTruthy();
    expect(user.email).toBe('old@candidate.vn');
    expect(user.save).not.toHaveBeenCalled();
    expect(account.save).not.toHaveBeenCalled();
    expect(mockRollback).toHaveBeenCalledTimes(1);
  });

  test('keeps an existing legacy email when editing unrelated profile fields', async () => {
    const user = { id: 7, email: 'DUPLICATE@candidate.vn', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValue(user);
    mockDb.Account.findOne.mockResolvedValue({ roleCode: 'CANDIDATE', save: jest.fn() });
    expect((await service.updateUserData({ id: 7, firstName: 'Changed', email: ' duplicate@candidate.vn ' })).errCode).toBe(0);
    expect(mockDb.User.findAll).not.toHaveBeenCalled();
    expect(user.email).toBe('duplicate@candidate.vn');
  });

  test.each(['1234567', 'á'.repeat(37), {}])('password change and reset enforce the same policy before database access: %p', password => {
    return Promise.all([
      service.handleChangePassword({ id: 7, oldpassword: 'legacy', password }),
      service.changePaswordByPhone({ phonenumber: '0901', otp: '123456', password })
    ]).then(results => {
      for (const result of results) expect(result.fieldErrors.password).toBeTruthy();
      expect(mockDb.Account.findOne).not.toHaveBeenCalled();
      expect(mockVerifyOtp).not.toHaveBeenCalled();
    });
  });
});
