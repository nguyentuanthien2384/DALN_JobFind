const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn(), update: jest.fn()
});
const mockDb = {
  Company: model(), User: model(), Account: model(), Post: model(), Allcode: {}, DetailPost: {}
};
const mockUpload = jest.fn();
const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/utils/cloudinary', () => ({ uploader: { upload: mockUpload } }));
jest.mock('nodemailer', () => ({ createTransport: mockCreateTransport }));

const service = require('../../src/services/companyService');

const validCompany = (extra = {}) => ({
  id: 4, name: 'Acme', phonenumber: '0901', address: 'HN', descriptionHTML: '<p>x</p>',
  descriptionMarkdown: 'x', amountEmployer: 10, userId: 7, ...extra
});

const reset = () => {
  for (const item of Object.values(mockDb)) {
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  mockUpload.mockReset();
  mockSendMail.mockReset();
  mockCreateTransport.mockClear();
};

describe('companyService', () => {
  beforeEach(reset);

  test('all public functions reject incomplete requests before mutation', async () => {
    const invalid = [
      ['handleCreateNewCompany', {}], ['handleUpdateCompany', {}], ['handleBanCompany', null],
      ['handleUnBanCompany', null], ['handleAddUserCompany', {}], ['getListCompany', {}],
      ['getDetailCompanyById', null], ['getDetailCompanyByUserId', {}], ['getAllUserByCompanyId', {}],
      ['handleQuitCompany', {}], ['getAllCompanyByAdmin', {}], ['handleAccecptCompany', {}]
    ];
    for (const [method, arg] of invalid) expect((await service[method](arg)).errCode).toBe(1);
  });

  test('creates a company, uploads images, and promotes its owner', async () => {
    mockDb.Company.findOne.mockResolvedValue(null);
    mockUpload.mockResolvedValueOnce({ url: 'thumb' }).mockResolvedValueOnce({ url: 'cover' });
    mockDb.Company.create.mockResolvedValue({ id: 4 });
    const user = { save: jest.fn() };
    const account = { roleCode: 'EMPLOYER', save: jest.fn() };
    mockDb.User.findOne.mockResolvedValue(user);
    mockDb.Account.findOne.mockResolvedValue(account);
    const result = await service.handleCreateNewCompany(validCompany({ thumbnail: 'a', coverimage: 'b', file: 'license' }));
    expect(result).toEqual(expect.objectContaining({ errCode: 0, companyId: 4 }));
    expect(mockDb.Company.create).toHaveBeenCalledWith(expect.objectContaining({
      thumbnail: 'thumb', coverimage: 'cover', censorCode: 'CS3', file: 'license'
    }));
    expect(user.companyId).toBe(4);
    expect(account.roleCode).toBe('COMPANY');
    expect(user.save).toHaveBeenCalled();
    expect(account.save).toHaveBeenCalled();
  });

  test('creation rejects duplicate names and reports a missing owner', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 1 });
    expect((await service.handleCreateNewCompany(validCompany())).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    mockDb.Company.create.mockResolvedValueOnce({ id: 4 });
    mockDb.User.findOne.mockResolvedValueOnce(null);
    mockDb.Account.findOne.mockResolvedValueOnce(null);
    expect((await service.handleCreateNewCompany(validCompany())).errCode).toBe(2);
    expect(mockDb.Company.create).toHaveBeenLastCalledWith(expect.objectContaining({
      thumbnail: '', coverimage: '', censorCode: 'CS2', file: null
    }));
  });

  test('updates an active company, images and verification status', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null); // uniqueness check
    const row = { statusCode: 'S1', file: null, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(row);
    mockUpload.mockResolvedValueOnce({ url: 'thumb' }).mockResolvedValueOnce({ url: 'cover' });
    const result = await service.handleUpdateCompany(validCompany({ thumbnail: 'a', coverimage: 'b', file: 'license' }));
    expect(result.errCode).toBe(0);
    expect(row).toEqual(expect.objectContaining({
      name: 'Acme', thumbnail: 'thumb', coverimage: 'cover', file: 'license', censorCode: 'CS3'
    }));
  });

  test('update handles duplicate, missing and banned companies', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 99 });
    expect((await service.handleUpdateCompany(validCompany())).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect((await service.handleUpdateCompany(validCompany())).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ statusCode: 'S2' });
    expect((await service.handleUpdateCompany(validCompany())).errCode).toBe(2);
  });

  test('ban/unban transitions existing companies and safely handles missing rows', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.handleBanCompany(4)).errCode).toBe(2);
    const banned = { statusCode: 'S1', save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(banned);
    expect((await service.handleBanCompany(4)).errCode).toBe(0);
    expect(banned.statusCode).toBe('S2');

    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.handleUnBanCompany(4)).errCode).toBe(2);
    const unbanned = { statusCode: 'S2', save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(unbanned);
    expect((await service.handleUnBanCompany(4)).errCode).toBe(0);
    expect(unbanned.statusCode).toBe('S1');
  });

  test('approves or rejects company verification and emails its owner', async () => {
    const company = { id: 4, name: 'Acme', userId: 7, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.handleAccecptCompany({ companyId: 99, note: 'null' })).errCode).toBe(2);

    mockDb.Company.findOne.mockResolvedValueOnce(company);
    mockDb.User.findOne.mockResolvedValueOnce({ email: 'owner@example.com' });
    expect((await service.handleAccecptCompany({ companyId: 4, note: 'null' })).errCode).toBe(0);
    expect(company.censorCode).toBe('CS1');
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com' }), expect.any(Function));

    mockDb.Company.findOne.mockResolvedValueOnce(company);
    mockDb.User.findOne.mockResolvedValueOnce({ email: 'owner@example.com' });
    await service.handleAccecptCompany({ companyId: 4, note: 'bad license' });
    expect(company.censorCode).toBe('CS2');
  });

  test('adds only employer accounts that exist and do not already belong to a company', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.handleAddUserCompany({ companyId: 4, phonenumber: '0901' })).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValue({ id: 4 });
    mockDb.Account.findOne.mockResolvedValueOnce(null); // checkUserPhone
    expect((await service.handleAddUserCompany({ companyId: 4, phonenumber: '0901' })).errCode).toBe(2);

    mockDb.Account.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ roleCode: 'CANDIDATE', userId: 7 });
    expect((await service.handleAddUserCompany({ companyId: 4, phonenumber: '0901' })).errCode).toBe(1);

    mockDb.Account.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ roleCode: 'EMPLOYER', userId: 7 });
    mockDb.User.findOne.mockResolvedValueOnce({ companyId: 9 });
    expect((await service.handleAddUserCompany({ companyId: 4, phonenumber: '0901' })).errCode).toBe(3);

    const user = { companyId: null, save: jest.fn() };
    mockDb.Account.findOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ roleCode: 'EMPLOYER', userId: 7 });
    mockDb.User.findOne.mockResolvedValueOnce(user);
    expect((await service.handleAddUserCompany({ companyId: 4, phonenumber: '0901' })).errCode).toBe(0);
    expect(user.companyId).toBe(4);
  });

  test('lists active/admin companies with search and censorship filters', async () => {
    mockDb.Company.findAndCountAll.mockResolvedValue({ rows: ['c'], count: 1 });
    expect(await service.getListCompany({ limit: '5', offset: '0', search: 'Acme' })).toEqual({ errCode: 0, data: ['c'], count: 1 });
    expect(mockDb.Company.findAndCountAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 5, offset: 0, where: expect.any(Object) }));
    expect(await service.getAllCompanyByAdmin({ limit: '5', offset: '0', search: '4', censorCode: 'CS2' })).toEqual({ errCode: 0, data: ['c'], count: 1 });
    expect(mockDb.Company.findAndCountAll).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ censorCode: 'CS2' }) }));
  });

  test('loads public company detail and never exposes its verification attachment', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.getDetailCompanyById(4)).errorMessage).toBeDefined();
    const company = { id: 4, file: Buffer.from('license').toString('base64') };
    mockDb.Company.findOne.mockResolvedValueOnce(company);
    mockDb.User.findAll.mockResolvedValue([{ id: 7 }, { id: 8 }]);
    mockDb.Post.findAll.mockResolvedValue(['post']);
    const result = await service.getDetailCompanyById(4);
    expect(result.data.postData).toEqual(['post']);
    expect(result.data.file).toBeUndefined();
  });

  test('loads an owned company by user or direct company id', async () => {
    mockDb.User.findOne.mockResolvedValueOnce({ companyId: 4 });
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4 });
    expect((await service.getDetailCompanyByUserId({ userId: 7 })).data.id).toBe(4);
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.getDetailCompanyByUserId({ userId: 'null', companyId: 99 })).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4, file: Buffer.from('x').toString('base64') });
    expect((await service.getDetailCompanyByUserId({ userId: 'null', companyId: 4 })).data.file).toBe('x');
  });

  test('paginates company users', async () => {
    mockDb.User.findAndCountAll.mockResolvedValue({ rows: ['u'], count: 1 });
    expect(await service.getAllUserByCompanyId({ companyId: 4, limit: '10', offset: '0' })).toEqual({
      errCode: 0, data: ['u'], count: 1
    });
  });

  test('a company owner can dismiss only an employee of their own company', async () => {
    const request = {
      requesterUserId: 8, requesterCompanyId: 4, requesterRoleCode: 'COMPANY', targetUserId: 7
    };
    mockDb.User.findOne.mockResolvedValueOnce(null);
    expect((await service.handleQuitCompany(request)).errCode).toBe(2);
    const user = { id: 7, companyId: 4, save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4, userId: 8 });
    expect((await service.handleQuitCompany(request)).errCode).toBe(0);
    expect(mockDb.Post.update).toHaveBeenCalledWith({ userId: 8 }, { where: { userId: 7 } });
    expect(user.companyId).toBeNull();
  });

  test('company exit cannot target another company or orphan its owner', async () => {
    const ownerRequest = {
      requesterUserId: 8, requesterCompanyId: 4, requesterRoleCode: 'COMPANY', targetUserId: 7
    };
    mockDb.User.findOne.mockResolvedValueOnce({ id: 7, companyId: 9, save: jest.fn() });
    expect((await service.handleQuitCompany(ownerRequest)).errCode).toBe(3);

    expect((await service.handleQuitCompany({ ...ownerRequest, targetUserId: 8 })).errCode).toBe(3);

    mockDb.User.findOne.mockResolvedValueOnce({ id: 7, companyId: 4, save: jest.fn() });
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4, userId: 7 });
    expect((await service.handleQuitCompany(ownerRequest)).errCode).toBe(3);
    expect(mockDb.Post.update).not.toHaveBeenCalled();
  });

  test('an employee may leave only as their authenticated self', async () => {
    const user = { id: 7, companyId: 4, save: jest.fn() };
    mockDb.User.findOne.mockResolvedValueOnce(user);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 4, userId: 8 });
    const result = await service.handleQuitCompany({
      requesterUserId: 7,
      requesterCompanyId: 4,
      requesterRoleCode: 'EMPLOYER',
      targetUserId: 999
    });
    expect(result.errCode).toBe(0);
    expect(mockDb.User.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
  });

  test('public functions propagate unexpected database failures', async () => {
    const failures = [
      ['handleCreateNewCompany', validCompany(), mockDb.Company, 'findOne'],
      ['handleUpdateCompany', validCompany(), mockDb.Company, 'findOne'],
      ['handleBanCompany', 4, mockDb.Company, 'findOne'],
      ['handleUnBanCompany', 4, mockDb.Company, 'findOne'],
      ['handleAddUserCompany', { companyId: 4, phonenumber: 'x' }, mockDb.Company, 'findOne'],
      ['getListCompany', { limit: 1, offset: 0 }, mockDb.Company, 'findAndCountAll'],
      ['getDetailCompanyById', 4, mockDb.Company, 'findOne'],
      ['getDetailCompanyByUserId', { userId: 'null', companyId: 4 }, mockDb.Company, 'findOne'],
      ['getAllUserByCompanyId', { companyId: 4, limit: 1, offset: 0 }, mockDb.User, 'findAndCountAll'],
      ['handleQuitCompany', {
        requesterUserId: 8, requesterCompanyId: 4, requesterRoleCode: 'COMPANY', targetUserId: 7
      }, mockDb.User, 'findOne'],
      ['getAllCompanyByAdmin', { limit: 1, offset: 0 }, mockDb.Company, 'findAndCountAll'],
      ['handleAccecptCompany', { companyId: 4 }, mockDb.Company, 'findOne']
    ];
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toThrow('db');
    }
  });
});
