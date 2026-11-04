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

const postJson = async (url, body, { timeoutMs = 20000 } = {}) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    try { return JSON.parse(text); } catch (error) { return { raw: text, httpStatus: response.status }; }
};

const postForm = async (url, form, { timeoutMs = 20000 } = {}) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    try { return JSON.parse(text); } catch (error) { return { raw: text, httpStatus: response.status }; }
};

module.exports = { hmacHex, safeEqual, getPublicBackendUrl, getPaymentReturnUrl, vnTimestamp, postJson, postForm };
