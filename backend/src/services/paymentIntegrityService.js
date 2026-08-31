import db from '../models/index';
import paypal from 'paypal-rest-sdk';

require('dotenv').config();

paypal.configure({
    mode: process.env.PAYPAL_MODE || 'sandbox',
    client_id: process.env.PAYPAL_CLIENT_ID || process.env.CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET || process.env.CLIENT_SECRET
});

const CURRENCY = 'USD';
const MAX_QUANTITY = 1000;
const COMPLETED_MESSAGE = 'Hệ thống đã ghi nhận lịch sử mua của bạn';

const packageConfigs = {
    POST: {
        model: 'PackagePost',
        orderModel: 'OrderPackage',
        orderPackageKey: 'packagePostId',
        returnPath: '/admin/payment/success',
        cancelPath: '/admin/payment/cancel',
        missingMessage: 'Gói bài đăng không tồn tại hoặc đã ngừng kinh doanh',
        entitlement: (item) => Number(item.isHot) === 1 ? 'ALLOW_HOT_POST' : 'ALLOW_POST'
    },
    CV: {
        model: 'PackageCv',
        orderModel: 'OrderPackageCV',
        orderPackageKey: 'packageCvId',
        returnPath: '/admin/paymentCv/success',
        cancelPath: '/admin/paymentCv/cancel',
        missingMessage: 'Gói xem ứng viên không tồn tại hoặc đã ngừng kinh doanh',
        entitlement: () => 'ALLOW_CV'
    }
};

const allowanceFields = {
    ALLOW_POST: 'allowPost',
    ALLOW_HOT_POST: 'allowHotPost',
    ALLOW_CV: 'allowCv'
};

const invalidParameters = () => ({
    errCode: 1,
    errMessage: 'Missing required parameters !'
});

const invalidPayment = (message = 'Giao dịch không tồn tại hoặc không thuộc tài khoản này') => ({
    errCode: 2,
    errMessage: message
});

const completedResponse = (alreadyProcessed = false) => ({
    errCode: 0,
    errMessage: alreadyProcessed
        ? 'Giao dịch này đã được ghi nhận trước đó'
        : COMPLETED_MESSAGE,
    ...(alreadyProcessed ? { alreadyProcessed: true } : {})
});

const parseQuantity = (value) => {
    const quantity = Number(value);
    return Number.isInteger(quantity) && quantity > 0 && quantity <= MAX_QUANTITY
        ? quantity
        : null;
};

const money = (value) => Number(value).toFixed(2);

const getFrontendUrl = () => (process.env.URL_REACT || 'http://localhost:3000')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '');

const getIntentTtlMilliseconds = () => {
    const configuredMinutes = Number(process.env.PAYMENT_INTENT_TTL_MINUTES || 30);
    const minutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0
        ? configuredMinutes
        : 30;
    return minutes * 60 * 1000;
};

const createPaypalPayment = (payload) => new Promise((resolve) => {
    paypal.payment.create(payload, (error, payment) => resolve({ error, payment }));
});

const executePaypalPayment = (paymentId, payload) => new Promise((resolve) => {
    paypal.payment.execute(paymentId, payload, (error, payment) => resolve({ error, payment }));
});

const getPaypalPayment = (paymentId) => new Promise((resolve) => {
    paypal.payment.get(paymentId, (error, payment) => resolve({ error, payment }));
});

const findApprovalLink = (payment) => (payment?.links || []).find((link) => (
    link.rel === 'approval_url' || /[?&]token=/.test(link.href || '')
));

const getProviderToken = (approvalLink) => {
    try {
        return new URL(approvalLink).searchParams.get('token');
    } catch (error) {
        return null;
    }
};

const providerPaymentMatches = (payment, intent, expectedPayerId) => {
    if (!payment) return false;
    if (payment.id && String(payment.id) !== String(intent.providerPaymentId)) return false;
    if (payment.state && String(payment.state).toLowerCase() !== 'approved') return false;

    const providerPayerId = payment.payer?.payer_info?.payer_id;
    if (expectedPayerId && providerPayerId
        && String(providerPayerId) !== String(expectedPayerId)) return false;

    const providerAmount = payment.transactions?.[0]?.amount;
    if (providerAmount) {
        if (String(providerAmount.currency || '').toUpperCase() !== String(intent.currency).toUpperCase()) return false;
        if (money(providerAmount.total) !== money(intent.totalPrice)) return false;
    }
    return true;
};

const findPurchaserCompany = async (userId) => {
    const user = await db.User.findOne({
        where: { id: userId },
        attributes: { exclude: ['userId'] }
    });
    if (!user?.companyId) return null;

    const company = await db.Company.findOne({ where: { id: user.companyId } });
    return company ? { user, company } : null;
};

const createPaymentLink = async ({ type, userId, packageId, amount }) => {
    const config = packageConfigs[type];
    const quantity = parseQuantity(amount);
    if (!config || !userId || !packageId || !quantity) return invalidParameters();

    const infoItem = await db[config.model].findOne({ where: { id: packageId } });
    if (!infoItem || Number(infoItem.isActive) === 0) {
        return invalidPayment(config.missingMessage);
    }

    const rawUnitPrice = Number(infoItem.price);
    const unitPrice = Number.isFinite(rawUnitPrice) ? Number(money(rawUnitPrice)) : NaN;
    const packageValue = Number(infoItem.value);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0
        || !Number.isInteger(packageValue) || packageValue <= 0) {
        return invalidPayment('Cấu hình gói thanh toán không hợp lệ');
    }

    const purchaser = await findPurchaserCompany(userId);
    if (!purchaser) return invalidPayment('Người dùng không thuộc công ty hợp lệ');

    const totalPrice = Number(money(unitPrice * quantity));
    if (!Number.isFinite(totalPrice) || totalPrice <= 0 || totalPrice > 9999999999.99) {
        return invalidPayment('Tổng tiền của giao dịch không hợp lệ');
    }
    const frontendUrl = getFrontendUrl();
    const createPayload = {
        intent: 'sale',
        payer: { payment_method: 'paypal' },
        redirect_urls: {
            return_url: `${frontendUrl}${config.returnPath}`,
            cancel_url: `${frontendUrl}${config.cancelPath}`
        },
        transactions: [{
            item_list: {
                items: [{
                    name: String(infoItem.name),
                    sku: String(infoItem.id),
                    price: money(unitPrice),
                    currency: CURRENCY,
                    quantity
                }]
            },
            amount: { currency: CURRENCY, total: money(totalPrice) },
            description: `JobFind ${type === 'POST' ? 'post' : 'CV'} package`
        }]
    };

    const { error, payment } = await createPaypalPayment(createPayload);
    if (error) {
        return {
            errCode: -1,
            errMessage: error.message || 'Không thể tạo giao dịch PayPal'
        };
    }

    const approvalLink = findApprovalLink(payment);
    const providerToken = getProviderToken(approvalLink?.href);
    if (!payment?.id || !approvalLink?.href || !providerToken) {
        return {
            errCode: -1,
            errMessage: 'PayPal trả về giao dịch không đầy đủ'
        };
    }

    await db.PaymentIntent.create({
        provider: 'PAYPAL',
        providerPaymentId: String(payment.id),
        providerToken,
        userId: Number(userId),
        companyId: Number(purchaser.company.id),
        packageType: type,
        packageId: Number(infoItem.id),
        quantity,
        unitPrice: money(unitPrice),
        totalPrice: money(totalPrice),
        currency: CURRENCY,
        entitlementType: config.entitlement(infoItem),
        entitlementAmount: packageValue * quantity,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + getIntentTtlMilliseconds())
    });

    return { errCode: 0, link: approvalLink.href };
};

const markExpired = async (intent) => {
    intent.status = 'EXPIRED';
    await intent.save();
};

const loadBoundIntent = ({ type, userId, paymentId, token }) => db.PaymentIntent.findOne({
    where: {
        provider: 'PAYPAL',
        providerPaymentId: String(paymentId),
        providerToken: String(token),
        userId: Number(userId),
        packageType: type
    },
    raw: false
});

const settleProviderPayment = async (intent, payerId) => {
    const executePayload = {
        payer_id: payerId,
        transactions: [{
            amount: {
                currency: intent.currency,
                total: money(intent.totalPrice)
            }
        }]
    };
    const executed = await executePaypalPayment(intent.providerPaymentId, executePayload);
    if (!executed.error && providerPaymentMatches(executed.payment, intent, payerId)) return true;

    // If PayPal accepted the payment but the process stopped before our local
    // transaction committed, a retry may report "already executed". Querying
    // the provider makes that retry recoverable without granting twice.
    const fetched = await getPaypalPayment(intent.providerPaymentId);
    return !fetched.error && providerPaymentMatches(fetched.payment, intent, payerId);
};

const persistCompletedPayment = (intentId, payerId) => db.sequelize.transaction(async (transaction) => {
    const intent = await db.PaymentIntent.findOne({
        where: { id: intentId },
        transaction,
        lock: transaction.LOCK.UPDATE,
        raw: false
    });
    if (!intent) return invalidPayment();
    if (intent.status === 'COMPLETED') return completedResponse(true);
    if (intent.status !== 'PENDING') return invalidPayment('Giao dịch không còn hiệu lực');
    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
        intent.status = 'EXPIRED';
        await intent.save({ transaction });
        return invalidPayment('Giao dịch đã hết hạn');
    }

    const config = packageConfigs[intent.packageType];
    const allowanceField = allowanceFields[intent.entitlementType];
    if (!config || !allowanceField) return invalidPayment('Dữ liệu quyền lợi của giao dịch không hợp lệ');

    const company = await db.Company.findOne({
        where: { id: intent.companyId },
        transaction,
        lock: transaction.LOCK.UPDATE,
        raw: false
    });
    if (!company) return invalidPayment('Không tìm thấy công ty nhận quyền lợi');

    const order = await db[config.orderModel].create({
        [config.orderPackageKey]: intent.packageId,
        userId: intent.userId,
        currentPrice: Number(intent.unitPrice),
        amount: intent.quantity,
        paymentIntentId: intent.id
    }, { transaction });
    if (!order) return invalidPayment('Không thể ghi nhận lịch sử mua gói');

    company[allowanceField] = Number(company[allowanceField] || 0) + Number(intent.entitlementAmount);
    await company.save({ transaction, silent: true });

    intent.status = 'COMPLETED';
    intent.providerPayerId = String(payerId);
    intent.completedAt = new Date();
    await intent.save({ transaction });

    return completedResponse();
});

const completePayment = async ({ type, userId, PayerID, paymentId, token }) => {
    if (!packageConfigs[type] || !userId || !PayerID || !paymentId || !token) {
        return invalidParameters();
    }

    const intent = await loadBoundIntent({ type, userId, paymentId, token });
    if (!intent) return invalidPayment();
    if (intent.status === 'COMPLETED') return completedResponse(true);
    if (intent.status !== 'PENDING') return invalidPayment('Giao dịch không còn hiệu lực');
    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
        await markExpired(intent);
        return invalidPayment('Giao dịch đã hết hạn');
    }

    const providerSettled = await settleProviderPayment(intent, PayerID);
    if (!providerSettled) {
        const latestIntent = await db.PaymentIntent.findOne({ where: { id: intent.id } });
        if (latestIntent?.status === 'COMPLETED') return completedResponse(true);
        return {
            errCode: -1,
            errMessage: 'PayPal chưa xác nhận giao dịch'
        };
    }

    return persistCompletedPayment(intent.id, PayerID);
};

module.exports = {
    createPaymentLink,
    completePayment,
    providerPaymentMatches
};
