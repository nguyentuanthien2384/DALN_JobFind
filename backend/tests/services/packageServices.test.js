const model = () => ({
  findOne: jest.fn(), findAll: jest.fn(), findAndCountAll: jest.fn(), create: jest.fn()
});
const mockDb = {
  PackageCv: model(), PackagePost: model(), OrderPackageCV: model(), OrderPackage: model(),
  User: model(), Company: model(),
  Sequelize: { literal: jest.fn(() => 'literal') },
  sequelize: {
    literal: jest.fn(() => 'literal'), fn: jest.fn(() => 'fn'), col: jest.fn(() => 'col'),
    where: jest.fn(() => 'where')
  }
};
const mockPaymentIntegrity = {
  createPaymentLink: jest.fn(),
  completePayment: jest.fn()
};

jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/services/paymentIntegrityService', () => mockPaymentIntegrity);

const cvService = require('../../src/services/packageCvService');
const postService = require('../../src/services/packagePostService');

const configs = [
  {
    label: 'CV packages', service: cvService, packageModel: mockDb.PackageCv, orderModel: mockDb.OrderPackageCV,
    createMethod: 'creatNewPackageCv', updateMethod: 'updatePackageCv', packageIdKey: 'packageCvId',
    orderPackageKey: 'packageCvId', allowance: 'allowCv', isPost: false
  },
  {
    label: 'post packages', service: postService, packageModel: mockDb.PackagePost, orderModel: mockDb.OrderPackage,
    createMethod: 'creatNewPackagePost', updateMethod: 'updatePackagePost', packageIdKey: 'packageId',
    orderPackageKey: 'packagePostId', allowance: 'allowPost', isPost: true
  }
];

const reset = () => {
  for (const item of Object.values(mockDb)) {
    if (!item || typeof item !== 'object') continue;
    for (const fn of Object.values(item)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  mockPaymentIntegrity.createPaymentLink.mockReset();
  mockPaymentIntegrity.completePayment.mockReset();
  mockPaymentIntegrity.createPaymentLink.mockResolvedValue({ errCode: 1 });
  mockPaymentIntegrity.completePayment.mockResolvedValue({ errCode: 1 });
  mockDb.Sequelize.literal.mockReturnValue('literal');
  mockDb.sequelize.literal.mockReturnValue('literal');
  mockDb.sequelize.fn.mockReturnValue('fn');
  mockDb.sequelize.col.mockReturnValue('col');
  mockDb.sequelize.where.mockReturnValue('where');
};

describe.each(configs)('$label service', (config) => {
  const { service, packageModel, orderModel } = config;
  const validPackage = () => ({ id: 3, name: 'Gold', price: 10, value: 4, isHot: 0, isActive: 1 });

  beforeEach(reset);

  test('validates every endpoint with required parameters', async () => {
    expect((await service.getAllPackage({})).errCode).toBe(1);
    expect((await service.getPackageById({})).errCode).toBe(1);
    expect((await service.getPaymentLink({})).errCode).toBe(1);
    expect((await service.paymentOrderSuccess({})).errCode).toBe(1);
    expect((await service.setActiveTypePackage({ id: 1, isActive: '' })).errCode).toBe(1);
    expect((await service[config.createMethod]({})).errCode).toBe(1);
    expect((await service[config.updateMethod]({})).errCode).toBe(1);
    expect((await service.getStatisticalPackage({})).errCode).toBe(1);
    expect((await service.getHistoryTrade({})).errCode).toBe(1);
    expect((await service.getSumByYear({})).errCode).toBe(1);
    if (config.isPost) expect((await service.getPackageByType({ isHot: '' })).errCode).toBe(1);
  });

  test('lists packages with numeric pagination and optional search', async () => {
    packageModel.findAndCountAll.mockResolvedValue({ rows: ['p'], count: 1 });
    expect(await service.getAllPackage({ limit: '10', offset: '0', search: 'gold' })).toEqual({
      errCode: 0, data: ['p'], count: 1
    });
    expect(packageModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      limit: 10, offset: 0, where: expect.any(Object)
    }));
  });

  test('loads a package by id and returns a not-found response', async () => {
    packageModel.findOne.mockResolvedValueOnce(validPackage()).mockResolvedValueOnce(null);
    expect((await service.getPackageById({ id: 3 })).data).toEqual(validPackage());
    expect((await service.getPackageById({ id: 4 })).errCode).toBe(0);
  });

  test('returns selectable CV packages or post packages by hot flag', async () => {
    packageModel.findAll.mockResolvedValue(['p']);
    if (config.isPost) {
      expect(await service.getPackageByType({ isHot: 0 })).toEqual({ errCode: 0, data: ['p'] });
      expect(packageModel.findAll).toHaveBeenCalledWith({ where: { isHot: 0, isActive: 1 } });
    } else {
      expect(await service.getAllToSelect({})).toEqual({ errCode: 0, data: ['p'] });
      expect(packageModel.findAll).toHaveBeenCalledWith({ where: { isActive: 1 } });
    }
  });

  test('delegates payment creation and completion to the server-side integrity workflow', async () => {
    mockPaymentIntegrity.createPaymentLink.mockResolvedValueOnce({ errCode: 0, link: 'https://approve' });
    expect(await service.getPaymentLink({ id: 3, amount: '2', userId: 8 })).toEqual({
      errCode: 0, link: 'https://approve'
    });
    expect(mockPaymentIntegrity.createPaymentLink).toHaveBeenCalledWith({
      type: config.isPost ? 'POST' : 'CV', userId: 8, packageId: 3, amount: '2'
    });

    mockPaymentIntegrity.completePayment.mockResolvedValueOnce({ errCode: 0 });
    const callback = {
      PayerID: 'payer', paymentId: 'payment', token: 'token', amount: 999,
      userId: 8, [config.packageIdKey]: 999
    };
    expect((await service.paymentOrderSuccess(callback)).errCode).toBe(0);
    expect(mockPaymentIntegrity.completePayment).toHaveBeenCalledWith({
      type: config.isPost ? 'POST' : 'CV',
      userId: 8,
      PayerID: 'payer',
      paymentId: 'payment',
      token: 'token'
    });
  });

  test('activates/deactivates existing packages and reports missing packages', async () => {
    packageModel.findOne.mockResolvedValueOnce(null);
    expect((await service.setActiveTypePackage({ id: 3, isActive: 0 })).errCode).toBe(2);
    const row = { isActive: 1, save: jest.fn() };
    packageModel.findOne.mockResolvedValueOnce(row);
    const result = await service.setActiveTypePackage({ id: 3, isActive: 0 });
    expect(result.errCode).toBe(0);
    expect(row.isActive).toBe(0);
    expect(row.save).toHaveBeenCalled();
  });

  test('creates packages and translates duplicate-name validation', async () => {
    const payload = { name: 'Gold', price: 10, value: 4, ...(config.isPost ? { isHot: 0 } : {}) };
    packageModel.create.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
    expect((await service[config.createMethod](payload)).errCode).toBe(0);
    expect((await service[config.createMethod](payload)).errCode).toBe(2);
    packageModel.create.mockRejectedValueOnce(new Error('Validation error'));
    expect((await service[config.createMethod](payload)).errCode).toBe(2);
  });

  test('updates package fields and handles missing/duplicate packages', async () => {
    const payload = { id: 3, name: 'Gold', price: 10, value: 4, ...(config.isPost ? { isHot: 0 } : {}) };
    packageModel.findOne.mockResolvedValueOnce(null);
    expect((await service[config.updateMethod](payload)).errCode).toBe(2);
    const row = { save: jest.fn() };
    packageModel.findOne.mockResolvedValueOnce(row);
    expect((await service[config.updateMethod](payload)).errCode).toBe(0);
    expect(row).toEqual(expect.objectContaining({ name: 'Gold', price: 10, value: 4 }));
    packageModel.findOne.mockRejectedValueOnce(new Error('Validation error'));
    expect((await service[config.updateMethod](payload)).errCode).toBe(2);
  });

  test('combines packages with aggregated purchase count/revenue', async () => {
    packageModel.findAndCountAll.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }], count: 3 });
    orderModel.findAll.mockResolvedValue([
      { [config.orderPackageKey]: 1, count: 2, total: 20 },
      { [config.orderPackageKey]: 99, count: 1, total: 5 }
    ]);
    const result = await service.getStatisticalPackage({ fromDate: '2026-01-01', toDate: '2026-12-31', limit: 5, offset: 0 });
    expect(result).toEqual({
      errCode: 0,
      data: [
        { id: 1, count: 2, total: 20 },
        { id: 2, count: 0, total: 0 },
        { id: 3, count: 0, total: 0 }
      ],
      count: 3,
      sum: 25
    });
    expect(packageModel.findAndCountAll).toHaveBeenCalledWith({ limit: 5, offset: 0 });
  });

  test('statistics handle no purchases', async () => {
    packageModel.findAndCountAll.mockResolvedValue({ rows: [{ id: 1 }], count: 1 });
    orderModel.findAll.mockResolvedValue([]);
    expect((await service.getStatisticalPackage({ fromDate: '2026-01-01', toDate: '2026-01-02' })).data[0]).toEqual({
      id: 1, count: 0, total: 0
    });
  });

  test('returns company trade history with user/date/pagination scoping', async () => {
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.getHistoryTrade({ companyId: 9 })).errCode).toBe(2);
    mockDb.Company.findOne.mockResolvedValueOnce({ id: 9 });
    mockDb.User.findAll.mockResolvedValue([{ id: 8 }, { id: 10 }]);
    orderModel.findAndCountAll.mockResolvedValue({ rows: ['trade'], count: 1 });
    expect(await service.getHistoryTrade({
      companyId: 9, limit: '10', offset: '0', fromDate: '2026-01-01', toDate: '2026-01-02'
    })).toEqual({ errCode: 0, data: ['trade'], count: 1 });
    expect(orderModel.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 0 }));
  });

  test('returns monthly revenue for a requested year', async () => {
    orderModel.findAll.mockResolvedValue([{ month: 1, total: 100 }]);
    expect(await service.getSumByYear({ year: 2026 })).toEqual({ errCode: 0, data: [{ month: 1, total: 100 }] });
    expect(orderModel.findAll).toHaveBeenCalledWith(expect.objectContaining({ group: 'fn' }));
  });

  test('public queries propagate unexpected database failures', async () => {
    const failures = [
      ['getAllPackage', { limit: 1, offset: 0 }, packageModel, 'findAndCountAll'],
      ['getPackageById', { id: 1 }, packageModel, 'findOne'],
      ['setActiveTypePackage', { id: 1, isActive: 1 }, packageModel, 'findOne'],
      [config.createMethod, { name: 'N', price: 1, value: 1, ...(config.isPost ? { isHot: 0 } : {}) }, packageModel, 'create'],
      [config.updateMethod, { id: 1, name: 'N', price: 1, value: 1, ...(config.isPost ? { isHot: 0 } : {}) }, packageModel, 'findOne'],
      ['getStatisticalPackage', { fromDate: 'a', toDate: 'b' }, packageModel, 'findAndCountAll'],
      ['getHistoryTrade', { companyId: 1 }, mockDb.Company, 'findOne'],
      ['getSumByYear', { year: 2026 }, orderModel, 'findAll']
    ];
    if (config.isPost) failures.push(['getPackageByType', { isHot: 0 }, packageModel, 'findAll']);
    else failures.push(['getAllToSelect', {}, packageModel, 'findAll']);
    for (const [method, arg, target, dbMethod] of failures) {
      target[dbMethod].mockRejectedValueOnce(new Error('db'));
      await expect(service[method](arg)).rejects.toBeTruthy();
    }
    mockPaymentIntegrity.createPaymentLink.mockRejectedValueOnce(new Error('db'));
    await expect(service.getPaymentLink({ id: 1, amount: 1, userId: 2 })).rejects.toBeTruthy();
  });
});
