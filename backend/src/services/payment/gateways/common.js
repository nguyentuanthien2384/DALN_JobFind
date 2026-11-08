// Tien ich chung cho cac cong thanh toan.
const crypto = require('crypto');
const { getFrontendUrl } = require('../../../utils/frontendUrl');

const hmacHex = (algorithm, key, data) => crypto.createHmac(algorithm, String(key)).update(Buffer.from(String(data), 'utf-8')).digest('hex');

// So sanh chu ky trong thoi gian hang so (tranh do chu ky bang thoi gian phan hoi).
const safeEqual = (left, right) => {
    const a = Buffer.from(String(left || ''), 'utf-8');
    const b = Buffer.from(String(right || ''), 'utf-8');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Dia chi cong khai ma cong thanh toan goi IPN/callback (thuong la API Gateway :4000
// hoac ten mien that). Cong thanh toan KHONG goi duoc localhost: khi chay o may ca nhan,
// ket qua van duoc ghi nhan qua buoc xac minh luc nguoi dung quay ve (return URL).
const getPublicBackendUrl = () => String(process.env.PAYMENT_PUBLIC_BACKEND_URL
    || process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, '');

const getPaymentReturnUrl = (provider) => `${getFrontendUrl()}/payment/result?provider=${provider.toLowerCase()}`;

// Gio Viet Nam (GMT+7) dang yyyyMMddHHmmss ma khong phu thuoc mui gio cua may chu.
const vnTimestamp = (date = new Date()) => {
    const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, '0');
    return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}`
        + `${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}${pad(shifted.getUTCSeconds())}`;
};

const resolveGatewayTimeoutMs = (explicit) => {
    const parsed = Number(explicit ?? process.env.PAYMENT_GATEWAY_TIMEOUT_MS ?? 5000);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
};

const normalizeGatewayNetworkError = (error) => {
    const code = String(error?.cause?.code || error?.code || '');
    const name = String(error?.name || '');
    const msg = String(error?.message || '');
    if (
        name === 'TimeoutError'
        || name === 'AbortError'
        || code === 'UND_ERR_CONNECT_TIMEOUT'
        || code === 'ETIMEDOUT'
    ) {
        return new Error('Máy chủ cổng thanh toán phản hồi quá thời gian chờ (tạm bảo trì hoặc gián đoạn kết nối).');
    }
    if (msg === 'fetch failed' || code.startsWith('UND_ERR_') || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
        return new Error('Không thể kết nối tới máy chủ cổng thanh toán bên ngoài.');
    }
    return error;
};

const postJson = async (url, body, { timeoutMs } = {}) => {
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(resolveGatewayTimeoutMs(timeoutMs))
        });
    } catch (error) {
        throw normalizeGatewayNetworkError(error);
    }
    const text = await response.text();
    try { return JSON.parse(text); } catch (error) { return { raw: text, httpStatus: response.status }; }
};

const postForm = async (url, form, { timeoutMs } = {}) => {
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(form).toString(),
            signal: AbortSignal.timeout(resolveGatewayTimeoutMs(timeoutMs))
        });
    } catch (error) {
        throw normalizeGatewayNetworkError(error);
    }
    const text = await response.text();
    try { return JSON.parse(text); } catch (error) { return { raw: text, httpStatus: response.status }; }
};

module.exports = { hmacHex, safeEqual, getPublicBackendUrl, getPaymentReturnUrl, vnTimestamp, postJson, postForm };
