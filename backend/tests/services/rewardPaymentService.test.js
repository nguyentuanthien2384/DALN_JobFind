const model = () => ({
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
    update: jest.fn()
});

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockDb = {
    RewardWallet: model(),
    RewardTransaction: model(),
    CompetitionUnlock: model(),
    PaymentOrder: model(),
    PackagePost: model(),
    PackageCv: model(),
    OrderPackage: model(),
    OrderPackageCV: model(),
    User: model(),
    UserSetting: model(),
    UserSkill: model(),
    Skill: model(),
    Post: model(),
    DetailPost: model(),
    Allcode: model(),
    Cv: model(),
    Company: model(),
    sequelize: {
        transaction: jest.fn((callback) => callback(transaction))
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
const mockEmitDashboardChanged = jest.fn();

jest.mock('../../src/models/index', () => mockDb);
jest.mock('paypal-rest-sdk', () => mockPaypal);
jest.mock('../../src/config/socket', () => ({ emitDashboardChanged: mockEmitDashboardChanged }));

const vnpay = require('../../src/services/payment/gateways/vnpay');
const momo = require('../../src/services/payment/gateways/momo');
const zalopay = require('../../src/services/payment/gateways/zalopay');
const paypalGateway = require('../../src/services/payment/gateways/paypal');
const gatewaysIndex = require('../../src/services/payment/gateways');
const rewardService = require('../../src/services/rewardService');
const paymentOrderService = require('../../src/services/paymentOrderService');
const controller = require('../../src/controllers/rewardPaymentController');
const { createRequest, createResponse } = require('../helpers/http');

const makeWallet = (overrides = {}) => ({
    id: 1,
    ownerType: 'CANDIDATE',
    ownerId: 7,
    balance: 45,
    lifetimeEarned: 45,
    lifetimeSpent: 0,
    save: jest.fn(),
    ...overrides
});

describe('payment gateways', () => {
    const savedEnv = { ...process.env };
    afterEach(() => {
        process.env = { ...savedEnv };
    });

    test('VNPAY creates signed checkout URL and verifies callback checksum', async () => {
        process.env.VNP_TMN_CODE = 'TMN123';
        process.env.VNP_HASH_SECRET = 'SECRET123456';
        expect(vnpay.isConfigured()).toBe(true);
        expect(vnpay.normalizeIp(['::ffff:192.168.1.5'])).toBe('192.168.1.5');
        expect(vnpay.normalizeIp('::1')).toBe('127.0.0.1');
        expect(vnpay.normalizeIp('10.0.0.1, 10.0.0.2')).toBe('10.0.0.1');
        expect(vnpay.normalizeIp('')).toBe('127.0.0.1');

        const created = await vnpay.createPayment({
            orderCode: 'JF100',
            amount: 45000,
            orderInfo: 'Nạp gói Đẳng Cấp (JF100)',
            ipAddr: '127.0.0.1',
            bankCode: 'vnpayqr'
        });
        expect(vnpay.sanitizeOrderInfo('Nạp gói Đẳng Cấp (JF100)')).toBe('Nap goi Dang Cap JF100');
        expect(created.checkoutUrl).toContain('vnp_SecureHash=');
        expect(created.checkoutUrl).toContain('vnp_ExpireDate=');
        expect(created.checkoutUrl).toContain('vnp_BankCode=VNPAYQR');
        const query = Object.fromEntries(new URL(created.checkoutUrl).searchParams.entries());
        query.vnp_ResponseCode = '00';
        query.vnp_TransactionStatus = '00';
        query.vnp_TransactionNo = 'TX99';
        query.vnp_SecureHash = vnpay.sign(
            Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'vnp_SecureHash'))
        );

        const verified = vnpay.verifyCallback(query);
        expect(verified).toMatchObject({
            valid: true,
            success: true,
            orderCode: 'JF100',
            amount: 45000,
            transId: 'TX99'
        });

        const cancelledQuery = { ...query, vnp_ResponseCode: '24' };
        cancelledQuery.vnp_SecureHash = vnpay.sign(
            Object.fromEntries(Object.entries(cancelledQuery).filter(([k]) => k !== 'vnp_SecureHash'))
        );
        expect(vnpay.verifyCallback(cancelledQuery).success).toBe(false);
        expect(vnpay.verifyCallback({}).valid).toBe(false);

        delete process.env.VNP_HASH_SECRET;
        expect(vnpay.verifyCallback({ vnp_SecureHash: 'abc' }).valid).toBe(false);
    });

    test('MoMo signs, creates payment, and verifies callback payload', async () => {
        process.env.MOMO_PARTNER_CODE = 'MOMO_PARTNER';
        process.env.MOMO_ACCESS_KEY = 'ACCESS_1';
        process.env.MOMO_SECRET_KEY = 'SECRET_1';
        expect(momo.isConfigured()).toBe(true);

        const origFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ resultCode: 0, payUrl: 'https://test-payment.momo.vn/pay', requestId: 'R1' })
        });
        const created = await momo.createPayment({
            orderCode: 'JF200',
            amount: 50000,
            orderInfo: 'Test MoMo',
            userId: 7
        });
        expect(created.checkoutUrl).toBe('https://test-payment.momo.vn/pay');
        const momoReqBody = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(momoReqBody.requestType).toBe('payWithMethod');
        global.fetch = origFetch;

        const { hmacHex } = require('../../src/services/payment/gateways/common');
        const body = {
            partnerCode: 'MOMO_PARTNER',
            amount: '50000',
            extraData: '',
            message: 'Successful.',
            orderId: 'JF200',
            orderInfo: 'Test MoMo',
            orderType: 'momo_wallet',
            payType: 'qr',
            requestId: 'REQ200',
            responseTime: '1700000000',
            resultCode: 0,
            transId: '987654'
        };
        body.signature = hmacHex('sha256', 'SECRET_1', momo.resultSignatureRaw('ACCESS_1', body));
        const verified = momo.verifyCallback(body);
        expect(verified).toMatchObject({
            valid: true,
            success: true,
            orderCode: 'JF200',
            amount: 50000,
            transId: '987654'
        });

        expect(momo.verifyCallback({ ...body, signature: 'wrong' }).valid).toBe(false);
        expect(momo.verifyCallback({}).valid).toBe(false);
    });

    test('ZaloPay builds app_trans_id, creates payment, queries status, and verifies callback MAC', async () => {
        process.env.ZALOPAY_APP_ID = '2554';
        process.env.ZALOPAY_KEY1 = 'KEY1_SECRET';
        process.env.ZALOPAY_KEY2 = 'KEY2_SECRET';
        expect(zalopay.isConfigured()).toBe(true);

        const appTransId = zalopay.buildAppTransId('JF300');
        expect(zalopay.orderCodeFromAppTransId(appTransId)).toBe('JF300');

        const origFetch = global.fetch;
        global.fetch = jest.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ return_code: 1, order_url: 'https://sb-openapi.zalopay.vn/order' })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ return_code: 1, zp_trans_id: 'ZP99', amount: 100000 })
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ return_code: 2, return_message: 'Failed' })
            });

        const created = await zalopay.createPayment({
            orderCode: 'JF300',
            amount: 100000,
            orderInfo: 'Test ZaloPay',
            userId: 7
        });
        expect(created.checkoutUrl).toBe('https://sb-openapi.zalopay.vn/order');
        const zaloReqBody = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(JSON.parse(zaloReqBody.embed_data).preferred_payment_method).toEqual(['domestic_card', 'account']);

        const queriedPaid = await zalopay.queryStatus(appTransId);
        expect(queriedPaid).toMatchObject({ state: 'PAID', transId: 'ZP99' });

        const queriedFailed = await zalopay.queryStatus(appTransId);
        expect(queriedFailed.state).toBe('FAILED');
        global.fetch = origFetch;

        const { hmacHex } = require('../../src/services/payment/gateways/common');
        const redirectQuery = {
            appid: '2554',
            apptransid: appTransId,
            pmcid: '39',
            bankcode: 'ATM',
            amount: '100000',
            discountamount: '0',
            status: '1'
        };
        redirectQuery.checksum = hmacHex(
            'sha256',
            'KEY2_SECRET',
            `${redirectQuery.appid}|${redirectQuery.apptransid}|${redirectQuery.pmcid}|${redirectQuery.bankcode}|${redirectQuery.amount}|${redirectQuery.discountamount}|${redirectQuery.status}`
        );
        expect(zalopay.verifyRedirect(redirectQuery)).toMatchObject({
            valid: true,
            success: true,
            cancelled: false,
            orderCode: 'JF300',
            amount: 100000
        });
        expect(zalopay.verifyRedirect({ ...redirectQuery, checksum: 'invalid' }).valid).toBe(false);
        const data = JSON.stringify({ app_trans_id: appTransId, amount: 100000, zp_trans_id: 555666 });
        const mac = hmacHex('sha256', 'KEY2_SECRET', data);
        const verified = zalopay.verifyCallback({ data, mac });
        expect(verified).toMatchObject({
            valid: true,
            success: true,
            orderCode: 'JF300',
            amount: 100000,
            transId: '555666'
        });

        expect(zalopay.verifyCallback({ data, mac: 'bad' }).valid).toBe(false);
        expect(zalopay.verifyCallback({ data: '{invalid', mac: hmacHex('sha256', 'KEY2_SECRET', '{invalid') }).orderCode).toBe('');
    });

    test('PayPal gateway creates and executes USD payment and handles errors', async () => {
        process.env.PAYPAL_CLIENT_ID = 'PP_ID';
        process.env.PAYPAL_CLIENT_SECRET = 'PP_SECRET';
        expect(paypalGateway.isConfigured()).toBe(true);

        mockPaypal.payment.create.mockImplementationOnce((payload, cb) => cb(null, {
            id: 'PAY-1',
            links: [{ rel: 'approval_url', href: 'https://sandbox.paypal.com/checkout?token=EC-1' }]
        }));
        const created = await paypalGateway.createPayment({
            orderCode: 'JF400',
            providerAmount: 2,
            orderInfo: 'JobFind Standard'
        });
        expect(created).toEqual({
            checkoutUrl: 'https://sandbox.paypal.com/checkout?token=EC-1',
            providerRef: 'PAY-1'
        });

        mockPaypal.payment.execute.mockImplementationOnce((id, payload, cb) => cb(null, {
            id: 'PAY-1',
            state: 'approved',
            transactions: [{
                amount: { currency: 'USD', total: '2.00' },
                related_resources: [{ sale: { id: 'SALE-1', state: 'completed' } }]
            }]
        }));
        const executed = await paypalGateway.executePayment(
            { providerRef: 'PAY-1', providerAmount: '2.00' },
            'PAYER-1'
        );
        expect(executed).toEqual({ success: true, transId: 'SALE-1' });

        // Currency/amount mismatch branch
        mockPaypal.payment.execute.mockImplementationOnce((id, payload, cb) => cb(null, {
            id: 'PAY-1',
            state: 'approved',
            transactions: [{
                amount: { currency: 'USD', total: '99.00' },
                related_resources: [{ sale: { id: 'SALE-1', state: 'completed' } }]
            }]
        }));
        mockPaypal.payment.get.mockImplementationOnce((id, cb) => cb(new Error('not found'), null));
        const mismatch = await paypalGateway.executePayment(
            { providerRef: 'PAY-1', providerAmount: '2.00' },
            'PAYER-1'
        );
        expect(mismatch.success).toBe(false);
        expect(gatewaysIndex.listProviders()).toHaveLength(4);
        expect(gatewaysIndex.normalizeProvider('momo')).toBe('MOMO');
        expect(gatewaysIndex.normalizeProvider('unknown')).toBeNull();
    });
});

describe('rewardService & paymentOrderService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDb.Cv.findAll.mockResolvedValue([]);
        mockDb.RewardTransaction.findAll.mockResolvedValue([]);
        mockDb.User.findAll.mockResolvedValue([]);
        mockDb.OrderPackage.findAll.mockResolvedValue([]);
        mockDb.OrderPackageCV.findAll.mockResolvedValue([]);
    });

    test('credits and debits candidate wallet idempotently and handles daily checkin + profile bonus', async () => {
        expect((await rewardService.claimDailyCheckin(null)).errCode).toBe(1);
        expect((await rewardService.claimProfileCompleteBonus(null)).errCode).toBe(1);
        expect((await rewardService.getCandidateRewardOverview(null)).errCode).toBe(1);
        expect((await rewardService.getCandidateTransactions({})).errCode).toBe(1);

        const wallet = makeWallet({ balance: 10, lifetimeEarned: 10 });
        mockDb.RewardWallet.findOne.mockResolvedValue(wallet);
        mockDb.RewardTransaction.findOne.mockResolvedValueOnce(null);
        mockDb.RewardTransaction.create.mockResolvedValueOnce({ id: 9, amount: 1 });

        const checkin = await rewardService.claimDailyCheckin(7);
        expect(checkin.errCode).toBe(0);
        expect(wallet.balance).toBe(11);

        // Duplicate checkin on the same day is rejected cleanly
        mockDb.RewardTransaction.findOne.mockResolvedValueOnce({ id: 9 });
        const duplicate = await rewardService.claimDailyCheckin(7);
        expect(duplicate.errCode).toBe(2);
        expect(duplicate.alreadyClaimed).toBe(true);

        // Profile incomplete vs complete vs already claimed
        mockDb.User.findOne.mockResolvedValueOnce({ id: 7, firstName: 'An' });
        mockDb.UserSetting.findOne.mockResolvedValueOnce(null);
        mockDb.UserSkill.count.mockResolvedValueOnce(0);
        const incomplete = await rewardService.claimProfileCompleteBonus(7);
        expect(incomplete.errCode).toBe(2);

        mockDb.User.findOne.mockResolvedValueOnce({ id: 7, firstName: 'An', lastName: 'Nguyen', email: 'a@b.c', address: 'HCM' });
        mockDb.UserSetting.findOne.mockResolvedValueOnce({ categoryJobCode: 'IT', addressCode: 'HCM', experienceJobCode: '3Y', salaryJobCode: 'S1', file: 'cv' });
        mockDb.UserSkill.count.mockResolvedValueOnce(3);
        mockDb.RewardTransaction.findOne.mockResolvedValueOnce(null);
        mockDb.RewardTransaction.create.mockResolvedValueOnce({ id: 10, amount: 20 });
        const complete = await rewardService.claimProfileCompleteBonus(7);
        expect(complete.errCode).toBe(0);
        expect(complete.pointsAdded).toBe(20);

        // Candidate transactions list
        mockDb.RewardTransaction.findAndCountAll.mockResolvedValueOnce({ rows: [{ id: 10 }], count: 1 });
        const txList = await rewardService.getCandidateTransactions({ userId: 7, limit: 10, offset: 0 });
        expect(txList.errCode).toBe(0);
        expect(txList.count).toBe(1);
    });

    test('builds and unlocks competition insights report (TopCV model)', async () => {
        expect((await rewardService.getJobCompetitionReport({})).errCode).toBe(1);
        expect((await rewardService.unlockJobCompetitionReport({})).errCode).toBe(1);

        mockDb.Post.findOne.mockResolvedValueOnce(null);
        expect((await rewardService.getJobCompetitionReport({ postId: 999 })).errCode).toBe(2);

        mockDb.Post.findOne.mockResolvedValue({
            id: 12,
            postDetailData: {
                name: 'Senior Frontend Developer',
                amount: 2,
                categoryJobCode: 'IT',
                salaryJobCode: '25-40',
                experienceJobCode: '3Y',
                salaryTypePostData: { value: '25 - 40 triệu' },
                expTypePostData: { value: '3 năm' },
                jobTypePostData: { value: 'CNTT' },
                descriptionHTML: '<p>React TypeScript Next.js</p>'
            }
        });
        mockDb.Cv.findAll.mockResolvedValue([
            { id: 1, userId: 20, createdAt: new Date() },
            { id: 2, userId: 21, createdAt: new Date() },
            { id: 3, userId: 22, createdAt: new Date() }
        ]);
        mockDb.UserSetting.findAll.mockResolvedValue([
            { userId: 20, expTypeSettingData: { value: '1 năm kinh nghiệm' } },
            { userId: 21, expTypeSettingData: { value: '3 - 5 năm' } },
            { userId: 22, expTypeSettingData: { value: 'Trên 5 năm' } }
        ]);
        mockDb.Skill.findAll.mockResolvedValue([{ id: 1, name: 'React' }, { id: 2, name: 'TypeScript' }]);
        mockDb.UserSkill.findAll.mockResolvedValue([{ SkillId: 1 }, { SkillId: 2 }]);
        mockDb.UserSetting.findOne.mockResolvedValue({ experienceJobCode: '3Y', expTypeSettingData: { value: '3.5 năm' } });

        // Locked state first
        mockDb.CompetitionUnlock.findOne.mockResolvedValueOnce(null);
        const wallet = makeWallet({ balance: 45 });
        mockDb.RewardWallet.findOne.mockResolvedValue(wallet);

        const locked = await rewardService.getJobCompetitionReport({ postId: 12, userId: 7 });
        expect(locked.errCode).toBe(0);
        expect(locked.data.unlocked).toBe(false);
        expect(locked.data.totalApplicants).toBe(3);

        // Insufficient balance branch
        const lowWallet = makeWallet({ balance: 2 });
        mockDb.RewardWallet.findOne.mockResolvedValueOnce(lowWallet);
        mockDb.CompetitionUnlock.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
        const insufficient = await rewardService.unlockJobCompetitionReport({ postId: 12, userId: 7 });
        expect(insufficient.errCode).toBe(2);

        // Unlock report (-10 points)
        mockDb.RewardWallet.findOne.mockResolvedValue(wallet);
        mockDb.CompetitionUnlock.findOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 5, expiresAt: new Date(Date.now() + 86400000) });
        mockDb.RewardTransaction.findOne.mockResolvedValueOnce(null);
        mockDb.RewardTransaction.create.mockResolvedValueOnce({ id: 88 });
        mockDb.CompetitionUnlock.create.mockResolvedValueOnce({ id: 5 });

        const unlocked = await rewardService.unlockJobCompetitionReport({ postId: 12, userId: 7 });
        expect(unlocked.errCode).toBe(0);
        expect(unlocked.data.unlocked).toBe(true);
        expect(unlocked.data.experienceBreakdown).toHaveLength(3);
        expect(wallet.balance).toBe(35);
    });

    test('manages employer Top Points, historical order sync, and catalog redemption', async () => {
        expect((await rewardService.getEmployerRewardOverview(null)).errCode).toBe(1);
        expect((await rewardService.redeemEmployerPoints({})).errCode).toBe(1);
        expect((await rewardService.redeemEmployerPoints({ companyId: 4, userId: 9, itemCode: 'INVALID' })).errCode).toBe(2);

        const company = { id: 4, name: 'VNG', allowPost: 2, allowHotPost: 1, allowCv: 5, save: jest.fn() };
        const wallet = makeWallet({ ownerType: 'COMPANY', ownerId: 4, balance: 20, lifetimeEarned: 60 });
        mockDb.Company.findOne.mockResolvedValue(company);
        mockDb.RewardWallet.findOne.mockResolvedValue(wallet);
        mockDb.User.findAll.mockResolvedValueOnce([{ id: 9 }]);
        mockDb.OrderPackage.findAll.mockResolvedValueOnce([{ id: 11, currentPrice: 10, amount: 2 }]);
        mockDb.OrderPackageCV.findAll.mockResolvedValueOnce([{ id: 12, currentPrice: 15, amount: 1 }]);
        mockDb.RewardTransaction.findOne.mockResolvedValue(null);
        mockDb.RewardTransaction.create.mockResolvedValue({ id: 100 });

        const overview = await rewardService.getEmployerRewardOverview(4);
        expect(overview.errCode).toBe(0);
        expect(overview.data.tier.code).toBe('GOLD');

        const redeemed = await rewardService.redeemEmployerPoints({
            companyId: 4,
            userId: 9,
            itemCode: 'CV_5'
        });
        expect(redeemed.errCode).toBe(0);
        expect(company.allowCv).toBe(10);
    });

    test('handles checkout, promo codes, package purchases, IPNs, and return verification across gateways', async () => {
        expect(paymentOrderService.evaluatePromo({ promoCode: '', provider: 'VNPAY', amountVnd: 50000 }).valid).toBe(true);
        expect(paymentOrderService.evaluatePromo({ promoCode: 'INVALID_CODE', provider: 'VNPAY', amountVnd: 50000 }).valid).toBe(false);
        expect(paymentOrderService.evaluatePromo({ promoCode: 'VNPAY5K', provider: 'MOMO', amountVnd: 50000 }).valid).toBe(false);
        expect(paymentOrderService.evaluatePromo({ promoCode: 'JOBFIND10K', provider: 'VNPAY', amountVnd: 20000 }).valid).toBe(false);

        expect((await paymentOrderService.createCheckout({})).errCode).toBe(1);
        expect((await paymentOrderService.createCheckout({ userId: 7, provider: 'VNPAY', itemCode: 'NOPE' })).errCode).toBe(2);
        expect((await paymentOrderService.createCheckout({ userId: 7, provider: 'VNPAY', purpose: 'UNKNOWN', itemCode: 'BASIC' })).errCode).toBe(2);

        // PACKAGE_POST checkout & settlement
        mockDb.PackagePost.findOne.mockResolvedValueOnce({
            id: 5,
            name: 'Gói 10 bài đăng Hot',
            price: 20,
            value: 10,
            isHot: 1,
            isActive: 1
        });
        const postOrder = {
            id: 2,
            orderCode: 'JF600',
            provider: 'MOMO',
            purpose: 'PACKAGE_POST',
            userId: 9,
            companyId: 4,
            itemCode: '5',
            itemName: 'Gói 10 bài đăng Hot',
            quantity: 2,
            unitPrice: 20,
            amount: 960000,
            points: 10,
            entitlementType: 'ALLOW_HOT_POST',
            entitlementAmount: 20,
            status: 'PENDING',
            simulated: true,
            save: jest.fn()
        };
        mockDb.PaymentOrder.create.mockResolvedValueOnce(postOrder);
        const postCheckout = await paymentOrderService.createCheckout({
            userId: 9,
            companyId: 4,
            purpose: 'PACKAGE_POST',
            itemCode: 5,
            quantity: 2,
            provider: 'MOMO'
        });
        expect(postCheckout.errCode).toBe(0);

        const company = { id: 4, allowPost: 0, allowHotPost: 1, allowCv: 0, save: jest.fn() };
        mockDb.Company.findOne.mockResolvedValue(company);
        mockDb.PaymentOrder.findOne.mockResolvedValue(postOrder);
        mockDb.OrderPackage.create.mockResolvedValueOnce({ id: 77 });
        mockDb.RewardWallet.findOne.mockResolvedValue(makeWallet({ ownerType: 'COMPANY', ownerId: 4, balance: 10 }));
        mockDb.RewardTransaction.findOne.mockResolvedValueOnce(null);
        mockDb.RewardTransaction.create.mockResolvedValueOnce({ id: 301 });

        const settledPost = await paymentOrderService.settleOrderPaid('JF600', { transId: 'TX600' });
        expect(settledPost.errCode).toBe(0);
        expect(company.allowHotPost).toBe(21);
        expect(postOrder.status).toBe('PAID');

        // Calling settleOrderPaid again is idempotent
        const settledAgain = await paymentOrderService.settleOrderPaid('JF600');
        expect(settledAgain.alreadyProcessed).toBe(true);

        // Sandbox simulation preview & cancel branches
        const pendingSimOrder = {
            ...postOrder,
            orderCode: 'JF601',
            status: 'PENDING',
            simulated: true,
            save: jest.fn()
        };
        mockDb.PaymentOrder.findOne.mockResolvedValue(pendingSimOrder);
        const simPreview = await paymentOrderService.verifyPaymentReturn({
            userId: 9,
            provider: 'MOMO',
            params: { order: 'JF601' }
        });
        expect(simPreview.requireSimulationAction).toBe(true);

        expect(gatewaysIndex.evaluateSimulatedCard('VNPAY', '9704198526191432198', '123456').ok).toBe(true);
        expect(gatewaysIndex.evaluateSimulatedCard('VNPAY', '', '123456').ok).toBe(false);
        expect(gatewaysIndex.evaluateSimulatedCard('VNPAY', '9704198526191432198', '').ok).toBe(false);
        expect(gatewaysIndex.evaluateSimulatedCard('VNPAY', '9704198526191432198', '999999').ok).toBe(false);
        expect(gatewaysIndex.evaluateSimulatedCard('VNPAY', '9704195798459170488', '123456').ok).toBe(false);
        expect(gatewaysIndex.evaluateSimulatedCard('ZALOPAY', '9704540000000047', '123456').ok).toBe(false);
        expect(gatewaysIndex.evaluateSimulatedCard('MOMO', '12345', '000000').ok).toBe(false);

        const simEmptyCard = await paymentOrderService.verifyPaymentReturn({
            userId: 9,
            provider: 'MOMO',
            params: { order: 'JF601', simulateAction: 'confirm' }
        });
        expect(simEmptyCard.errCode).toBe(2);
        expect(simEmptyCard.requireSimulationAction).toBe(true);

        const simBadCard = await paymentOrderService.verifyPaymentReturn({
            userId: 9,
            provider: 'MOMO',
            params: { order: 'JF601', simulateAction: 'confirm', simulateCardNumber: '9704195798459170488' }
        });
        expect(simBadCard.errCode).toBe(2);
        expect(simBadCard.requireSimulationAction).toBe(true);
        expect(pendingSimOrder.status).toBe('PENDING');

        const simCancel = await paymentOrderService.verifyPaymentReturn({
            userId: 9,
            provider: 'MOMO',
            params: { order: 'JF601', simulateAction: 'cancel' }
        });
        expect(simCancel.errCode).toBe(2);
        expect(pendingSimOrder.status).toBe('CANCELLED');

        // Live gateway return & IPN branches (VNPAY, MOMO, ZALOPAY, PAYPAL)
        const { hmacHex } = require('../../src/services/payment/gateways/common');
        process.env.VNP_TMN_CODE = 'TMN123';
        process.env.VNP_HASH_SECRET = 'SECRET123456';
        process.env.MOMO_PARTNER_CODE = 'MOMO_PARTNER';
        process.env.MOMO_ACCESS_KEY = 'ACCESS_1';
        process.env.MOMO_SECRET_KEY = 'SECRET_1';
        process.env.ZALOPAY_APP_ID = '2554';
        process.env.ZALOPAY_KEY1 = 'KEY1_SECRET';
        process.env.ZALOPAY_KEY2 = 'KEY2_SECRET';
        process.env.PAYPAL_CLIENT_ID = 'PP_ID';
        process.env.PAYPAL_CLIENT_SECRET = 'PP_SECRET';

        const makeLiveOrder = (provider, extra = {}) => ({
            id: 99,
            orderCode: 'JF700',
            provider,
            purpose: 'POINT_TOPUP',
            userId: 7,
            itemCode: 'BASIC',
            itemName: 'Gói Khởi Đầu',
            amount: 20000,
            providerAmount: '1.00',
            points: 22,
            status: 'PENDING',
            simulated: false,
            providerRef: provider === 'ZALOPAY' ? zalopay.buildAppTransId('JF700') : 'PAY-700',
            save: jest.fn(),
            ...extra
        });

        mockDb.RewardWallet.findOne.mockResolvedValue(makeWallet({ ownerType: 'CANDIDATE', ownerId: 7, balance: 10 }));
        mockDb.RewardTransaction.findOne.mockResolvedValue(null);
        mockDb.RewardTransaction.create.mockResolvedValue({ id: 500 });

        // VNPAY return: invalid hash & valid success
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('VNPAY'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'VNPAY',
            params: { vnp_TxnRef: 'JF700', vnp_Amount: '2000000', vnp_ResponseCode: '00', vnp_SecureHash: 'bad' }
        })).errCode).toBe(2);

        const vnpParams = { vnp_TxnRef: 'JF700', vnp_Amount: '2000000', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: 'VNPTX1' };
        vnpParams.vnp_SecureHash = vnpay.sign(vnpParams);
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('VNPAY'));
        expect((await paymentOrderService.verifyPaymentReturn({ userId: 7, provider: 'VNPAY', params: vnpParams })).errCode).toBe(0);

        // VNPAY IPN: not found, amount mismatch, success
        mockDb.PaymentOrder.findOne.mockResolvedValueOnce(null);
        expect((await paymentOrderService.handleVnpayIpn(vnpParams)).RspCode).toBe('01');
        mockDb.PaymentOrder.findOne.mockResolvedValueOnce(makeLiveOrder('VNPAY', { amount: 99999 }));
        expect((await paymentOrderService.handleVnpayIpn(vnpParams)).RspCode).toBe('04');
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('VNPAY'));
        expect((await paymentOrderService.handleVnpayIpn(vnpParams)).RspCode).toBe('00');

        // MOMO return & IPN
        const momoBody = {
            partnerCode: 'MOMO_PARTNER',
            amount: '20000',
            extraData: '',
            message: 'OK',
            orderId: 'JF700',
            orderInfo: 'Info',
            orderType: 'momo_wallet',
            payType: 'napas',
            requestId: 'R700',
            responseTime: '1700000000',
            resultCode: 0,
            transId: 'MM700'
        };
        momoBody.signature = hmacHex('sha256', 'SECRET_1', momo.resultSignatureRaw('ACCESS_1', momoBody));
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('MOMO'));
        expect((await paymentOrderService.verifyPaymentReturn({ userId: 7, provider: 'MOMO', params: { ...momoBody, signature: 'bad' } })).errCode).toBe(2);
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('MOMO'));
        expect((await paymentOrderService.verifyPaymentReturn({ userId: 7, provider: 'MOMO', params: momoBody })).errCode).toBe(0);
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('MOMO'));
        expect((await paymentOrderService.handleMomoIpn(momoBody)).httpStatus).toBe(200);

        // ZALOPAY redirect checksum (invalid, cancelled, success) & callback
        const zpOrder = makeLiveOrder('ZALOPAY');
        const zpRedirect = {
            appid: '2554',
            apptransid: zpOrder.providerRef,
            pmcid: '39',
            bankcode: 'ATM',
            amount: '20000',
            discountamount: '0',
            status: '1'
        };
        zpRedirect.checksum = hmacHex(
            'sha256',
            'KEY2_SECRET',
            `${zpRedirect.appid}|${zpRedirect.apptransid}|${zpRedirect.pmcid}|${zpRedirect.bankcode}|${zpRedirect.amount}|${zpRedirect.discountamount}|${zpRedirect.status}`
        );
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('ZALOPAY'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'ZALOPAY',
            params: { ...zpRedirect, checksum: 'wrong' }
        })).errCode).toBe(2);

        const zpCancelRedirect = { ...zpRedirect, status: '-49' };
        zpCancelRedirect.checksum = hmacHex(
            'sha256',
            'KEY2_SECRET',
            `${zpCancelRedirect.appid}|${zpCancelRedirect.apptransid}|${zpCancelRedirect.pmcid}|${zpCancelRedirect.bankcode}|${zpCancelRedirect.amount}|${zpCancelRedirect.discountamount}|${zpCancelRedirect.status}`
        );
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('ZALOPAY'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'ZALOPAY',
            params: zpCancelRedirect
        })).errCode).toBe(2);

        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('ZALOPAY'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'ZALOPAY',
            params: zpRedirect
        })).errCode).toBe(0);

        const zpCallbackData = JSON.stringify({ app_trans_id: zpOrder.providerRef, amount: 20000, zp_trans_id: 888 });
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('ZALOPAY'));
        expect((await paymentOrderService.handleZaloPayCallback({
            data: zpCallbackData,
            mac: hmacHex('sha256', 'KEY2_SECRET', zpCallbackData)
        })).return_code).toBe(1);

        // PAYPAL return: cancel, missing PayerID, success
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('PAYPAL'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'PAYPAL',
            params: { order: 'JF700', cancel: '1' }
        })).errCode).toBe(2);
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('PAYPAL'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'PAYPAL',
            params: { order: 'JF700' }
        })).errCode).toBe(1);
        mockPaypal.payment.execute.mockImplementationOnce((id, payload, cb) => cb(null, {
            id: 'PAY-700',
            state: 'approved',
            transactions: [{
                amount: { currency: 'USD', total: '1.00' },
                related_resources: [{ sale: { id: 'SALE-700', state: 'completed' } }]
            }]
        }));
        mockDb.PaymentOrder.findOne.mockResolvedValue(makeLiveOrder('PAYPAL'));
        expect((await paymentOrderService.verifyPaymentReturn({
            userId: 7,
            provider: 'PAYPAL',
            params: { order: 'JF700', PayerID: 'PAYER700' }
        })).errCode).toBe(0);

        delete process.env.VNP_TMN_CODE;
        delete process.env.VNP_HASH_SECRET;
        delete process.env.MOMO_PARTNER_CODE;
        delete process.env.MOMO_ACCESS_KEY;
        delete process.env.MOMO_SECRET_KEY;
        delete process.env.ZALOPAY_APP_ID;
        delete process.env.ZALOPAY_KEY1;
        delete process.env.ZALOPAY_KEY2;
        delete process.env.PAYPAL_CLIENT_ID;
        delete process.env.PAYPAL_CLIENT_SECRET;

        // IPN handlers invalid signatures
        expect((await paymentOrderService.handleVnpayIpn({})).RspCode).toBe('97');
        expect((await paymentOrderService.handleMomoIpn({})).httpStatus).toBe(400);
        expect((await paymentOrderService.handleZaloPayCallback({})).return_code).toBe(-1);

        // Payment orders list
        mockDb.PaymentOrder.findAndCountAll.mockResolvedValueOnce({ rows: [postOrder], count: 1 });
        const ordersRes = await paymentOrderService.getUserPaymentOrders({ userId: 9 });
        expect(ordersRes.errCode).toBe(0);
        expect(ordersRes.count).toBe(1);
    });

    test('all controller endpoints handle normal and error responses', async () => {
        const wallet = makeWallet({ balance: 45 });
        mockDb.RewardWallet.findOne.mockResolvedValue(wallet);
        mockDb.RewardTransaction.findOne.mockResolvedValue(null);
        mockDb.RewardTransaction.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
        mockDb.User.findOne.mockResolvedValue({ id: 7, firstName: 'A', lastName: 'B', email: 'a@b.c', address: 'HN' });
        mockDb.UserSetting.findOne.mockResolvedValue({ categoryJobCode: 'IT', addressCode: 'HN', experienceJobCode: '3Y', salaryJobCode: 'S1' });
        mockDb.UserSkill.count.mockResolvedValue(2);
        mockDb.Company.findOne.mockResolvedValue({ id: 4, name: 'VNG', allowPost: 1, allowHotPost: 0, allowCv: 2, save: jest.fn() });
        mockDb.Post.findOne.mockResolvedValue({ id: 12, postDetailData: { name: 'Dev', amount: 1 } });
        mockDb.PaymentOrder.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

        const candidateUser = {
            id: 7,
            companyId: null,
            userAccountData: { roleCode: 'CANDIDATE' }
        };
        const companyOwnerUser = {
            id: 9,
            companyId: 4,
            userCompanyData: { id: 4, statusCode: 'S1', censorCode: 'CS1' },
            userAccountData: { roleCode: 'COMPANY' }
        };

        const calls = [
            () => controller.getCandidateOverview(createRequest({ user: candidateUser }), createResponse()),
            () => controller.getCandidateTransactions(createRequest({ user: candidateUser, query: { limit: 5 } }), createResponse()),
            () => controller.claimDailyCheckin(createRequest({ user: candidateUser }), createResponse()),
            () => controller.claimProfileComplete(createRequest({ user: candidateUser }), createResponse()),
            () => controller.getCompetitionReport(createRequest({ user: candidateUser, params: { postId: 12 } }), createResponse()),
            () => controller.unlockCompetitionReport(createRequest({ user: candidateUser, params: { postId: 12 } }), createResponse()),
            () => controller.getEmployerOverview(createRequest({ user: companyOwnerUser }), createResponse()),
            () => controller.redeemEmployerPoints(createRequest({ user: companyOwnerUser, body: { itemCode: 'CV_5' } }), createResponse()),
            () => controller.getPaymentCatalog(createRequest({ user: candidateUser }), createResponse()),
            () => controller.previewPromoCode(createRequest({ body: { promoCode: 'VNPAY5K', provider: 'VNPAY', amountVnd: 50000 } }), createResponse()),
            () => controller.createCheckout(createRequest({ user: candidateUser, body: { purpose: 'POINT_TOPUP', itemCode: 'BASIC', provider: 'VNPAY' } }), createResponse()),
            () => controller.verifyPaymentReturn(createRequest({ user: companyOwnerUser, query: { order: 'JF500', provider: 'VNPAY' } }), createResponse()),
            () => controller.getPaymentOrders(createRequest({ user: candidateUser, query: { scope: 'user' } }), createResponse()),
            () => controller.vnpayIpn(createRequest({ query: {} }), createResponse()),
            () => controller.momoIpn(createRequest({ body: {} }), createResponse()),
            () => controller.zalopayCallback(createRequest({ body: {} }), createResponse()),
        ];

        for (const fn of calls) {
            await fn();
        }

        // RBAC enforcement checks across roles
        const forbiddenCandidateEndpoint = createResponse();
        await controller.claimDailyCheckin(createRequest({ user: companyOwnerUser }), forbiddenCandidateEndpoint);
        expect(forbiddenCandidateEndpoint.status).toHaveBeenCalledWith(403);

        const forbiddenTopupForEmployer = createResponse();
        await controller.createCheckout(
            createRequest({ user: companyOwnerUser, body: { purpose: 'POINT_TOPUP', itemCode: 'BASIC', provider: 'VNPAY' } }),
            forbiddenTopupForEmployer
        );
        expect(forbiddenTopupForEmployer.status).toHaveBeenCalledWith(403);

        const forbiddenPackageForCandidate = createResponse();
        await controller.createCheckout(
            createRequest({ user: candidateUser, body: { purpose: 'PACKAGE_POST', itemCode: 5, provider: 'MOMO' } }),
            forbiddenPackageForCandidate
        );
        expect(forbiddenPackageForCandidate.status).toHaveBeenCalledWith(403);

        const forbiddenPackageForSubEmployer = createResponse();
        await controller.createCheckout(
            createRequest({ body: { purpose: 'PACKAGE_CV', itemCode: 2, provider: 'VNPAY' } }),
            forbiddenPackageForSubEmployer
        );
        expect(forbiddenPackageForSubEmployer.status).toHaveBeenCalledWith(403);
    });
});
