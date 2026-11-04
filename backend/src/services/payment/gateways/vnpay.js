// ===== VNPAY (API v2.1.0, sandbox mac dinh) =====
// Tham khao Class-Payment-VNPAY: sap xep tham so theo ten, ma hoa gia tri bang
// encodeURIComponent roi doi %20 thanh '+', ky HMAC-SHA512 tren chuoi do.
const { hmacHex, safeEqual, getPaymentReturnUrl, vnTimestamp } = require('./common');

const config = () => ({
    tmnCode: process.env.VNP_TMN_CODE || '',
    hashSecret: process.env.VNP_HASH_SECRET || '',
    payUrl: process.env.VNP_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    returnUrl: process.env.VNP_RETURN_URL || getPaymentReturnUrl('VNPAY')
});

const isConfigured = () => Boolean(config().tmnCode && config().hashSecret);

const encodeValue = (value) => encodeURIComponent(value === undefined || value === null ? '' : String(value)).replace(/%20/g, '+');

const signData = (params) => Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${encodeValue(params[key])}`)
    .join('&');

const sign = (params, secret = config().hashSecret) => hmacHex('sha512', secret, signData(params));

const normalizeIp = (rawIp) => {
    let ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp || '127.0.0.1');
    ip = ip.split(',')[0].trim();
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    if (!ip || ip === '::1') ip = '127.0.0.1';
    return ip;
};

const createPayment = async ({ orderCode, amount, orderInfo, ipAddr, bankCode, locale = 'vn', expiresAt }) => {
    const { tmnCode, payUrl, returnUrl } = config();
    const params = {
        vnp_Version: '2.1.0',
        vnp_Command: 'pay',
        vnp_TmnCode: tmnCode,
        vnp_Locale: locale,
        vnp_CurrCode: 'VND',
        vnp_TxnRef: orderCode,
        vnp_OrderInfo: orderInfo,
        vnp_OrderType: 'other',
        vnp_Amount: String(Math.round(Number(amount)) * 100), // VNPAY nhan so tien x100
        vnp_ReturnUrl: returnUrl,
        vnp_IpAddr: normalizeIp(ipAddr),
        vnp_CreateDate: vnTimestamp(),
        ...(expiresAt ? { vnp_ExpireDate: vnTimestamp(new Date(expiresAt)) } : {}),
        ...(bankCode ? { vnp_BankCode: String(bankCode).toUpperCase() } : {})
    };
    const query = signData(params);
    return { checkoutUrl: `${payUrl}?${query}&vnp_SecureHash=${sign(params)}`, providerRef: orderCode };
};

// Dung chung cho return URL va IPN: hai noi deu nhan cung bo tham so vnp_*.
const verifyCallback = (query = {}) => {
    const params = {};
    Object.keys(query).forEach((key) => {
        if (key.startsWith('vnp_') && key !== 'vnp_SecureHash' && key !== 'vnp_SecureHashType') params[key] = query[key];
    });
    const valid = isConfigured() && safeEqual(sign(params).toLowerCase(), String(query.vnp_SecureHash || '').toLowerCase());
    const responseCode = String(query.vnp_ResponseCode || '');
    const transactionStatus = String(query.vnp_TransactionStatus || responseCode);
    return {
        valid,
        success: responseCode === '00' && transactionStatus === '00',
        orderCode: String(query.vnp_TxnRef || ''),
        amount: Math.round(Number(query.vnp_Amount || 0) / 100),
        transId: query.vnp_TransactionNo ? String(query.vnp_TransactionNo) : null,
        message: responseCode === '24' ? 'Bạn đã hủy giao dịch' : (responseCode === '00' ? 'Thành công' : `Mã lỗi VNPAY ${responseCode}`)
    };
};

module.exports = { name: 'VNPAY', isConfigured, createPayment, verifyCallback, sign, signData, normalizeIp };
