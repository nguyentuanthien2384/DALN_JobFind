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
  PaymentIntent: { ...model(), update: jest.fn(), findAll: jest.fn() },
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
// Shape of a PayPal v1 execute/lookup reply for a captured sale.
const approvedPayment = (overrides = {}) => ({
  id: 'PAY-123',
  state: 'approved',
  payer: { payer_info: { payer_id: 'PAYER-1' } },
  transactions: [{
    amount: { currency: 'USD', total: '20.00' },
    related_resources: [{ sale: { id: 'SALE-1', state: 'completed' } }]
  }],
  ...overrides
});
// Lookup reply for a payment the buyer created but that was never executed (nothing charged).
const createdPayment = (overrides = {}) => ({
  id: 'PAY-123',
  state: 'created',
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

  test('rejects non-pending intents and expires stale ones without ever executing them', async () => {
    const expired = makeIntent({ expiresAt: past() });
    mockDb.PaymentIntent.findOne
      .mockResolvedValueOnce(makeIntent({ status: 'FAILED' }))
      .mockResolvedValueOnce(expired);
    mockPaypal.payment.get.mockImplementation((id, done) => done(null, createdPayment()));
    mockDb.PaymentIntent.update.mockResolvedValue([1]);

    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: 'Giao dịch không còn hiệu lực' });
    expect(mockPaypal.payment.get).not.toHaveBeenCalled();
    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: 'Giao dịch đã hết hạn' });
    expect(mockDb.PaymentIntent.update).toHaveBeenCalledWith({ status: 'EXPIRED' }, { where: { id: 21, status: 'PENDING' } });
    expect(expired.status).toBe('EXPIRED');
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

  // An intent that expires during capture is honoured: see "never keeps money it does not deliver".
  test.each([
    ['a vanished intent', null, 'Giao dịch không tồn tại hoặc không thuộc tài khoản này'],
    ['a failed intent', { status: 'FAILED' }, 'Giao dịch không còn hiệu lực'],
    ['an unknown package type', { packageType: 'BROKEN' }, 'Dữ liệu quyền lợi của giao dịch không hợp lệ'],
    ['an unknown entitlement', { entitlementType: 'BROKEN' }, 'Dữ liệu quyền lợi của giao dịch không hợp lệ']
  ])('rejects %s inside the transaction without writing an order', async (_case, overrides, message) => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(overrides && makeIntent(overrides));
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue({ id: 9, allowPost: 0, save: jest.fn() });
    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: message });
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
    // Fail closed: a reply missing the state, payer or amount proves nothing.
    expect(service.providerPaymentMatches({ id: 'PAY-123' }, intent)).toBe(false);
  });
});

// Once PayPal has captured the money for this exact intent, the local expiry can no longer
// reject it: rejecting would charge the customer without granting the package (no refund exists).
describe('paymentIntegrityService never keeps money it does not deliver', () => {
  beforeEach(reset);

  const company = () => ({ id: 9, allowPost: 1, save: jest.fn() });

  test('grants the package when the intent expires while PayPal is capturing it', async () => {
    const loaded = makeIntent({ expiresAt: new Date(Date.now() + 5) });
    const locked = makeIntent({ expiresAt: past() });
    const target = company();
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(loaded).mockResolvedValueOnce(locked);
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValueOnce(target);
    mockDb.OrderPackage.create.mockResolvedValueOnce({ id: 501 });

    expect(await service.completePayment(callback())).toEqual({ errCode: 0, errMessage: 'Hệ thống đã ghi nhận lịch sử mua của bạn' });
    expect(mockDb.OrderPackage.create).toHaveBeenCalledWith(expect.objectContaining({ packagePostId: 3, amount: 2, paymentIntentId: 21 }), { transaction });
    expect(target.allowPost).toBe(9);
    expect(locked.status).toBe('COMPLETED');
  });

  test('grants the package when a concurrent callback marked the intent EXPIRED after capture started', async () => {
    const locked = makeIntent({ status: 'EXPIRED', expiresAt: past() });
    const target = company();
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(locked);
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValueOnce(target);
    mockDb.OrderPackage.create.mockResolvedValueOnce({ id: 502 });

    expect((await service.completePayment(callback())).errCode).toBe(0);
    expect(target.allowPost).toBe(9);
    expect(locked.status).toBe('COMPLETED');
  });

  test('still never executes an intent that was already expired before capture', async () => {
    const expired = makeIntent({ expiresAt: past() });
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(expired);
    mockPaypal.payment.get.mockImplementationOnce((id, done) => done(null, createdPayment()));
    mockDb.PaymentIntent.update.mockResolvedValue([1]);
    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: 'Giao dịch đã hết hạn' });
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
  });

  test.each(['FAILED', 'CANCELLED'])('does not grant a %s intent even after a capture report', async (status) => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent({ status }));
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    expect((await service.completePayment(callback())).errCode).toBe(2);
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
  });
});

// `expiresAt: expect.any(Date)` also matches `new Date(NaN)`: assert the actual payment window.
describe('paymentIntegrityService payment window and quantity limits', () => {
  const NOW = Date.parse('2026-06-01T08:00:00Z');
  const originalTtl = process.env.PAYMENT_INTENT_TTL_MINUTES;

  beforeEach(() => {
    reset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    mockDb.User.findOne.mockResolvedValue({ id: 8, companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockPaypal.payment.create.mockImplementation((payload, done) => done(null, {
      id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/approve?token=EC-1' }]
    }));
    mockDb.PaymentIntent.create.mockResolvedValue({ id: 21 });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalTtl === undefined) delete process.env.PAYMENT_INTENT_TTL_MINUTES;
    else process.env.PAYMENT_INTENT_TTL_MINUTES = originalTtl;
  });

  const createdIntent = () => mockDb.PaymentIntent.create.mock.calls[0][0];

  test.each([
    [undefined, 30], ['10', 10], ['1.5', 1.5], ['0', 30], ['-5', 30], ['abc', 30], ['Infinity', 30],
  ])('PAYMENT_INTENT_TTL_MINUTES=%p gives a %p minute window', async (configured, minutes) => {
    if (configured === undefined) delete process.env.PAYMENT_INTENT_TTL_MINUTES;
    else process.env.PAYMENT_INTENT_TTL_MINUTES = configured;
    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 })).errCode).toBe(0);
    expect(createdIntent().expiresAt.getTime()).toBe(NOW + minutes * 60 * 1000);
  });

  test.each([[1, '10.00', 4], [1000, '10000.00', 4000]])('accepts the quantity boundary %i', async (amount, total, entitlementAmount) => {
    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount })).errCode).toBe(0);
    expect(createdIntent()).toMatchObject({ quantity: amount, totalPrice: total, entitlementAmount });
  });

  test.each([0, -1, 1001, 2.5, '3abc', '', null])('rejects quantity %p before contacting PayPal', async (amount) => {
    expect(await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount })).toEqual({ errCode: 1, errMessage: 'Missing required parameters !' });
    expect(mockPaypal.payment.create).not.toHaveBeenCalled();
  });

  test('rounds the unit price to cents before multiplying, so PayPal and our record agree', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage({ price: 0.105 }));
    expect((await service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 3 })).errCode).toBe(0);
    const payload = mockPaypal.payment.create.mock.calls[0][0];
    expect(payload.transactions[0].item_list.items[0].price).toBe(createdIntent().unitPrice);
    expect(payload.transactions[0].amount.total).toBe(createdIntent().totalPrice);
    expect(Number(createdIntent().totalPrice)).toBeCloseTo(Number(createdIntent().unitPrice) * 3, 2);
  });

  test('a replayed callback for a completed intent reports it as already recorded', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValue(makeIntent({ status: 'COMPLETED' }));
    expect(await service.completePayment(callback())).toEqual({
      errCode: 0, errMessage: 'Giao dịch này đã được ghi nhận trước đó', alreadyProcessed: true
    });
  });
});

// providerPaymentMatches is unit-tested above; these pin that completePayment actually uses it.
describe('paymentIntegrityService grants only what PayPal confirmed', () => {
  beforeEach(reset);

  const notConfirmed = { errCode: -1, errMessage: 'PayPal chưa xác nhận giao dịch' };
  const expectNothingGranted = (target) => {
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
    expect(target.save).not.toHaveBeenCalled();
  };

  test.each([
    ['a lower total', approvedPayment({ transactions: [{ amount: { currency: 'USD', total: '2.00' } }] })],
    ['another currency', approvedPayment({ transactions: [{ amount: { currency: 'VND', total: '20.00' } }] })],
    ['another payer', approvedPayment({ payer: { payer_info: { payer_id: 'SOMEONE-ELSE' } } })],
    ['another payment', approvedPayment({ id: 'PAY-OTHER' })],
  ])('does not grant when a successful execute reports %s', async (_case, executed) => {
    const target = { id: 9, allowPost: 1, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(target);
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent());
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, executed));
    mockPaypal.payment.get.mockImplementationOnce((id, done) => done(null, executed));
    expect(await service.completePayment(callback())).toEqual(notConfirmed);
    expectNothingGranted(target);
  });

  test('does not grant when execute fails and the provider lookup shows a different amount', async () => {
    const target = { id: 9, allowPost: 1, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(target);
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent());
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(new Error('already executed')));
    mockPaypal.payment.get.mockImplementationOnce((id, done) => done(null, approvedPayment({ transactions: [{ amount: { currency: 'USD', total: '0.01' } }] })));
    expect(await service.completePayment(callback())).toEqual(notConfirmed);
    expectNothingGranted(target);
  });

  test('executes with the server-side amount, never a client-supplied one', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent());
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue({ id: 9, allowPost: 0, save: jest.fn() });
    mockDb.OrderPackage.create.mockResolvedValue({ id: 1 });
    await service.completePayment({ ...callback(), amount: '0.01', total: '0.01' });
    expect(mockPaypal.payment.execute).toHaveBeenCalledWith('PAY-123', {
      payer_id: 'PAYER-1', transactions: [{ amount: { currency: 'USD', total: '20.00' } }]
    }, expect.any(Function));
  });

  test('starts from zero when the company has no allowance recorded yet', async () => {
    const target = { id: 9, allowPost: null, save: jest.fn() };
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent());
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue(target);
    mockDb.OrderPackage.create.mockResolvedValue({ id: 1 });
    expect((await service.completePayment(callback())).errCode).toBe(0);
    expect(target.allowPost).toBe(8);
    expect(target.save).toHaveBeenCalledWith({ transaction, silent: true });
  });
});

describe('paymentIntegrityService rejects bad package data and provider replies precisely', () => {
  beforeEach(() => {
    reset();
    mockDb.User.findOne.mockResolvedValue({ id: 8, companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockDb.PaymentIntent.create.mockResolvedValue({ id: 21 });
  });
  afterEach(() => jest.restoreAllMocks());
  const create = (amount = 1) => service.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount });
  const paypalReturns = (error, payment) => mockPaypal.payment.create.mockImplementation((payload, done) => done(error, payment));

  test.each([
    ['a zero price', { price: 0 }], ['a negative price', { price: -10 }], ['a non-numeric price', { price: 'free' }],
    ['a zero package value', { value: 0 }], ['a negative package value', { value: -2 }],
  ])('refuses %s as a package configuration error before PayPal', async (_case, overrides) => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage(overrides));
    expect(await create()).toEqual({ errCode: 2, errMessage: 'Cấu hình gói thanh toán không hợp lệ' });
    expect(mockPaypal.payment.create).not.toHaveBeenCalled();
  });

  test('accepts a total of exactly 9,999,999,999.99 USD and refuses anything above it', async () => {
    paypalReturns(null, { id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/a?token=EC-1' }] });
    mockDb.PackagePost.findOne.mockResolvedValueOnce(makePackage({ price: 9999999999.99 })).mockResolvedValueOnce(makePackage({ price: 5000000000.00 }));
    expect((await create(1)).errCode).toBe(0);
    expect(await create(2)).toEqual({ errCode: 2, errMessage: 'Tổng tiền của giao dịch không hợp lệ' });
  });

  test('reports a PayPal creation error without storing an intent', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    paypalReturns(new Error('INSTRUMENT_DECLINED'), { id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/a?token=EC-1' }] });
    expect(await create()).toEqual({ errCode: -1, errMessage: 'INSTRUMENT_DECLINED' });
    paypalReturns({}, undefined);
    expect(await create()).toEqual({ errCode: -1, errMessage: 'Không thể tạo giao dịch PayPal' });
    expect(mockDb.PaymentIntent.create).not.toHaveBeenCalled();
  });

  test.each([
    ['no payment id', { links: [{ rel: 'approval_url', href: 'https://paypal.test/a?token=EC-1' }] }],
    ['no approval link', { id: 'PAY-1', links: [{ rel: 'self', href: 'https://api.paypal.test/v1/payments/PAY-1' }] }],
    ['an approval link without token', { id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/a' }] }],
  ])('refuses an incomplete PayPal reply with %s', async (_case, payment) => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    paypalReturns(null, payment);
    expect(await create()).toEqual({ errCode: -1, errMessage: 'PayPal trả về giao dịch không đầy đủ' });
    expect(mockDb.PaymentIntent.create).not.toHaveBeenCalled();
  });

  test('picks the approval link among the other HATEOAS links', async () => {
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    paypalReturns(null, { id: 'PAY-1', links: [
      { rel: 'self', href: 'https://api.paypal.test/v1/payments/PAY-1' },
      { rel: 'approval_url', href: 'https://paypal.test/approve?token=EC-9' },
      { rel: 'execute', href: 'https://api.paypal.test/v1/payments/PAY-1/execute' },
    ] });
    expect(await create()).toEqual({ errCode: 0, link: 'https://paypal.test/approve?token=EC-9' });
    expect(mockDb.PaymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({ providerToken: 'EC-9' }));
  });

  test('describes the PayPal item by package type', async () => {
    paypalReturns(null, { id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/a?token=EC-1' }] });
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    mockDb.PackageCv.findOne.mockResolvedValue(makePackage());
    await create();
    await service.createPaymentLink({ type: 'CV', userId: 8, packageId: 3, amount: 1 });
    expect(mockPaypal.payment.create.mock.calls.map(([payload]) => payload.transactions[0].description))
      .toEqual(['JobFind post package', 'JobFind CV package']);
  });

  test('treats an intent expiring exactly now as expired and never executes it', async () => {
    const now = Date.parse('2026-06-01T08:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const intent = makeIntent({ expiresAt: new Date(now) });
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(intent);
    mockPaypal.payment.get.mockImplementationOnce((id, done) => done(null, createdPayment()));
    mockDb.PaymentIntent.update.mockResolvedValue([1]);
    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: 'Giao dịch đã hết hạn' });
    expect(intent.status).toBe('EXPIRED');
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
  });

  test('reports a vanished company inside the transaction without granting', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent());
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue(null);
    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: 'Không tìm thấy công ty nhận quyền lợi' });
    expect(mockDb.OrderPackage.create).not.toHaveBeenCalled();
  });
});

describe('paymentIntegrityService provider proof fails closed', () => {
  const intent = makeIntent();
  const firstTransaction = (changes) => [{ ...approvedPayment().transactions[0], ...changes }];

  test.each([
    ['no state', approvedPayment({ state: undefined })],
    ['a created (never executed) payment', approvedPayment({ state: 'created' })],
    ['no payer', approvedPayment({ payer: undefined })],
    ['a payer without id', approvedPayment({ payer: { payer_info: {} } })],
    ['no transactions', approvedPayment({ transactions: [] })],
    ['a transaction without amount', approvedPayment({ transactions: firstTransaction({ amount: undefined }) })],
    ['an amount without total', approvedPayment({ transactions: firstTransaction({ amount: { currency: 'USD' } }) })],
    ['an amount without currency', approvedPayment({ transactions: firstTransaction({ amount: { total: '20.00' } }) })],
    ['no payment id', approvedPayment({ id: undefined })],
    ['a sale pending review', approvedPayment({ transactions: firstTransaction({ related_resources: [{ sale: { state: 'pending' } }] }) })],
    ['a refunded sale', approvedPayment({ transactions: firstTransaction({ related_resources: [{ sale: { state: 'refunded' } }] }) })],
    ['a denied sale', approvedPayment({ transactions: firstTransaction({ related_resources: [{ sale: { state: 'denied' } }] }) })],
    ['a non-object reply', 'approved'],
  ])('does not accept a reply with %s as proof of capture', (_case, payment) => {
    expect(service.providerPaymentMatches(payment, intent)).toBe(false);
  });

  test('accepts an approved reply without sale details, and compares ids and amounts as values', () => {
    expect(service.providerPaymentMatches(approvedPayment({ transactions: firstTransaction({ related_resources: undefined }) }), intent)).toBe(true);
    expect(service.providerPaymentMatches(approvedPayment({ transactions: firstTransaction({ amount: { currency: 'usd', total: 20 } }) }), intent)).toBe(true);
    expect(service.providerPaymentMatches(approvedPayment({ state: 'APPROVED' }), intent)).toBe(true);
  });

  test('checks the payer only when the callback named one', () => {
    expect(service.providerPaymentMatches(approvedPayment(), intent, undefined)).toBe(true);
    expect(service.providerPaymentMatches(approvedPayment(), intent, null)).toBe(true);
    expect(service.providerPaymentMatches(approvedPayment(), intent, 'PAYER-1')).toBe(true);
    expect(service.providerPaymentMatches(approvedPayment(), intent, 'PAYER-2')).toBe(false);
  });
});

// Our execute call is never made for an expired intent, but a crash after PayPal captured the
// money (or expiry during capture) must still end with the package granted exactly once.
describe('paymentIntegrityService recovers captured money for expired intents', () => {
  beforeEach(() => {
    reset();
    mockDb.PaymentIntent.update.mockResolvedValue([1]);
  });
  const lookupReturns = (error, payment) => mockPaypal.payment.get.mockImplementation((id, done) => done(error, payment));
  const grantable = (overrides) => {
    const target = { id: 9, allowPost: 1, save: jest.fn() };
    mockDb.Company.findOne.mockResolvedValue(target);
    mockDb.OrderPackage.create.mockResolvedValue({ id: 700 });
    return { target, locked: makeIntent(overrides) };
  };

  test.each([
    ['a PENDING intent past its window', { expiresAt: past() }],
    ['an intent already marked EXPIRED', { status: 'EXPIRED', expiresAt: past() }],
  ])('grants %s when PayPal shows the capture, without executing again', async (_case, overrides) => {
    const { target, locked } = grantable(overrides);
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent(overrides)).mockResolvedValueOnce(locked);
    lookupReturns(null, approvedPayment());
    expect(await service.completePayment(callback())).toEqual({ errCode: 0, errMessage: 'Hệ thống đã ghi nhận lịch sử mua của bạn' });
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
    expect(mockPaypal.payment.get).toHaveBeenCalledWith('PAY-123', expect.any(Function));
    expect(mockDb.PaymentIntent.update).not.toHaveBeenCalled();
    expect(target.allowPost).toBe(9);
    expect(locked).toMatchObject({ status: 'COMPLETED', providerPayerId: 'PAYER-1' });
  });

  test('closes an already EXPIRED intent that PayPal never charged without writing again', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent({ status: 'EXPIRED', expiresAt: past() }));
    lookupReturns(null, createdPayment());
    expect(await service.completePayment(callback())).toEqual({ errCode: 2, errMessage: 'Giao dịch đã hết hạn' });
    expect(mockDb.PaymentIntent.update).not.toHaveBeenCalled();
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
  });

  test.each([
    ['the lookup fails', new Error('PayPal down'), undefined],
    ['PayPal returns nothing', null, undefined],
    ['PayPal reports another amount', null, approvedPayment({ transactions: [{ amount: { currency: 'USD', total: '2.00' } }] })],
    ['the sale is still pending', null, approvedPayment({ transactions: [{ amount: { currency: 'USD', total: '20.00' }, related_resources: [{ sale: { state: 'pending' } }] }] })],
    ['PayPal reports another payment', null, createdPayment({ id: 'PAY-OTHER' })],
  ])('keeps an expired intent open for review when %s', async (_case, error, payment) => {
    const intent = makeIntent({ expiresAt: past() });
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(intent);
    lookupReturns(error, payment);
    expect(await service.completePayment(callback())).toEqual({ errCode: -1, errMessage: 'Chưa xác minh được giao dịch với PayPal. Vui lòng thử lại sau.' });
    expect(mockDb.PaymentIntent.update).not.toHaveBeenCalled();
    expect(intent.status).toBe('PENDING');
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
  });

  test('does not grant when the callback names a different payer than PayPal recorded', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent({ expiresAt: past() }));
    lookupReturns(null, approvedPayment());
    expect((await service.completePayment(callback({ PayerID: 'SOMEONE-ELSE' }))).errCode).toBe(-1);
    expect(mockDb.sequelize.transaction).not.toHaveBeenCalled();
  });

  test('marks expiry with a compare-and-set, never over a completed intent', async () => {
    const intent = makeIntent({ expiresAt: past() });
    mockDb.PaymentIntent.findOne
      .mockResolvedValueOnce(intent)
      .mockResolvedValueOnce(makeIntent({ status: 'COMPLETED' }));
    lookupReturns(null, createdPayment());
    mockDb.PaymentIntent.update.mockResolvedValueOnce([0]);
    expect(await service.completePayment(callback())).toEqual(expect.objectContaining({ errCode: 0, alreadyProcessed: true }));
    expect(mockDb.PaymentIntent.update).toHaveBeenCalledWith({ status: 'EXPIRED' }, { where: { id: 21, status: 'PENDING' } });
    expect(intent.status).toBe('PENDING');
    expect(intent.save).not.toHaveBeenCalled();
  });

  test('a replay after recovery reports the purchase once and grants nothing more', async () => {
    const { target, locked } = grantable({ status: 'EXPIRED', expiresAt: past() });
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent({ status: 'EXPIRED', expiresAt: past() })).mockResolvedValueOnce(locked);
    lookupReturns(null, approvedPayment());
    await service.completePayment(callback());
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(locked);
    expect(await service.completePayment(callback())).toEqual(expect.objectContaining({ errCode: 0, alreadyProcessed: true }));
    expect(mockDb.OrderPackage.create).toHaveBeenCalledTimes(1);
    expect(target.allowPost).toBe(9);
  });
});

describe('paymentIntegrityService.reconcileStalePayments', () => {
  const NOW = Date.parse('2026-06-01T08:00:00Z');
  let warn;
  beforeEach(() => {
    reset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDb.PaymentIntent.update.mockResolvedValue([1]);
    mockDb.Company.findOne.mockResolvedValue({ id: 9, allowPost: 0, save: jest.fn() });
    mockDb.OrderPackage.create.mockResolvedValue({ id: 800 });
  });
  afterEach(() => jest.restoreAllMocks());

  const stale = (id, overrides = {}) => makeIntent({ id, providerPaymentId: `PAY-${id}`, expiresAt: new Date(NOW - 60_000), ...overrides });
  const lookup = (replies) => mockPaypal.payment.get.mockImplementation((paymentId, done) => {
    const reply = replies[paymentId];
    if (reply instanceof Error) done(reply);
    else done(null, reply);
  });

  test('looks only at PayPal intents still PENDING whose window closed within the last 7 days', async () => {
    mockDb.PaymentIntent.findAll.mockResolvedValue([]);
    expect(await service.reconcileStalePayments()).toEqual({ checked: 0, completed: 0, expired: 0, unresolved: [] });
    const query = mockDb.PaymentIntent.findAll.mock.calls[0][0];
    expect(query).toMatchObject({ where: { provider: 'PAYPAL', status: 'PENDING' }, order: [['expiresAt', 'DESC']], limit: 50, raw: false });
    const bounds = Object.getOwnPropertySymbols(query.where.expiresAt).map((op) => query.where.expiresAt[op].getTime()).sort();
    expect(bounds).toEqual([NOW - 7 * 24 * 60 * 60 * 1000, NOW]);
    await service.reconcileStalePayments({ limit: 5 });
    expect(mockDb.PaymentIntent.findAll.mock.calls[1][0].limit).toBe(5);
  });

  test('grants captured payments, closes uncharged ones and leaves the rest for review', async () => {
    const captured = stale(1);
    const uncharged = stale(2);
    const failedLookup = stale(3);
    const mismatched = stale(4);
    mockDb.PaymentIntent.findAll.mockResolvedValue([captured, uncharged, failedLookup, mismatched]);
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(captured);
    lookup({
      'PAY-1': approvedPayment({ id: 'PAY-1' }),
      'PAY-2': createdPayment({ id: 'PAY-2' }),
      'PAY-3': new Error('timeout'),
      'PAY-4': approvedPayment({ id: 'PAY-4', transactions: [{ amount: { currency: 'USD', total: '1.00' } }] }),
    });
    expect(await service.reconcileStalePayments()).toEqual({ checked: 4, completed: 1, expired: 1, unresolved: [3, 4] });
    expect(captured).toMatchObject({ status: 'COMPLETED', providerPayerId: 'PAYER-1' });
    expect(mockDb.PaymentIntent.update).toHaveBeenCalledTimes(1);
    expect(mockDb.PaymentIntent.update).toHaveBeenCalledWith({ status: 'EXPIRED' }, { where: { id: 2, status: 'PENDING' } });
    expect(mockPaypal.payment.execute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('Payment reconciliation needs review for intents:', '3,4');
  });

  test('keeps going after one intent throws and does not count a lost compare-and-set', async () => {
    mockDb.PaymentIntent.findAll.mockResolvedValue([stale(5), stale(6), stale(7)]);
    mockDb.PaymentIntent.findOne.mockRejectedValueOnce(new Error('deadlock'));
    mockDb.PaymentIntent.update.mockResolvedValueOnce([0]).mockResolvedValueOnce([1]);
    lookup({ 'PAY-5': approvedPayment({ id: 'PAY-5' }), 'PAY-6': createdPayment({ id: 'PAY-6' }), 'PAY-7': createdPayment({ id: 'PAY-7' }) });
    expect(await service.reconcileStalePayments()).toEqual({ checked: 3, completed: 0, expired: 1, unresolved: [5] });
  });

  test('reports a captured payment it could not record for review', async () => {
    mockDb.PaymentIntent.findAll.mockResolvedValue([stale(8)]);
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(stale(8, { entitlementType: 'BROKEN' }));
    lookup({ 'PAY-8': approvedPayment({ id: 'PAY-8' }) });
    expect(await service.reconcileStalePayments()).toEqual({ checked: 1, completed: 0, expired: 0, unresolved: [8] });
  });

  test('does not log when everything was resolved', async () => {
    mockDb.PaymentIntent.findAll.mockResolvedValue([stale(9)]);
    lookup({ 'PAY-9': createdPayment({ id: 'PAY-9' }) });
    await service.reconcileStalePayments();
    expect(warn).not.toHaveBeenCalled();
  });
});

// Mocked models accept any query, so the queries themselves are asserted: a lookup that loses its
// `where` would bill or credit whichever company the database returns first.
describe('paymentIntegrityService queries the exact rows it charges and credits', () => {
  beforeEach(reset);

  test('creates an intent from the requested package, buyer and buyer company', async () => {
    mockDb.PackageCv.findOne.mockResolvedValue(makePackage());
    mockDb.User.findOne.mockResolvedValue({ id: 8, companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockPaypal.payment.create.mockImplementation((payload, done) => done(null, { id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/a?token=EC-1' }] }));
    mockDb.PaymentIntent.create.mockResolvedValue({ id: 1 });
    await service.createPaymentLink({ type: 'CV', userId: 8, packageId: 3, amount: 1 });
    expect(mockDb.PackageCv.findOne).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(mockDb.User.findOne).toHaveBeenCalledWith({ where: { id: 8 }, attributes: { exclude: ['userId'] } });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(mockPaypal.payment.create.mock.calls[0][0].payer).toEqual({ payment_method: 'paypal' });
  });

  test.each([
    ['POST', 'PackagePost', 'Gói bài đăng không tồn tại hoặc đã ngừng kinh doanh'],
    ['CV', 'PackageCv', 'Gói xem ứng viên không tồn tại hoặc đã ngừng kinh doanh'],
  ])('refuses a %s package that is no longer sold, before looking up the buyer', async (type, model, message) => {
    for (const item of [null, makePackage({ isActive: 0 }), makePackage({ isActive: '0' })]) {
      mockDb[model].findOne.mockResolvedValueOnce(item);
      expect(await service.createPaymentLink({ type, userId: 8, packageId: 3, amount: 1 })).toEqual({ errCode: 2, errMessage: message });
    }
    expect(mockDb.User.findOne).not.toHaveBeenCalled();
  });

  test('locks and credits the intent company inside the transaction', async () => {
    const target = { id: 9, allowPost: 0, save: jest.fn() };
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent());
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(null, approvedPayment()));
    mockDb.Company.findOne.mockResolvedValue(target);
    mockDb.OrderPackage.create.mockResolvedValue({ id: 1 });
    await service.completePayment(callback());
    expect(mockDb.PaymentIntent.findOne).toHaveBeenNthCalledWith(2, { where: { id: 21 }, transaction, lock: 'UPDATE', raw: false });
    expect(mockDb.Company.findOne).toHaveBeenCalledWith({ where: { id: 9 }, transaction, lock: 'UPDATE', raw: false });
  });

  test('re-reads the same intent when PayPal has not confirmed yet', async () => {
    mockDb.PaymentIntent.findOne.mockResolvedValueOnce(makeIntent()).mockResolvedValueOnce(makeIntent({ status: 'COMPLETED' }));
    mockPaypal.payment.execute.mockImplementationOnce((id, payload, done) => done(new Error('busy')));
    mockPaypal.payment.get.mockImplementationOnce((id, done) => done(new Error('busy')));
    expect((await service.completePayment(callback())).alreadyProcessed).toBe(true);
    expect(mockDb.PaymentIntent.findOne).toHaveBeenLastCalledWith({ where: { id: 21 } });
  });
});

describe('paymentIntegrityService PayPal configuration', () => {
  const keys = ['PAYPAL_MODE', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'CLIENT_ID', 'CLIENT_SECRET', 'URL_REACT'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const load = (env) => {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    mockPaypal.configure.mockClear();
    let loaded;
    jest.isolateModules(() => { loaded = require('../../src/services/paymentIntegrityService'); });
    return loaded;
  };
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('uses the live mode and PayPal-specific credentials when configured', () => {
    load({ PAYPAL_MODE: 'live', PAYPAL_CLIENT_ID: 'pp-id', PAYPAL_CLIENT_SECRET: 'pp-secret', CLIENT_ID: 'old-id', CLIENT_SECRET: 'old-secret' });
    expect(mockPaypal.configure).toHaveBeenCalledWith({ mode: 'live', client_id: 'pp-id', client_secret: 'pp-secret' });
  });

  test('falls back to sandbox and the legacy credential names', () => {
    load({ CLIENT_ID: 'old-id', CLIENT_SECRET: 'old-secret' });
    expect(mockPaypal.configure).toHaveBeenCalledWith({ mode: 'sandbox', client_id: 'old-id', client_secret: 'old-secret' });
  });

  test.each([
    [{}, 'http://localhost:3000'],
    [{ URL_REACT: 'https://jobfind.vn/' }, 'https://jobfind.vn'],
    [{ URL_REACT: ' https://jobfind.vn/ , https://admin.jobfind.vn' }, 'https://jobfind.vn'],
  ])('returns buyers to the first configured frontend origin (%j)', async (env, origin) => {
    const fresh = load(env);
    reset();
    mockDb.PackagePost.findOne.mockResolvedValue(makePackage());
    mockDb.User.findOne.mockResolvedValue({ id: 8, companyId: 9 });
    mockDb.Company.findOne.mockResolvedValue({ id: 9 });
    mockPaypal.payment.create.mockImplementation((payload, done) => done(null, { id: 'PAY-1', links: [{ rel: 'approval_url', href: 'https://paypal.test/a?token=EC-1' }] }));
    mockDb.PaymentIntent.create.mockResolvedValue({ id: 1 });
    await fresh.createPaymentLink({ type: 'POST', userId: 8, packageId: 3, amount: 1 });
    expect(mockPaypal.payment.create.mock.calls[0][0].redirect_urls).toEqual({
      return_url: `${origin}/admin/payment/success`, cancel_url: `${origin}/admin/payment/cancel`
    });
  });
});
