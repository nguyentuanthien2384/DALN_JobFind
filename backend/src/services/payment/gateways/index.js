const vnpay = require('./vnpay');
const momo = require('./momo');
const zalopay = require('./zalopay');
const paypal = require('./paypal');

const gateways = { VNPAY: vnpay, MOMO: momo, ZALOPAY: zalopay, PAYPAL: paypal };

const PROVIDER_INFO = Object.freeze({
    VNPAY: { label: 'Cổng thanh toán VNPAY', description: 'Quét mã VNPAY-QR, thẻ ATM nội địa, Visa/Master', tags: 'QR / ATM / Visa' },
    MOMO: { label: 'Ví điện tử MoMo', description: 'Thanh toán siêu tốc 1 chạm qua ứng dụng MoMo', tags: 'Ví MoMo' },
    ZALOPAY: { label: 'Ví ZaloPay', description: 'Thanh toán qua ứng dụng ZaloPay hoặc thẻ ngân hàng', tags: 'Ví / Thẻ' },
    PAYPAL: { label: 'PayPal', description: 'Thanh toán quốc tế bằng tài khoản PayPal (quy đổi USD)', tags: 'USD' }
});

// Che do gia lap cho moi truong dev khi chua dien khoa sandbox: mac dinh bat khi
// NODE_ENV !== 'production' (co the tat bang PAYMENT_SIMULATOR=false), va luon tat
// tren production. Khi da dien khoa that/sandbox, he thong luon goi cong thanh toan that.
const simulatorEnabled = () => process.env.NODE_ENV !== 'production'
    && process.env.PAYMENT_SIMULATOR !== 'false';

const normalizeProvider = (value) => {
    const key = String(value || '').trim().toUpperCase();
    return gateways[key] ? key : null;
};

const providerStatus = (key) => {
    const configured = gateways[key].isConfigured();
    return { code: key, ...PROVIDER_INFO[key], configured, simulated: !configured && simulatorEnabled(), enabled: configured || simulatorEnabled() };
};

const listProviders = () => Object.keys(gateways).map(providerStatus);

module.exports = { gateways, normalizeProvider, providerStatus, listProviders, simulatorEnabled };
