// ===== MOMO (API v2 payWithMethod / captureWallet, sandbox mac dinh) =====
// Mac dinh dung requestType = 'payWithMethod' de cho phep nhap the ATM NAPAS / Visa dung thu
// ngay tren trinh duyet (khong bat buoc cai app MoMo Test tren dien thoai).
const {
    hmacHex,
    safeEqual,
    getPublicBackendUrl,
    getPaymentReturnUrl,
    parseBooleanEnv,
    simulatorEnabled,
    postJson
} = require('./common');

// Khoa demo cong khai cu cua MoMo (test-payment.momo.vn) hien bi chan 403 Forbidden
// tren trinh duyet khi mo payUrl. Khi bat PAYMENT_SIMULATOR, he thong tu dong dung
// cong nhap the & OTP tich hop san (giong VNPAY) tru khi khai bao khoa merchant rieng
// hoac bat MOMO_FORCE_EXTERNAL_SANDBOX=true.
const RETIRED_PUBLIC_DEMO_ACCESS_KEYS = new Set(['F8BBA842ECF85']);
const RETIRED_PUBLIC_DEMO_SECRET_KEYS = new Set(['K951B6PE1waDMi640xX08PD3vg6EkVlz']);

const config = (customReturnUrl) => ({
    partnerCode: String(process.env.MOMO_PARTNER_CODE || '').trim(),
    accessKey: String(process.env.MOMO_ACCESS_KEY || '').trim(),
    secretKey: String(process.env.MOMO_SECRET_KEY || '').trim(),
    endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create',
    requestType: process.env.MOMO_REQUEST_TYPE || 'payWithMethod',
    redirectUrl: process.env.MOMO_RETURN_URL || getPaymentReturnUrl('MOMO', customReturnUrl),
    ipnUrl: process.env.MOMO_IPN_URL || `${getPublicBackendUrl()}/api/payments/momo/ipn`
});

const isPublicDemoConfig = (cfg) => (
    RETIRED_PUBLIC_DEMO_ACCESS_KEYS.has(cfg.accessKey)
    || RETIRED_PUBLIC_DEMO_SECRET_KEYS.has(cfg.secretKey)
);

const isConfigured = () => {
    const cfg = config();
    if (!cfg.partnerCode || !cfg.accessKey || !cfg.secretKey) return false;
    return !(
        isPublicDemoConfig(cfg)
        && simulatorEnabled()
        && parseBooleanEnv(process.env.MOMO_FORCE_EXTERNAL_SANDBOX) !== true
    );
};

const createSignatureRaw = (p) => `accessKey=${p.accessKey}&amount=${p.amount}&extraData=${p.extraData}`
    + `&ipnUrl=${p.ipnUrl}&orderId=${p.orderId}&orderInfo=${p.orderInfo}&partnerCode=${p.partnerCode}`
    + `&redirectUrl=${p.redirectUrl}&requestId=${p.requestId}&requestType=${p.requestType}`;

// Chuoi ky cho ket qua (IPN va redirect cung dinh dang).
const resultSignatureRaw = (accessKey, b) => `accessKey=${accessKey}&amount=${b.amount ?? ''}&extraData=${b.extraData ?? ''}`
    + `&message=${b.message ?? ''}&orderId=${b.orderId ?? ''}&orderInfo=${b.orderInfo ?? ''}`
    + `&orderType=${b.orderType ?? ''}&partnerCode=${b.partnerCode ?? ''}&payType=${b.payType ?? ''}`
    + `&requestId=${b.requestId ?? ''}&responseTime=${b.responseTime ?? ''}&resultCode=${b.resultCode ?? ''}`
    + `&transId=${b.transId ?? ''}`;

const createPayment = async ({ orderCode, amount, orderInfo, postId, returnUrl }) => {
    const cfg = config(returnUrl);
    let redirectUrl = cfg.redirectUrl;
    if (!process.env.MOMO_RETURN_URL) {
        redirectUrl += `${redirectUrl.includes('?') ? '&' : '?'}order=${encodeURIComponent(orderCode)}`;
        if (postId) redirectUrl += `&postId=${encodeURIComponent(postId)}`;
    }
    const payload = {
        partnerCode: cfg.partnerCode,
        accessKey: cfg.accessKey,
        requestId: `${orderCode}-${Date.now()}`,
        amount: String(Math.round(Number(amount))),
        orderId: orderCode,
        orderInfo,
        redirectUrl,
        ipnUrl: cfg.ipnUrl,
        extraData: '',
        requestType: cfg.requestType
    };
    const signature = hmacHex('sha256', cfg.secretKey, createSignatureRaw(payload));
    const data = await postJson(cfg.endpoint, {
        ...payload,
        partnerName: 'JobFind',
        storeId: 'JobFindStore',
        autoCapture: true,
        orderGroupId: '',
        signature,
        lang: 'vi'
    });
    if (Number(data?.resultCode) !== 0 || !data?.payUrl) {
        const statusHint = data?.httpStatus ? ` (HTTP ${data.httpStatus})` : '';
        return { error: data?.message || `MoMo từ chối hoặc tạm gián đoạn kết nối Sandbox${statusHint}` };
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
