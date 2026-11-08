import db from '../models/index';
import rewardService from './rewardService';
import { emitDashboardChanged } from '../config/socket';
const {
    POINT_VALUE_VND,
    CANDIDATE_TOPUP_PACKAGES,
    formatCandidateTopupPackages,
    USD_VND_RATE,
    loadPromoCodes
} = require('../config/rewards');
const {
    gateways,
    normalizeProvider,
    listProviders,
    simulatorEnabled,
    SANDBOX_TEST_CARDS,
    evaluateSimulatedCard
} = require('./payment/gateways');
const { getPaymentReturnUrl } = require('./payment/gateways/common');

const ORDER_TTL_MS = 30 * 60 * 1000;
const GATEWAY_FAILURE_COOLDOWN_MS = 2 * 60 * 1000;
const gatewayCooldownUntil = new Map();

const isGatewayCoolingDown = (providerKey) => {
    if (process.env.NODE_ENV === 'test' || !simulatorEnabled()) return false;
    const until = gatewayCooldownUntil.get(providerKey) || 0;
    if (until <= Date.now()) {
        gatewayCooldownUntil.delete(providerKey);
        return false;
    }
    return true;
};

const markGatewayCooldown = (providerKey) => {
    if (process.env.NODE_ENV === 'test' || !simulatorEnabled()) return;
    gatewayCooldownUntil.set(providerKey, Date.now() + GATEWAY_FAILURE_COOLDOWN_MS);
};

const ALLOWANCE_FIELDS = {
    ALLOW_POST: 'allowPost',
    ALLOW_HOT_POST: 'allowHotPost',
    ALLOW_CV: 'allowCv'
};

const generateOrderCode = () => `JF${Date.now()}${Math.floor(100 + Math.random() * 900)}`;

const evaluatePromo = ({ promoCode, provider, amountVnd }) => {
    const normalized = String(promoCode || '').trim().toUpperCase();
    if (!normalized) return { valid: true, code: null, discountAmount: 0, description: null };

    const promos = loadPromoCodes();
    const promo = promos[normalized];
    if (!promo) {
        return { valid: false, code: normalized, discountAmount: 0, errMessage: 'Mã ưu đãi không tồn tại hoặc đã hết hạn' };
    }
    if (promo.provider && provider && String(promo.provider).toUpperCase() !== String(provider).toUpperCase()) {
        return {
            valid: false,
            code: normalized,
            discountAmount: 0,
            errMessage: `Mã ${normalized} chỉ áp dụng cho cổng ${promo.provider}`
        };
    }
    if (promo.minAmount && Number(amountVnd) < Number(promo.minAmount)) {
        return {
            valid: false,
            code: normalized,
            discountAmount: 0,
            errMessage: `Mã ${normalized} áp dụng cho đơn tối thiểu ${Number(promo.minAmount).toLocaleString('vi-VN')}đ`
        };
    }
    const discountAmount = Math.min(Number(promo.discount) || 0, Math.max(0, Number(amountVnd) - 5000));
    return {
        valid: true,
        code: normalized,
        discountAmount,
        description: promo.description || `Giảm ${discountAmount.toLocaleString('vi-VN')}đ`
    };
};

const getPaymentCatalog = async ({ userId, companyId, roleCode = null } = {}) => {
    const promos = loadPromoCodes();
    const promoList = Object.entries(promos).map(([code, info]) => ({
        code,
        provider: info.provider || null,
        discount: Number(info.discount) || 0,
        minAmount: Number(info.minAmount) || 0,
        description: info.description || ''
    }));
    const canLoadCandidate = Boolean(userId) && (!roleCode || roleCode === 'CANDIDATE');
    const canLoadEmployer = Boolean(companyId) && (!roleCode || roleCode === 'COMPANY' || roleCode === 'EMPLOYER');
    const candidateOverview = canLoadCandidate ? await rewardService.getCandidateRewardOverview(userId) : null;
    const employerOverview = canLoadEmployer
        ? await rewardService.getEmployerRewardOverview(companyId, { canRedeem: !roleCode || roleCode === 'COMPANY' })
        : null;

    return {
        errCode: 0,
        data: {
            providers: listProviders(),
            topupPackages: formatCandidateTopupPackages(),
            promoCodes: promoList,
            pointValueVnd: POINT_VALUE_VND,
            usdVndRate: USD_VND_RATE,
            candidateRewards: candidateOverview?.errCode === 0 ? candidateOverview.data : null,
            employerRewards: employerOverview?.errCode === 0 ? employerOverview.data : null
        }
    };
};

const resolveOrderSpec = async ({ purpose, itemCode, quantity = 1, userId, companyId }) => {
    const normalizedPurpose = String(purpose || 'POINT_TOPUP').trim().toUpperCase();
    const qty = Math.max(1, Math.min(1000, Math.round(Number(quantity) || 1)));

    if (normalizedPurpose === 'POINT_TOPUP') {
        const pkg = CANDIDATE_TOPUP_PACKAGES.find((item) => item.code === String(itemCode || '').trim().toUpperCase());
        if (!pkg) return { error: 'Gói nạp điểm không tồn tại' };
        return {
            purpose: 'POINT_TOPUP',
            itemCode: pkg.code,
            itemName: pkg.name,
            quantity: 1,
            unitPrice: pkg.price,
            originalAmount: pkg.price,
            points: Number(pkg.points) + Number(pkg.bonus || 0),
            entitlementType: null,
            entitlementAmount: 0,
            companyId: null
        };
    }

    if (normalizedPurpose === 'PACKAGE_POST' || normalizedPurpose === 'PACKAGE_CV') {
        let resolvedCompanyId = companyId ? Number(companyId) : null;
        if (!resolvedCompanyId && userId && db.User?.findOne) {
            const user = await db.User.findOne({ where: { id: Number(userId) }, attributes: ['id', 'companyId'] });
            resolvedCompanyId = user?.companyId ? Number(user.companyId) : null;
        }
        if (!resolvedCompanyId) return { error: 'Tài khoản chưa liên kết với công ty hợp lệ' };

        const isPost = normalizedPurpose === 'PACKAGE_POST';
        const model = isPost ? db.PackagePost : db.PackageCv;
        const pkg = await model.findOne({ where: { id: Number(itemCode) } });
        if (!pkg || Number(pkg.isActive) === 0) {
            return { error: isPost ? 'Gói đăng tin không tồn tại hoặc đã ngừng kinh doanh' : 'Gói xem CV không tồn tại hoặc đã ngừng kinh doanh' };
        }
        const unitUsd = Number(pkg.price);
        const pkgValue = Number(pkg.value);
        if (!Number.isFinite(unitUsd) || unitUsd <= 0 || !Number.isInteger(pkgValue) || pkgValue <= 0) {
            return { error: 'Cấu hình gói dịch vụ không hợp lệ' };
        }
        const originalAmount = Math.round(unitUsd * qty * USD_VND_RATE);
        const entitlementType = isPost ? (Number(pkg.isHot) === 1 ? 'ALLOW_HOT_POST' : 'ALLOW_POST') : 'ALLOW_CV';
        return {
            purpose: normalizedPurpose,
            itemCode: String(pkg.id),
            itemName: pkg.name,
            quantity: qty,
            unitPrice: unitUsd,
            originalAmount,
            points: rewardService.calculateEmployerTopPoints(originalAmount),
            entitlementType,
            entitlementAmount: pkgValue * qty,
            companyId: resolvedCompanyId
        };
    }

    return { error: 'Loại giao dịch thanh toán không hợp lệ' };
};

const enrichOrderPayload = (order, { requireSimulationAction = false, postId = null } = {}) => {
    if (!order || typeof order !== 'object') return order;
    const discountVnd = Number(order.discountAmount ?? order.discountVnd ?? 0);
    const finalAmountVnd = Number(order.amount ?? order.finalAmountVnd ?? 0);
    const pointsGranted = Number(order.points ?? order.pointsGranted ?? 0);
    const paid = order.status === 'PAID';
    const snapshot = {
        id: order.id,
        orderCode: order.orderCode,
        provider: order.provider,
        purpose: order.purpose,
        itemCode: order.itemCode,
        itemName: order.itemName,
        quantity: order.quantity,
        originalAmount: order.originalAmount,
        discountAmount: order.discountAmount,
        discountVnd,
        promoCode: order.promoCode || null,
        amount: order.amount,
        finalAmountVnd,
        currency: order.currency,
        providerAmount: order.providerAmount,
        points: order.points,
        pointsGranted,
        entitlementType: order.entitlementType,
        entitlementAmount: order.entitlementAmount,
        status: order.status,
        simulated: Boolean(order.simulated),
        testCards: SANDBOX_TEST_CARDS[order.provider] || [],
        metadata: postId ? { postId } : (order.metadata || null)
    };
    const extraFields = {
        discountVnd,
        finalAmountVnd,
        pointsGranted,
        paid,
        requireSimulationAction: Boolean(requireSimulationAction),
        testCards: SANDBOX_TEST_CARDS[order.provider] || [],
        order: snapshot
    };
    if (order.dataValues && typeof order.dataValues === 'object') {
        Object.assign(order.dataValues, extraFields);
    }
    Object.assign(order, extraFields);
    return order;
};

const createCheckout = async ({
    userId,
    companyId,
    purpose = 'POINT_TOPUP',
    itemCode,
    quantity = 1,
    provider,
    promoCode,
    ipAddr,
    bankCode,
    postId = null
}) => {
    const providerKey = normalizeProvider(provider);
    if (!userId || !providerKey || !itemCode) {
        return { errCode: 1, errMessage: 'Missing required parameters !' };
    }

    const spec = await resolveOrderSpec({ purpose, itemCode, quantity, userId, companyId });
    if (spec.error) return { errCode: 2, errMessage: spec.error };

    const promo = evaluatePromo({ promoCode, provider: providerKey, amountVnd: spec.originalAmount });
    if (!promo.valid) return { errCode: 2, errMessage: promo.errMessage };

    const amount = Math.max(5000, spec.originalAmount - promo.discountAmount);
    const isUsdGateway = providerKey === 'PAYPAL';
    const providerAmount = isUsdGateway
        ? Number(Math.max(1, amount / USD_VND_RATE).toFixed(2))
        : amount;
    const currency = isUsdGateway ? 'USD' : 'VND';
    const orderCode = generateOrderCode();
    const expiresAt = new Date(Date.now() + ORDER_TTL_MS);
    const orderInfo = `JobFind ${spec.itemName} (${orderCode})`;

    const gateway = gateways[providerKey];
    let gatewayResult = null;
    let gatewayError = null;
    let simulated = false;

    if (gateway.isConfigured() && !isGatewayCoolingDown(providerKey)) {
        try {
            gatewayResult = await gateway.createPayment({
                orderCode,
                amount,
                providerAmount,
                orderInfo,
                userId,
                ipAddr,
                bankCode,
                expiresAt,
                postId
            });
        } catch (error) {
            gatewayResult = { error: error.message || 'Không thể kết nối cổng thanh toán' };
        }
        if (gatewayResult?.error || !gatewayResult?.checkoutUrl) {
            gatewayError = gatewayResult?.error || 'Không thể khởi tạo phiên thanh toán';
            markGatewayCooldown(providerKey);
        } else {
            gatewayCooldownUntil.delete(providerKey);
        }
    }

    if ((!gatewayResult || gatewayResult.error || !gatewayResult.checkoutUrl) && simulatorEnabled()) {
        simulated = true;
        const postQuery = postId ? `&postId=${encodeURIComponent(postId)}` : '';
        gatewayResult = {
            checkoutUrl: `${getPaymentReturnUrl(providerKey)}&order=${encodeURIComponent(orderCode)}&simulate=1${postQuery}`,
            providerRef: `SIM_${providerKey}_${orderCode}`
        };
    }

    if (!gatewayResult || gatewayResult.error || !gatewayResult.checkoutUrl) {
        return {
            errCode: -1,
            errMessage: gatewayResult?.error || `Cổng thanh toán ${providerKey} chưa được cấu hình`
        };
    }

    const order = await db.PaymentOrder.create({
        orderCode,
        provider: providerKey,
        purpose: spec.purpose,
        userId: Number(userId),
        companyId: spec.companyId,
        itemCode: spec.itemCode,
        itemName: spec.itemName,
        quantity: spec.quantity,
        unitPrice: spec.unitPrice,
        originalAmount: spec.originalAmount,
        discountAmount: promo.discountAmount,
        amount,
        promoCode: promo.code,
        currency,
        providerAmount,
        points: spec.points,
        entitlementType: spec.entitlementType,
        entitlementAmount: spec.entitlementAmount,
        status: 'PENDING',
        providerRef: gatewayResult.providerRef || orderCode,
        simulated,
        expiresAt
    });

    return {
        errCode: 0,
        link: gatewayResult.checkoutUrl,
        data: {
            id: order.id,
            orderCode,
            provider: providerKey,
            purpose: spec.purpose,
            itemName: spec.itemName,
            originalAmount: spec.originalAmount,
            discountAmount: promo.discountAmount,
            discountVnd: promo.discountAmount,
            amount,
            finalAmountVnd: amount,
            currency,
            providerAmount,
            points: spec.points,
            pointsGranted: spec.points,
            entitlementType: spec.entitlementType,
            entitlementAmount: spec.entitlementAmount,
            checkoutUrl: gatewayResult.checkoutUrl,
            paymentUrl: gatewayResult.checkoutUrl,
            simulated,
            gatewayFallbackReason: simulated && gatewayError ? gatewayError : null,
            testCards: SANDBOX_TEST_CARDS[providerKey] || []
        }
    };
};

const settleOrderPaid = async (orderCode, { transId = null, postId = null } = {}) => {
    if (!orderCode) return { errCode: 1, errMessage: 'Thiếu mã đơn thanh toán' };

    const runTx = typeof db.sequelize?.transaction === 'function'
        ? (fn) => db.sequelize.transaction(fn)
        : (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } });

    return runTx(async (transaction) => {
        const order = await db.PaymentOrder.findOne({
            where: { orderCode: String(orderCode) },
            transaction,
            lock: transaction.LOCK?.UPDATE,
            raw: false
        });
        if (!order) return { errCode: 2, errMessage: 'Không tìm thấy đơn thanh toán' };
        if (order.status === 'PAID') {
            return { errCode: 0, alreadyProcessed: true, data: enrichOrderPayload(order, { postId }), errMessage: 'Giao dịch đã được ghi nhận trước đó' };
        }
        if (order.status !== 'PENDING' && order.status !== 'EXPIRED') {
            return { errCode: 2, errMessage: 'Đơn thanh toán không còn hiệu lực' };
        }

        if (order.purpose === 'POINT_TOPUP') {
            await rewardService.creditWallet({
                ownerType: rewardService.OWNER_CANDIDATE,
                ownerId: order.userId,
                amount: Number(order.points),
                reasonCode: 'POINT_TOPUP',
                description: `Nạp ${order.itemName} qua ${order.provider} (${order.orderCode})`,
                refType: 'PAYMENT_ORDER',
                refId: order.orderCode,
                idempotencyKey: `CANDIDATE:TOPUP:${order.orderCode}`
            }, transaction);
        } else if (order.purpose === 'PACKAGE_POST' || order.purpose === 'PACKAGE_CV') {
            const company = await db.Company.findOne({
                where: { id: Number(order.companyId) },
                transaction,
                lock: transaction.LOCK?.UPDATE,
                raw: false
            });
            if (!company) return { errCode: 2, errMessage: 'Không tìm thấy công ty nhận quyền lợi' };

            const allowanceField = ALLOWANCE_FIELDS[order.entitlementType];
            if (!allowanceField) return { errCode: 2, errMessage: 'Quyền lợi gói không hợp lệ' };

            company[allowanceField] = Number(company[allowanceField] || 0) + Number(order.entitlementAmount || 0);
            await company.save({ transaction, silent: true });

            let createdOrder = null;
            if (order.purpose === 'PACKAGE_POST' && db.OrderPackage?.create) {
                createdOrder = await db.OrderPackage.create({
                    packagePostId: Number(order.itemCode),
                    userId: Number(order.userId),
                    currentPrice: Number(order.unitPrice),
                    amount: Number(order.quantity)
                }, { transaction });
            } else if (order.purpose === 'PACKAGE_CV' && db.OrderPackageCV?.create) {
                createdOrder = await db.OrderPackageCV.create({
                    packageCvId: Number(order.itemCode),
                    userId: Number(order.userId),
                    currentPrice: Number(order.unitPrice),
                    amount: Number(order.quantity)
                }, { transaction });
            }

            const isPostOrder = order.purpose === 'PACKAGE_POST';
            const rewardSourceType = isPostOrder ? 'ORDER_POST' : 'ORDER_CV';
            const rewardSourceId = createdOrder?.id
                ? `HIST_${isPostOrder ? 'POST' : 'CV'}_${createdOrder.id}`
                : order.orderCode;
            await rewardService.awardEmployerPointsForPayment({
                companyId: company.id,
                vndAmount: Number(order.amount),
                sourceType: rewardSourceType,
                sourceId: rewardSourceId,
                description: `Tích Top Point khi mua ${order.itemName} qua ${order.provider}`
            }, transaction);
        }

        order.status = 'PAID';
        order.paidAt = new Date();
        if (transId) order.providerTransId = String(transId);
        await order.save({ transaction });

        return {
            errCode: 0,
            alreadyProcessed: false,
            data: enrichOrderPayload(order, { postId }),
            errMessage: 'Thanh toán thành công! Quyền lợi và điểm thưởng đã được cộng vào tài khoản'
        };
    }).then(async (result) => {
        if (result?.errCode === 0 && !result.alreadyProcessed) {
            const purpose = result.data?.purpose;
            if (purpose === 'PACKAGE_POST' || purpose === 'PACKAGE_CV') {
                try {
                    await emitDashboardChanged(
                        purpose === 'PACKAGE_POST' ? 'payment-post' : 'payment-cv',
                        { userId: Number(result.data.userId || 0) }
                    );
                } catch (err) {
                    // Khong chan luong thanh toan khi socket dashboard ban.
                }
            }
        }
        return result;
    });
};

const markOrderFailed = async (orderCode, reason, status = 'FAILED') => {
    const order = await db.PaymentOrder.findOne({ where: { orderCode: String(orderCode) }, raw: false });
    if (!order || order.status === 'PAID') return order;
    order.status = status;
    order.failureReason = String(reason || 'Giao dịch không thành công').slice(0, 250);
    await order.save();
    return order;
};

// ===== IPN / CALLBACK SERVER-TO-SERVER =====
const handleVnpayIpn = async (query = {}) => {
    const verified = gateways.VNPAY.verifyCallback(query);
    if (!verified.valid) return { RspCode: '97', Message: 'Invalid Checksum' };
    const order = await db.PaymentOrder.findOne({ where: { orderCode: verified.orderCode }, raw: false });
    if (!order) return { RspCode: '01', Message: 'Order Not Found' };
    if (Number(order.amount) !== Number(verified.amount)) return { RspCode: '04', Message: 'Invalid Amount' };
    if (order.status === 'PAID') return { RspCode: '02', Message: 'Order already confirmed' };

    if (verified.success) {
        await settleOrderPaid(order.orderCode, { transId: verified.transId });
    } else {
        await markOrderFailed(order.orderCode, verified.message);
    }
    return { RspCode: '00', Message: 'Confirm Success' };
};

const handleMomoIpn = async (body = {}) => {
    const verified = gateways.MOMO.verifyCallback(body);
    if (!verified.valid) return { httpStatus: 400, body: { resultCode: 97, message: 'Invalid signature' } };
    const order = await db.PaymentOrder.findOne({ where: { orderCode: verified.orderCode }, raw: false });
    if (!order) return { httpStatus: 404, body: { resultCode: 1, message: 'Order not found' } };
    if (Number(order.amount) !== Number(verified.amount)) {
        return { httpStatus: 400, body: { resultCode: 4, message: 'Amount mismatch' } };
    }
    if (verified.success) {
        await settleOrderPaid(order.orderCode, { transId: verified.transId });
    } else {
        await markOrderFailed(order.orderCode, verified.message);
    }
    return { httpStatus: 200, body: { resultCode: 0, message: 'OK' } };
};

const handleZaloPayCallback = async (body = {}) => {
    const verified = gateways.ZALOPAY.verifyCallback(body);
    if (!verified.valid) return { return_code: -1, return_message: 'mac not equal' };
    const order = await db.PaymentOrder.findOne({ where: { orderCode: verified.orderCode }, raw: false });
    if (!order) return { return_code: 2, return_message: 'order not found' };
    if (Number(order.amount) !== Number(verified.amount)) return { return_code: 2, return_message: 'amount mismatch' };
    await settleOrderPaid(order.orderCode, { transId: verified.transId });
    return { return_code: 1, return_message: 'OK' };
};

// ===== XAC MINH KET QUA KHI TRINH DUYET QUAY VE (RETURN URL) =====
const verifyPaymentReturn = async ({ userId, roleCode = null, companyId = null, provider, params = {} }) => {
    const providerKey = normalizeProvider(provider || params.provider);
    const extractedOrderCode = params.order
        || params.orderCode
        || params.vnp_TxnRef
        || params.orderId
        || (params.apptransid ? gateways.ZALOPAY.orderCodeFromAppTransId(params.apptransid) : '');

    if (!userId || !extractedOrderCode) {
        return { errCode: 1, errMessage: 'Thiếu thông tin giao dịch thanh toán' };
    }

    const order = await db.PaymentOrder.findOne({
        where: { orderCode: String(extractedOrderCode) },
        raw: false
    });
    if (!order || Number(order.userId) !== Number(userId)) {
        return { errCode: 2, errMessage: 'Giao dịch không tồn tại hoặc không thuộc tài khoản này' };
    }

    if (roleCode) {
        if (order.purpose === 'POINT_TOPUP' && roleCode !== 'CANDIDATE') {
            return { errCode: 3, errMessage: 'Giao dịch nạp điểm chỉ thuộc quyền tài khoản Ứng viên' };
        }
        if (
            (order.purpose === 'PACKAGE_POST' || order.purpose === 'PACKAGE_CV')
            && (roleCode !== 'COMPANY' || Number(companyId) !== Number(order.companyId))
        ) {
            return { errCode: 3, errMessage: 'Tài khoản không có quyền xác nhận đơn hàng doanh nghiệp này' };
        }
    }

    if (order.status === 'PAID') {
        return { errCode: 0, alreadyProcessed: true, data: enrichOrderPayload(order, { postId: params.postId }), errMessage: 'Giao dịch đã hoàn tất' };
    }

    // Che do gia lap (local dev sandbox)
    if (order.simulated && simulatorEnabled()) {
        if (String(params.simulateAction || '').toLowerCase() === 'cancel' || String(params.cancel || '') === '1') {
            const cancelled = await markOrderFailed(order.orderCode, 'Người dùng hủy giao dịch thanh toán', 'CANCELLED');
            return { errCode: 2, data: enrichOrderPayload(cancelled, { postId: params.postId }), errMessage: 'Bạn đã hủy giao dịch thanh toán' };
        }
        if (String(params.simulateAction || '').toLowerCase() === 'confirm') {
            const cardCheck = evaluateSimulatedCard(order.provider, params.simulateCardNumber, params.simulateOtp);
            if (!cardCheck.ok) {
                return {
                    errCode: 2,
                    requireSimulationAction: true,
                    data: enrichOrderPayload(order, { requireSimulationAction: true, postId: params.postId }),
                    errMessage: cardCheck.reason
                };
            }
            return settleOrderPaid(order.orderCode, { transId: `SIM_TX_${Date.now()}`, postId: params.postId });
        }
        return {
            errCode: 0,
            requireSimulationAction: true,
            data: enrichOrderPayload(order, { requireSimulationAction: true, postId: params.postId }),
            errMessage: 'Vui lòng nhập thông tin thẻ và xác thực OTP để hoàn tất thanh toán.'
        };
    }

    const activeProvider = providerKey || order.provider;
    if (activeProvider === 'VNPAY' && params.vnp_SecureHash) {
        const verified = gateways.VNPAY.verifyCallback(params);
        if (!verified.valid || Number(verified.amount) !== Number(order.amount)) {
            return { errCode: 2, data: enrichOrderPayload(order, { postId: params.postId }), errMessage: 'Chữ ký phản hồi VNPAY không hợp lệ' };
        }
        if (!verified.success) {
            const failed = await markOrderFailed(order.orderCode, verified.message, 'CANCELLED');
            return { errCode: 2, data: enrichOrderPayload(failed, { postId: params.postId }), errMessage: verified.message };
        }
        return settleOrderPaid(order.orderCode, { transId: verified.transId, postId: params.postId });
    }

    if (activeProvider === 'MOMO' && params.signature) {
        const verified = gateways.MOMO.verifyCallback(params);
        if (!verified.valid || Number(verified.amount) !== Number(order.amount)) {
            return { errCode: 2, data: enrichOrderPayload(order, { postId: params.postId }), errMessage: 'Chữ ký phản hồi MoMo không hợp lệ' };
        }
        if (!verified.success) {
            const failed = await markOrderFailed(order.orderCode, verified.message, 'CANCELLED');
            return { errCode: 2, data: enrichOrderPayload(failed, { postId: params.postId }), errMessage: verified.message };
        }
        return settleOrderPaid(order.orderCode, { transId: verified.transId, postId: params.postId });
    }

    if (activeProvider === 'ZALOPAY') {
        if (params.checksum && gateways.ZALOPAY.isConfigured()) {
            const redirectVerified = gateways.ZALOPAY.verifyRedirect(params);
            if (!redirectVerified.valid) {
                return { errCode: 2, data: enrichOrderPayload(order, { postId: params.postId }), errMessage: 'Chữ ký phản hồi ZaloPay không hợp lệ' };
            }
            if (redirectVerified.cancelled) {
                const failed = await markOrderFailed(order.orderCode, redirectVerified.message, 'CANCELLED');
                return { errCode: 2, data: enrichOrderPayload(failed, { postId: params.postId }), errMessage: redirectVerified.message };
            }
            if (redirectVerified.success && Number(redirectVerified.amount) === Number(order.amount)) {
                return settleOrderPaid(order.orderCode, {
                    transId: params.apptransid || order.providerRef,
                    postId: params.postId
                });
            }
        }
        const rawStatus = params.status !== undefined && params.status !== '' ? Number(params.status) : null;
        if (String(params.cancel || '') === '1' || (Number.isFinite(rawStatus) && rawStatus < 0)) {
            const failed = await markOrderFailed(order.orderCode, 'Người dùng hủy thanh toán ZaloPay', 'CANCELLED');
            return { errCode: 2, data: enrichOrderPayload(failed, { postId: params.postId }), errMessage: 'Bạn đã hủy thanh toán ZaloPay' };
        }
        if (gateways.ZALOPAY.isConfigured() && order.providerRef) {
            const queried = await gateways.ZALOPAY.queryStatus(order.providerRef);
            if (queried.state === 'PAID') {
                return settleOrderPaid(order.orderCode, { transId: queried.transId, postId: params.postId });
            }
            if (queried.state === 'FAILED') {
                const failed = await markOrderFailed(order.orderCode, queried.message || 'ZaloPay báo giao dịch thất bại');
                return { errCode: 2, data: enrichOrderPayload(failed, { postId: params.postId }), errMessage: queried.message || 'Giao dịch ZaloPay không thành công' };
            }
        }
    }

    if (activeProvider === 'PAYPAL') {
        if (String(params.cancel || '') === '1') {
            const failed = await markOrderFailed(order.orderCode, 'Người dùng hủy thanh toán PayPal', 'CANCELLED');
            return { errCode: 2, data: enrichOrderPayload(failed, { postId: params.postId }), errMessage: 'Bạn đã hủy thanh toán PayPal' };
        }
        const payerId = params.PayerID || params.payerId;
        if (!payerId) return { errCode: 1, data: enrichOrderPayload(order, { postId: params.postId }), errMessage: 'Thiếu PayerID từ PayPal' };
        const executed = await gateways.PAYPAL.executePayment(order, payerId);
        if (!executed.success) {
            return { errCode: 2, data: enrichOrderPayload(order, { postId: params.postId }), errMessage: executed.message || 'PayPal chưa xác nhận giao dịch' };
        }
        return settleOrderPaid(order.orderCode, { transId: executed.transId, postId: params.postId });
    }

    return {
        errCode: 0,
        data: enrichOrderPayload(order, { postId: params.postId }),
        errMessage: order.status === 'PENDING' ? 'Đang chờ xác nhận từ cổng thanh toán' : 'Đã cập nhật trạng thái đơn hàng'
    };
};

const getUserPaymentOrders = async ({
    userId,
    companyId,
    all = false,
    purpose = '',
    status = '',
    limit = 20,
    offset = 0
}) => {
    if (!all && !userId && !companyId) return { errCode: 1, errMessage: 'Missing required parameters !' };
    const where = {};
    if (!all) {
        if (companyId) where.companyId = Number(companyId);
        else where.userId = Number(userId);
    } else if (companyId) {
        where.companyId = Number(companyId);
    } else if (userId) {
        where.userId = Number(userId);
    }
    const normalizedPurpose = String(purpose || '').trim().toUpperCase();
    if (normalizedPurpose && ['POINT_TOPUP', 'PACKAGE_POST', 'PACKAGE_CV'].includes(normalizedPurpose)) {
        where.purpose = normalizedPurpose;
    }
    const normalizedStatus = String(status || '').trim().toUpperCase();
    if (normalizedStatus && ['PAID', 'PENDING', 'FAILED', 'CANCELLED'].includes(normalizedStatus)) {
        where.status = normalizedStatus;
    }
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const result = await db.PaymentOrder.findAndCountAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'DESC']],
        limit: safeLimit,
        offset: safeOffset
    });
    return { errCode: 0, data: result.rows, count: result.count };
};

module.exports = {
    evaluatePromo,
    getPaymentCatalog,
    createCheckout,
    settleOrderPaid,
    markOrderFailed,
    handleVnpayIpn,
    handleMomoIpn,
    handleZaloPayCallback,
    verifyPaymentReturn,
    getUserPaymentOrders
};
