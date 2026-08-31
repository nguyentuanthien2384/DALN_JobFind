const model = () => ({
  findOne: jest.fn(),
  create: jest.fn()
});

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockDb = {
  PackagePost: model(),
  PackageCv: model(),
  OrderPackage: model(),
  OrderPackageCV: model(),
  PaymentIntent: model(),
  User: model(),
  Company: model(),
  sequelize: {
    transaction: jest.fn()
  }
};
const mockPaypal = {
  configure: jest.fn(),
  payment: {
    create: jest.fn(),
    execute: jest.fn(),
    get: jest.fn()
  }
};

jest.mock('../../src/models/index', () => mockDb);
jest.mock('paypal-rest-sdk', () => mockPaypal);

const service = require('../../src/services/paymentIntegrityService');

const future = () => new Date(Date.now() + 60 * 60 * 1000);
const past = () => new Date(Date.now() - 60 * 1000);
const makePackage = (overrides = {}) => ({
  id: 3,
  name: 'Gold',
  price: 10,
  value: 4,
  isHot: 0,
  isActive: 1,
  ...overrides
});
const makeIntent = (overrides = {}) => ({
  id: 21,
  provider: 'PAYPAL',
  providerPaymentId: 'PAY-123',
  providerToken: 'EC-123',
  userId: 8,
  companyId: 9,
  packageType: 'POST',
  packageId: 3,
  quantity: 2,
  unitPrice: '10.00',
  totalPrice: '20.00',
  currency: 'USD',
  entitlementType: 'ALLOW_POST',
  entitlementAmount: 8,
  status: 'PENDING',
  expiresAt: future(),
  save: jest.fn(),
  ...overrides
});
const approvedPayment = (overrides = {}) => ({
  id: 'PAY-123',
  state: 'approved',
  transactions: [{ amount: { currency: 'USD', total: '20.00' } }],
  ...overrides
});
const callback = (overrides = {}) => ({
  type: 'POST',
  userId: 8,
  PayerID: 'PAYER-1',
  paymentId: 'PAY-123',
  token: 'EC-123',
  ...overrides
});

const reset = () => {
  for (const value of Object.values(mockDb)) {
    if (!value || typeof value !== 'object') continue;
    for (const fn of Object.values(value)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  for (const fn of Object.values(mockPaypal.payment)) fn.mockReset();
  mockDb.sequelize.transaction.mockImplementation(async (work) => work(transaction));
};

describe('paymentIntegrityService creates server-bound payment intents', () => {
  beforeEach(reset);

  test.each([
    {},
    { type: 'UNKNOWN', userId: 8, packageId: 3, amount: 1 },
    { type: 'POST', userId: 0, packageId: 3, amount: 1 },
    { type: 'POST', userId: 8, packageId: 0, amount: 1 },
    { type: 'POST', userId: 8, packageId: 3, amount: 0 },
    { type: 'POST', userId: 8, packageId: 3, amount: 1.5 },
    { type: 'POST', userId: 8, packageId: 3, amount: 1001 }
  ])('rejects invalid creation input %#', async (input) => {
    expect((await service.createPaymentLink(input)).errCode).toBe(1);
    expect(mockPaypal.payment.create).not.toHaveBeenCalled();
  });

  test('rejects missing, inactive, and malformed package definitions', async () => {
    mockDb.PackagePost.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePackage({ isActive: 0 }))
      .mockResolvedValueOnce(makePackage({ price: 0 }))
      .mockResolvedValueOnce(makePackage({ value: 1.5 }))
      .mockResolvedValueOnce(makePackage({ price: Number.POSITIVE_INFINITY }));

    for (let index = 0; index < 5; index += 1) {
      expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(2);
    }
    expect(mockPaypal.payment.create).not.toHaveBeenCalled();
  });

  test('requires an existing company membership before creating a provider payment', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    mockDb.User.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 8, companyId: null })
      .mockResolvedValueOnce({ id: 8, companyId: 9 });
    mockDb.Company.findOne.mockResolvedValueOnce(null);

    for (let index = 0; index < 3; index += 1) {
      expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(2);
    }
    expect(mockPaypal.payment.create).not.toHaveBeenCalled();
  });

  test.each([
    ['POST', mockDb.PackagePost, 'ALLOW_POST', '/admin/payment/success'],
    ['CV', mockDb.PackageCv, 'ALLOW_CV', '/admin/paymentCv/success']
  ])('persists a %s intent before exposing the approval URL', async (type, packageModel, entitlementType, returnPath) => {
    packageModel.findOne.mockResolvedValue(makePackage());
    mockDb.User.findOne.mockResolvedValue({ id: 8, companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockPaypal.payment.create.mockImplementation((payload, done) => done(null, {
      id: `PAY-${type}`,
      links: [{ rel: 'approval_url', href: `https://paypal.test/approve?token=EC-${type}` }]
    }));
    mockDb.PaymentIntent.create.mockResolvedValue({ id: 21 });

    const result = await service.createPaymentLink({ type, userId: 8, packageId: 3, amount: '2' });

    expect(result).toEqual({ errCode: 0, link: `https://paypal.test/approve?token=EC-${type}` });
    expect(mockPaypal.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      redirect_urls: expect.objectContaining({ return_url: expect.stringMatching(new RegExp(`${returnPath}$`)) }),
      transactions: [expect.objectContaining({
        amount: { currency: 'USD', total: '20.00' },
        item_list: { items: [expect.objectContaining({ price: '10.00', quantity: 2 })] }
      })]
    }), expect.any(Function));
    expect(mockDb.PaymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({
      providerPaymentId: `PAY-${type}`,
      providerToken: `EC-${type}`,
      userId: 8,
      companyId: 9,
      packageType: type,
      packageId: 3,
      quantity: 2,
      unitPrice: '10.00',
      totalPrice: '20.00',
      entitlementType,
      entitlementAmount: 8,
      status: 'PENDING',
      expiresAt: expect.any(Date)
    }));
  });

  test('snapshots hot-post entitlement and accepts an approval link discovered by token', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage({ isHot: 1 }));
    mockDb.User.findOne.mockResolvedValue({ companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockPaypal.payment.create.mockImplementation((payload, done) => done(null, {
      id: 'PAY-HOT',
      links: [{ href: 'https://paypal.test/approve?token=EC-HOT' }]
    }));
    mockDb.PaymentIntent.create.mockResolvedValue({ id: 1 });

    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(0);
    expect(mockDb.PaymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({ entitlementType: 'ALLOW_HOT_POST' }));
  });

  test('returns safe errors for provider rejection or incomplete provider responses', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    mockDb.User.findOne.mockResolvedValue({ companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockPaypal.payment.create
      .mockImplementationOnce((payload, done) => done(new Error('provider unavailable')))
      .mockImplementationOnce((payload, done) => done(null, { links: [] }))
      .mockImplementationOnce((payload, done) => done(null, {
        id: 'PAY-X', links: [{ rel: 'approval_url', href: 'not a URL' }]
      }));

    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(-1);
    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(-1);
    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(-1);
    expect(mockDb.PaymentIntent.create).not.toHaveBeenCalled();
  });

  test('rejects totals outside the supported decimal range', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage({ price: 9999999999 }));
    mockDb.User.findOne.mockResolvedValue({ companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });

    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 2 })).errCode).toBe(2);
    expect(mockPaypal.payment.create).not.toHaveBeenCalled();
  });
});

describe('paymentIntegrityService completes payments exactly once', () => {
  beforeEach(reset);

  test.each([
    {},
    { type: 'POST', userId: 8, paymentId: 'PAY', token: 'TOKEN' },
    { type: 'POST', userId: 8, PayerID: 'PAYER', token: 'TOKEN' },
    { type: 'POST', userId: 8, PayerID: 'PAYER', paymentId: 'PAY' }
  ])('rejects invalid callback input %#', async (input) => {
    expect((await service.completePayment(input)).errCode).toBe(1);
  });

  test('binds payment ID, token, user, and package type in the lookup', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValue(null);
    expect((await service.completePayment(callback())).errCode).toBe(2);
    expect(mockDb.PaymentIntent.findOne).toHaveBeenCalledWith({
      where: {
        provider: 'PAYPAL',
        providerPaymentId: 'PAY-123',
        providerToken: 'EC-123',
        userId: 8,
        packageType: 'POST'
      },
      raw: false
    });
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
  });

  test('treats a completed callback replay as idempotent success', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValue(makeIntent({ status: 'COMPLETED' }));
    const result = await service.completePayment(callback());
    expect(result).toEqual(expect.objectContaining({ errCode: 0, alreadyProcessed: true }));
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
  });

  test('rejects non-pending and expires stale intents before contacting PayPal', async () => {
    const expired = makeIntent({ expiresAt: past() });
    mockDb.PaymentIntent.findOne
      .mockResolvedValueOnce(makeIntent({ status: 'FAILED' }))
      .mockResolvedValueOnce(expired);

    expect((await service.completePayment(callback())).errCode).toBe(2);
    expect((await service.completePayment(callback())).errCode).toBe(2);
    expect(expired.status).toBe('EXPIRED');
    expect(expired.save).toHaveBeenCalled();
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
  });

  test.each([
    ['POST', 'ALLOW_POST', mockDb.OrderPackage, 'packagePostId', 'allowPost'],
    ['POST', 'ALLOW_HOT_POST', mockDb.OrderPackage, 'packagePostId', 'allowHotPost'],
    ['CV', 'ALLOW_CV', mockDb.OrderPackageCV, 'packageCvId', 'allowCv']
  ])('atomically records a %s/%s purchase and grants its snapshotted allowance', async (
    type, entitlementType, orderModel, packageKey, allowanceField
  ) => {
    const intent = makeIntent({ packageType: type, entitlementType });
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(intent).mockResolvedValueOnce(intent);
    mockPaypal.payment.execute.mockImplementation((id, payload, done) => done(null, approvedPayment()));
    const company = { id: 9, allowPost: 2, allowHotPost: 3, allowCv: 1, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(company);
    orderModel.create.mockResolvedValue({ id: 55 });

    const result = await service.completePayment(callback({ type }));

    expect(result).toEqual({ errCode: 0, errMessage: expect.any(String) });
    expect(mockPaypal.payment.execute).toHaveBeenCalledWith('PAY-123', {
      payer_id: 'PAYER-1',
      transactions: [{ amount: { currency: 'USD', total: '20.00' } }]
    }, expect.any(Function));
    expect(orderModel.create).toHaveBeenCalledWith({
      [packageKey]: 3,
      userId: 8,
      currentPrice: 10,
      amount: 2,
      paymentIntentId: 21
    }, { transaction });
    expect(company[allowanceField]).toBe((allowanceField === 'allowPost' ? 2 : allowanceField === 'allowHotPost' ? 3 : 1) + 8);
    expect(company.save).toHaveBeenCalledWith({ transaction, silent: true });
    expect(intent).toEqual(expect.objectContaining({
      status: 'COMPLETED', providerPayerId: 'PAYER-1', completedAt: expect.any(Date)
    }));
    expect(intent.save).toHaveBeenCalledWith({ transaction });
  });

  test('uses a row lock so concurrent successful callbacks cannot create two orders', async () => {
    const initial = makeIntent();
    const locked = makeIntent({ status: 'COMPLETED' });
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(initial).mockResolvedValueOnce(locked);
    mockPaypal.payment.execute.mockImplementation((id, payload, done) => done(null, approvedPayment()));

    const result = await service.completePayment(callback());

    expect(result).toEqual(expect.objectContaining({ errCode: 0, alreadyProcessed: true }));
    expect(mockDb.PaymentIntent.findOne).toHaveBeenLastCalledWith({
      where: { id: 21 }, transaction, lock: 'UPDATE', raw: false
    });
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
    expect(mockDb.Company.findOne).not.toHaveBeenCalled();
  });

  test('recovers when PayPal says already executed but provider lookup confirms approval', async () => {
    const intent = makeIntent();
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(intent).mockResolvedValueOnce(intent);
    mockPaypal.payment.execute.mockImplementation((id, payload, done) => done(new Error('already executed')));
    mockPaypal.payment.get.mockImplementation((id, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue({ allowPost: 0, save: jest.fn() });
    mockDb.OrderPackage.create.mockResolvedValue({ id: 1 });

    expect((await service.completePayment(callback())).errCode).toBe(0);
    expect(mockPaypal.payment.get).toHaveBeenCalledWith('PAY-123', expect.any(Function));
  });

  test('does not grant rights when provider confirmation fails', async () => {
    const intent = makeIntent();
    mockDb.PaymentIntent.findOne
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce(intent);
    mockPaypal.payment.execute.mockImplementation((id, payload, done) => done(new Error('declined')));
    mockPaypal.payment.get.mockImplementation((id, done) => done(new Error('not found')));

    expect((await service.completePayment(callback())).errCode).toBe(-1);
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
  });

  test('recognises completion that wins the race while provider lookup is failing', async () => {
    mockDb.PaymentIntent.findOne
      .mockResolvedValueOnce(makeIntent())
      .mockResolvedValueOnce(makeIntent({ status: 'COMPLETED' }));
    mockPaypal.payment.execute.mockImplementation((id, payload, done) => done(new Error('already executed')));
    mockPaypal.payment.get.mockImplementation((id, done) => done(new Error('temporary')));

    expect(await service.completePayment(callback())).toEqual(expect.objectContaining({
      errCode: 0, alreadyProcessed: true
    }));
  });

  test('rejects invalid or missing transactional state without writing an order', async () => {
    const cases = [
      null,
      makeIntent({ status: 'FAILED' }),
      makeIntent({ expiresAt: past() }),
      makeIntent({ packageType: 'BROKEN' }),
      makeIntent({ entitlementType: 'BROKEN' })
    ];
    for (const locked of cases) {
      mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(locked);
      mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
      expect((await service.completePayment(callback())).errCode).toBe(2);
    }
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
  });

  test('requires the bound company and order write inside the same transaction', async () => {
    const noCompanyIntent = makeIntent();
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(noCompanyIntent).mockResolvedValueOnce(noCompanyIntent);
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValueOnce(null);
    expect((await service.completePayment(callback())).errCode).toBe(2);

    const noOrderIntent = makeIntent();
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(noOrderIntent).mockResolvedValueOnce(noOrderIntent);
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValueOnce({ allowPost: 0, save: jest.fn() });
    mockDb.OrderPackage.create.mockResolvedValueOnce(null);
    expect((await service.completePayment(callback())).errCode).toBe(2);
  });

  test('propagates a transaction failure so the database can roll back every local write', async () => {
    const intent = makeIntent();
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(intent).mockResolvedValueOnce(intent);
    mockPaypal.payment.execute.mockImplementation((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue({ allowPost: 0, save: jest.fn().mockRejectedValue(new Error('write failed')) });
    mockDb.OrderPackage.create.mockResolvedValue({ id: 1 });

    await expect(service.completePayment(callback())).rejects.toThrow('write failed');
    expect(mockDb.OrderPackage.create).toHaveBeenCalledWith(expect.any(Object), { transaction });
  });
});

describe('paymentIntegrityService provider verification', () => {
  test('accepts a matching response and rejects ID, state, currency, total, or absent responses', () => {
    const intent = makeIntent();
    expect(service.providerPaymentMatches(approvedPayment(), intent)).toBe(true);
    expect(service.providerPaymentMatches(null, intent)).toBe(false);
    expect(service.providerPaymentMatches(approvedPayment({ id: 'OTHER' }), intent)).toBe(false);
    expect(service.providerPaymentMatches(approvedPayment({ state: 'failed' }), intent)).toBe(false);
    expect(service.providerPaymentMatches(approvedPayment({ transactions: [{ amount: { currency: 'EUR', total: '20.00' } }] }), intent)).toBe(false);
    expect(service.providerPaymentMatches(approvedPayment({ transactions: [{ amount: { currency: 'USD', total: '21.00' } }] }), intent)).toBe(false);
    expect(service.providerPaymentMatches(approvedPayment({
      payer: { payer_info: { payer_id: 'OTHER' } }
    }), intent, 'PAYER-1')).toBe(false);
    expect(service.providerPaymentMatches(approvedPayment({
      payer: { payer_info: { payer_id: 'PAYER-1' } }
    }), intent, 'PAYER-1')).toBe(true);
    expect(service.providerPaymentMatches({ id: 'PAY-123' }, intent)).toBe(true);
  });
});
