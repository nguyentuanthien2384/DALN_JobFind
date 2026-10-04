import db from '../models/index';
import paypal from 'paypal-rest-sdk';
const { Op } = require('sequelize');

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

// PayPal v1 Payments: `state` stays "created" until our execute call creates the sale and
// only then becomes "approved". Every check fails closed: a reply that lacks the id, state,
// payer or amount is not proof that this intent's money was captured.
const providerPaymentMatches = (payment, intent, expectedPayerId) => {
    if (!payment || typeof payment !== 'object') return false;
    if (String(payment.id) !== String(intent.providerPaymentId)) return false;
    if (String(payment.state || '').toLowerCase() !== 'approved') return false;

    const providerPayerId = payment.payer?.payer_info?.payer_id;
    if (!providerPayerId) return false;
    if (expectedPayerId !== undefined && expectedPayerId !== null
        && String(providerPayerId) !== String(expectedPayerId)) return false;

    const transaction = payment.transactions?.[0];
    const providerAmount = transaction?.amount;
    if (!providerAmount) return false;
    if (String(providerAmount.currency || '').toUpperCase() !== String(intent.currency).toUpperCase()) return false;
    if (money(providerAmount.total) !== money(intent.totalPrice)) return false;

    // A sale that is pending review, denied or refunded is not money we may deliver against.
    const sale = (transaction.related_resources || []).find((resource) => resource && resource.sale)?.sale;
    if (sale && String(sale.state || '').toLowerCase() !== 'completed') return false;
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

// Compare-and-set: a stale in-memory intent must never overwrite COMPLETED with EXPIRED, or a
// replayed callback could reconcile and grant the same purchase twice.
const markExpired = async (intent) => {
    const [updated] = await db.PaymentIntent.update(
        { status: 'EXPIRED' },
        { where: { id: intent.id, status: 'PENDING' } }
    );
    if (updated) intent.status = 'EXPIRED';
    return updated > 0;
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

// Only our execute call captures money, and it is never made for an expired intent. A capture
// can still exist for one: the process stopped after PayPal executed but before our commit, or
// the intent expired while PayPal was executing. Ask PayPal before giving up on the purchase.
const NOT_CAPTURED_STATES = ['created', 'failed'];
const reconcileExpiredIntent = async (intent, expectedPayerId) => {
    const fetched = await getPaypalPayment(intent.providerPaymentId);
    if (fetched.error || !fetched.payment) return { outcome: 'unknown' };
    if (providerPaymentMatches(fetched.payment, intent, expectedPayerId)) {
        return { outcome: 'captured', payerId: fetched.payment.payer.payer_info.payer_id };
    }
    if (String(fetched.payment.id) === String(intent.providerPaymentId)
        && NOT_CAPTURED_STATES.includes(String(fetched.payment.state || '').toLowerCase())) {
        return { outcome: 'not-captured' };
    }
    // Approved but with another amount or payer, or a pending/refunded sale: needs a human.
    return { outcome: 'unknown' };
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
    // Only called after PayPal confirmed it captured this intent's exact amount. Expiry is
    // enforced before capture; rejecting now (expired meanwhile, or marked EXPIRED by a
    // concurrent callback) would keep the customer's money without granting the package.
    if (intent.status !== 'PENDING' && intent.status !== 'EXPIRED') return invalidPayment('Giao dịch không còn hiệu lực');

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
    const expired = intent.status === 'EXPIRED'
        || (intent.status === 'PENDING' && new Date(intent.expiresAt).getTime() <= Date.now());
    if (intent.status !== 'PENDING' && !expired) return invalidPayment('Giao dịch không còn hiệu lực');
    if (expired) {
        // Never execute an expired intent, but deliver money PayPal already captured for it.
        const reconciled = await reconcileExpiredIntent(intent, PayerID);
        if (reconciled.outcome === 'captured') return persistCompletedPayment(intent.id, reconciled.payerId);
        if (reconciled.outcome === 'not-captured') {
            if (intent.status === 'PENDING' && !(await markExpired(intent))) {
                // Lost the compare-and-set: a concurrent callback settled it after our lookup.
                const latest = await db.PaymentIntent.findOne({ where: { id: intent.id } });
                if (latest?.status === 'COMPLETED') return completedResponse(true);
            }
            return invalidPayment('Giao dịch đã hết hạn');
        }
        return { errCode: -1, errMessage: 'Chưa xác minh được giao dịch với PayPal. Vui lòng thử lại sau.' };
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

// Background safety net for customers who never come back after a crash between PayPal's
// capture and our commit: settle or close PENDING intents whose payment window has passed.
const RECONCILE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const reconcileStalePayments = async ({ limit = 50 } = {}) => {
    const now = Date.now();
    const intents = await db.PaymentIntent.findAll({
        where: {
            provider: 'PAYPAL',
            status: 'PENDING',
            expiresAt: { [Op.lte]: new Date(now), [Op.gte]: new Date(now - RECONCILE_LOOKBACK_MS) }
        },
        // Newest first: intents left for human review must not starve fresh ones of the batch.
        order: [['expiresAt', 'DESC']],
        limit,
        raw: false
    });
    const summary = { checked: 0, completed: 0, expired: 0, unresolved: [] };
    for (const intent of intents) {
        summary.checked += 1;
        try {
            const reconciled = await reconcileExpiredIntent(intent);
            if (reconciled.outcome === 'captured') {
                const result = await persistCompletedPayment(intent.id, reconciled.payerId);
                if (result.errCode === 0) summary.completed += 1;
                else summary.unresolved.push(intent.id);
            } else if (reconciled.outcome === 'not-captured') {
                if (await markExpired(intent)) summary.expired += 1;
            } else {
                summary.unresolved.push(intent.id);
            }
        } catch (error) {
            summary.unresolved.push(intent.id);
        }
    }
    if (summary.unresolved.length) {
        console.warn('Payment reconciliation needs review for intents:', summary.unresolved.join(','));
    }
    return summary;
};

module.exports = {
    createPaymentLink,
    completePayment,
    providerPaymentMatches,
    reconcileStalePayments
};
