const vnpay = require('./vnpay');
const momo = require('./momo');
const zalopay = require('./zalopay');
const paypal = require('./paypal');

const gateways = { VNPAY: vnpay, MOMO: momo, ZALOPAY: zalopay, PAYPAL: paypal };

const PROVIDER_INFO = Object.freeze({
    VNPAY: {
        label: 'Cổng thanh toán VNPAY',
        description: 'Thẻ ATM nội địa (NAPAS), Visa/MasterCard hoặc VNPAY-QR',
        tags: 'Thẻ ATM / Visa / QR'
    },
    MOMO: {
        label: 'Ví điện tử MoMo',
        description: 'Thanh toán qua ứng dụng MoMo hoặc thẻ ngân hàng liên kết',
        tags: 'Thẻ ATM / Ví MoMo'
    },
    ZALOPAY: {
        label: 'Ví điện tử ZaloPay',
        description: 'Thanh toán qua ví ZaloPay hoặc thẻ ATM nội địa',
        tags: 'Thẻ ATM / ZaloPay'
    },
    PAYPAL: {
        label: 'PayPal / Thẻ Quốc Tế',
        description: 'Thanh toán quốc tế bằng thẻ Visa, MasterCard hoặc PayPal (USD)',
        tags: 'USD / Visa'
    }
});

const SANDBOX_TEST_CARDS = Object.freeze({});

const KNOWN_ERROR_TEST_CARDS = Object.freeze({
    '9704195798459170488': 'Giao dịch bị từ chối: Tài khoản thẻ không đủ số dư thanh toán (Mã lỗi 51)',
    '9704193370791314': 'Giao dịch bị từ chối: Thẻ đang bị khóa hoặc chưa đăng ký thanh toán trực tuyến',
    '9704540000000047': 'Giao dịch bị từ chối: Tài khoản thẻ không đủ số dư khả dụng'
});

const evaluateSimulatedCard = (provider, cardNumber, otp) => {
    const rawCard = String(cardNumber || '').trim();
    if (!rawCard) {
        return {
            ok: false,
            reason: 'Vui lòng nhập đầy đủ thông tin số thẻ thanh toán.'
        };
    }
    const digits = rawCard.replace(/[\s-]+/g, '');
    if (KNOWN_ERROR_TEST_CARDS[digits]) {
        return { ok: false, reason: KNOWN_ERROR_TEST_CARDS[digits] };
    }
    if (!/^\d{15,19}$/.test(digits) || !/^(9704|4|5|35)/.test(digits)) {
        return {
            ok: false,
            reason: 'Số thẻ không hợp lệ. Vui lòng nhập thẻ ATM nội địa (9704...) hoặc thẻ quốc tế Visa/MasterCard/JCB (15-19 chữ số).'
        };
    }
    const rawOtp = String(otp || '').trim();
    if (!rawOtp) {
        return {
            ok: false,
            reason: 'Vui lòng nhập mã xác thực OTP để hoàn tất giao dịch.'
        };
    }
    if (rawOtp === '999999' || rawOtp.length < 3) {
        return { ok: false, reason: 'Mã xác thực OTP không chính xác hoặc đã hết hạn.' };
    }
    return { ok: true };
};

const parseBooleanEnv = (value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
};

// Che do cong thanh toan thu nghiem the/OTP noi bo:
// - Neu PAYMENT_SIMULATOR duoc chi dinh ro ('true'/'false') thi ton trong tuyet doi
//   ke ca tren VPS (NODE_ENV === 'production') de du an demo/do an van thanh toan duoc
//   khi sandbox ben ngoai (ZaloPay/MoMo/VNPAY) tam bao tri hoac chua cap khoa.
// - Neu khong khai bao PAYMENT_SIMULATOR: mac dinh bat o dev/test va tat tren production.
const simulatorEnabled = () => {
    const explicit = parseBooleanEnv(process.env.PAYMENT_SIMULATOR);
    if (explicit !== null) return explicit;
    return process.env.NODE_ENV !== 'production';
};

const normalizeProvider = (value) => {
    const key = String(value || '').trim().toUpperCase();
    return gateways[key] ? key : null;
};

const providerStatus = (key) => {
    const configured = gateways[key].isConfigured();
    return {
        code: key,
        ...PROVIDER_INFO[key],
        configured,
        simulated: !configured && simulatorEnabled(),
        enabled: configured || simulatorEnabled(),
        testCards: SANDBOX_TEST_CARDS[key] || []
    };
};

const listProviders = () => Object.keys(gateways).map(providerStatus);

module.exports = {
    gateways,
    normalizeProvider,
    providerStatus,
    listProviders,
    simulatorEnabled,
    SANDBOX_TEST_CARDS,
    evaluateSimulatedCard
};
