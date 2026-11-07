// ===== ZALOPAY (API v2, sandbox mac dinh) =====
// Tham khao Class-Payment-ZaloPay: mac tao don = HMAC-SHA256(key1, app_id|app_trans_id|app_user|amount|app_time|embed_data|item),
// callback ky bang key2 tren chuoi `data`. redirecturl phai nam trong embed_data.
const { hmacHex, safeEqual, getPublicBackendUrl, getPaymentReturnUrl, vnTimestamp, postJson, postForm } = require('./common');

const parsePreferredMethods = (raw) => {
    const text = String(raw ?? 'domestic_card,account').trim();
    if (!text || text.toLowerCase() === 'all' || text === '[]') return [];
    if (text.toLowerCase() === 'none') return null;
    return text.split(',').map((item) => item.trim()).filter(Boolean);
};

const config = () => ({
    appId: String(process.env.ZALOPAY_APP_ID || '').trim(),
    key1: String(process.env.ZALOPAY_KEY1 || '').trim(),
    key2: String(process.env.ZALOPAY_KEY2 || '').trim(),
    createUrl: process.env.ZALOPAY_CREATE_URL || 'https://sb-openapi.zalopay.vn/v2/create',
    queryUrl: process.env.ZALOPAY_QUERY_URL || 'https://sb-openapi.zalopay.vn/v2/query',
    callbackUrl: process.env.ZALOPAY_CALLBACK_URL || `${getPublicBackendUrl()}/api/payments/zalopay/callback`,
    redirectUrl: process.env.ZALOPAY_RETURN_URL || getPaymentReturnUrl('ZALOPAY'),
    bankCode: process.env.ZALOPAY_BANK_CODE ?? '',
    preferredMethods: parsePreferredMethods(process.env.ZALOPAY_PREFERRED_METHODS)
});

const isConfigured = () => Boolean(config().appId && config().key1 && config().key2);

// app_trans_id bat buoc dang yyMMdd_xxx theo gio Viet Nam.
const buildAppTransId = (orderCode, date = new Date()) => `${vnTimestamp(date).slice(2, 8)}_${orderCode}`;
const orderCodeFromAppTransId = (appTransId) => String(appTransId || '').split('_').slice(1).join('_');

const createPayment = async ({ orderCode, amount, orderInfo, userId, bankCode, postId }) => {
    const cfg = config();
    const appTime = Date.now();
    const appTransId = buildAppTransId(orderCode);
    let returnUrl = cfg.redirectUrl;
    if (!process.env.ZALOPAY_RETURN_URL) {
        returnUrl += `${returnUrl.includes('?') ? '&' : '?'}order=${encodeURIComponent(orderCode)}`;
        if (postId) returnUrl += `&postId=${encodeURIComponent(postId)}`;
    }
    const embedPayload = { redirecturl: returnUrl, orderCode };
    if (Array.isArray(cfg.preferredMethods)) {
        embedPayload.preferred_payment_method = cfg.preferredMethods;
    }
    const embedData = JSON.stringify(embedPayload);
    const item = JSON.stringify([]);
    const appUser = `jobfind_${userId}`;
    const roundedAmount = Math.round(Number(amount));
    const mac = hmacHex('sha256', cfg.key1, `${cfg.appId}|${appTransId}|${appUser}|${roundedAmount}|${appTime}|${embedData}|${item}`);
    const data = await postJson(cfg.createUrl, {
        app_id: Number(cfg.appId),
        app_trans_id: appTransId,
        app_user: appUser,
        app_time: appTime,
        amount: roundedAmount,
        embed_data: embedData,
        item,
        description: orderInfo,
        bank_code: bankCode !== undefined && bankCode !== null ? String(bankCode) : cfg.bankCode,
        callback_url: cfg.callbackUrl,
        mac
    });
    if (Number(data?.return_code) !== 1 || !data?.order_url) {
        return { error: data?.sub_return_message || data?.return_message || 'ZaloPay từ chối tạo giao dịch' };
    }
    return { checkoutUrl: data.order_url, providerRef: appTransId };
};

// Xac minh chu ky checksum tren query string khi ZaloPay redirect trinh duyet ve website:
// checksum = HMAC-SHA256(key2, appid|apptransid|pmcid|bankcode|amount|discountamount|status)
const verifyRedirect = (query = {}) => {
    const cfg = config();
    const raw = `${query.appid ?? ''}|${query.apptransid ?? ''}|${query.pmcid ?? ''}|${query.bankcode ?? ''}`
        + `|${query.amount ?? ''}|${query.discountamount ?? ''}|${query.status ?? ''}`;
    const valid = isConfigured()
        && String(query.appid || '') === String(cfg.appId)
        && safeEqual(hmacHex('sha256', cfg.key2, raw), String(query.checksum || ''));
    const status = Number(query.status);
    return {
        valid,
        success: valid && status === 1,
        cancelled: status === -49 || status < 0,
        status,
        orderCode: orderCodeFromAppTransId(query.apptransid),
        amount: Math.round(Number(query.amount || 0)),
        message: status === 1
            ? 'Thành công'
            : (status === -49 ? 'Bạn đã hủy thanh toán ZaloPay' : `Giao dịch ZaloPay không thành công (mã ${query.status})`)
    };
};

// Callback server-to-server: { data, mac, type }.
const verifyCallback = (body = {}) => {
    const cfg = config();
    const valid = isConfigured() && safeEqual(hmacHex('sha256', cfg.key2, body.data || ''), body.mac);
    let parsed = {};
    try { parsed = JSON.parse(body.data || '{}'); } catch (error) { parsed = {}; }
    return {
        valid,
        success: valid, // ZaloPay chi goi callback khi giao dich thanh cong
        orderCode: orderCodeFromAppTransId(parsed.app_trans_id),
        amount: Math.round(Number(parsed.amount || 0)),
        transId: parsed.zp_trans_id ? String(parsed.zp_trans_id) : null,
        message: valid ? 'Thành công' : 'Sai chữ ký ZaloPay'
    };
};

// Hoi trang thai truc tiep ZaloPay (dung khi nguoi dung quay ve tu trang thanh toan).
// return_code: 1 = thanh cong, 2 = that bai, 3 = dang xu ly.
const queryStatus = async (appTransId) => {
    const cfg = config();
    const mac = hmacHex('sha256', cfg.key1, `${cfg.appId}|${appTransId}|${cfg.key1}`);
    const data = await postForm(cfg.queryUrl, { app_id: cfg.appId, app_trans_id: appTransId, mac });
    const code = Number(data?.return_code);
    return {
        state: code === 1 ? 'PAID' : code === 2 ? 'FAILED' : 'PENDING',
        amount: Math.round(Number(data?.amount || 0)),
        transId: data?.zp_trans_id ? String(data.zp_trans_id) : null,
        message: data?.return_message || data?.sub_return_message || ''
    };
};

module.exports = {
    name: 'ZALOPAY',
    isConfigured,
    createPayment,
    verifyCallback,
    verifyRedirect,
    queryStatus,
    buildAppTransId,
    orderCodeFromAppTransId
};
