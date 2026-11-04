// ===== MOMO (API v2 captureWallet, sandbox mac dinh) =====
// Tham khao Class-Payment-MOMO: chuoi ky HMAC-SHA256 phai dung DUNG thu tu khoa theo tai lieu MoMo.
const { hmacHex, safeEqual, getPublicBackendUrl, getPaymentReturnUrl, postJson } = require('./common');

const config = () => ({
    partnerCode: process.env.MOMO_PARTNER_CODE || '',
    accessKey: process.env.MOMO_ACCESS_KEY || '',
    secretKey: process.env.MOMO_SECRET_KEY || '',
    endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create',
    requestType: process.env.MOMO_REQUEST_TYPE || 'captureWallet',
    redirectUrl: process.env.MOMO_RETURN_URL || getPaymentReturnUrl('MOMO'),
    ipnUrl: process.env.MOMO_IPN_URL || `${getPublicBackendUrl()}/api/payments/momo/ipn`
});

const isConfigured = () => Boolean(config().partnerCode && config().accessKey && config().secretKey);

const createSignatureRaw = (p) => `accessKey=${p.accessKey}&amount=${p.amount}&extraData=${p.extraData}`
    + `&ipnUrl=${p.ipnUrl}&orderId=${p.orderId}&orderInfo=${p.orderInfo}&partnerCode=${p.partnerCode}`
    + `&redirectUrl=${p.redirectUrl}&requestId=${p.requestId}&requestType=${p.requestType}`;

// Chuoi ky cho ket qua (IPN va redirect cung dinh dang).
const resultSignatureRaw = (accessKey, b) => `accessKey=${accessKey}&amount=${b.amount ?? ''}&extraData=${b.extraData ?? ''}`
    + `&message=${b.message ?? ''}&orderId=${b.orderId ?? ''}&orderInfo=${b.orderInfo ?? ''}`
    + `&orderType=${b.orderType ?? ''}&partnerCode=${b.partnerCode ?? ''}&payType=${b.payType ?? ''}`
    + `&requestId=${b.requestId ?? ''}&responseTime=${b.responseTime ?? ''}&resultCode=${b.resultCode ?? ''}`
    + `&transId=${b.transId ?? ''}`;

const createPayment = async ({ orderCode, amount, orderInfo }) => {
    const cfg = config();
    const payload = {
        partnerCode: cfg.partnerCode,
        accessKey: cfg.accessKey,
        requestId: `${orderCode}-${Date.now()}`,
        amount: String(Math.round(Number(amount))),
        orderId: orderCode,
        orderInfo,
        redirectUrl: cfg.redirectUrl,
        ipnUrl: cfg.ipnUrl,
        extraData: '',
        requestType: cfg.requestType
    };
    const signature = hmacHex('sha256', cfg.secretKey, createSignatureRaw(payload));
    const data = await postJson(cfg.endpoint, { ...payload, signature, lang: 'vi' });
    if (Number(data?.resultCode) !== 0 || !data?.payUrl) {
        return { error: data?.message || 'MoMo từ chối tạo giao dịch' };
    }
    return { checkoutUrl: data.payUrl, providerRef: payload.requestId, deeplink: data.deeplink, qrCodeUrl: data.qrCodeUrl };
};

const verifyCallback = (body = {}) => {
    const cfg = config();
    const expected = hmacHex('sha256', cfg.secretKey, resultSignatureRaw(cfg.accessKey, body));
    const valid = isConfigured() && String(body.partnerCode || '') === cfg.partnerCode && safeEqual(expected, body.signature);
    const resultCode = Number(body.resultCode);
    return {
        valid,
        success: resultCode === 0 || resultCode === 9000,
        orderCode: String(body.orderId || ''),
        amount: Math.round(Number(body.amount || 0)),
        transId: body.transId ? String(body.transId) : null,
        message: body.message || (resultCode === 1006 ? 'Bạn đã hủy giao dịch' : `Mã lỗi MoMo ${body.resultCode}`)
    };
};

module.exports = { name: 'MOMO', isConfigured, createPayment, verifyCallback, createSignatureRaw, resultSignatureRaw };
