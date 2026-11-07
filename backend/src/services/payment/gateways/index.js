const vnpay = require('./vnpay');
const momo = require('./momo');
const zalopay = require('./zalopay');
const paypal = require('./paypal');

const gateways = { VNPAY: vnpay, MOMO: momo, ZALOPAY: zalopay, PAYPAL: paypal };

const PROVIDER_INFO = Object.freeze({
    VNPAY: {
        label: 'Cổng thanh toán VNPAY',
        description: 'Nhập thẻ ATM nội địa (NCB, NAPAS), Visa/MasterCard hoặc VNPAY-QR',
        tags: 'Thẻ ATM / Visa / QR'
    },
    MOMO: {
        label: 'Cổng thanh toán MoMo',
        description: 'Nhập thẻ ATM NAPAS, Visa/MasterCard hoặc Ví điện tử MoMo',
        tags: 'Thẻ ATM / Visa / Ví'
    },
    ZALOPAY: {
        label: 'ZaloPay Gateway',
        description: 'Nhập thẻ ATM nội địa, Internet Banking, Visa/Master hoặc Ví ZaloPay',
        tags: 'Thẻ ATM / IB / Ví'
    },
    PAYPAL: {
        label: 'PayPal Sandbox',
        description: 'Thanh toán quốc tế bằng tài khoản hoặc thẻ PayPal (quy đổi USD)',
        tags: 'USD / Visa'
    }
});

const SANDBOX_TEST_CARDS = Object.freeze({
    VNPAY: [
        {
            type: 'ATM_NCB',
            bank: 'NCB (Ngân hàng Quốc Dân)',
            cardNumber: '9704198526191432198',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '07/15',
            otp: '123456',
            note: 'Thẻ nội địa dùng thử miễn phí của VNPAY Sandbox'
        },
        {
            type: 'ATM_NAPAS',
            bank: 'NAPAS / VietinBank',
            cardNumber: '9704000000000018',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '03/07',
            otp: 'otp',
            note: 'Thẻ NAPAS nội địa dùng thử'
        },
        {
            type: 'VISA',
            bank: 'VISA Quốc tế',
            cardNumber: '4456530000001005',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '12/26',
            cvv: '123',
            otp: '123456',
            note: 'Thẻ quốc tế VISA (No 3DS)'
        }
    ],
    ZALOPAY: [
        {
            type: 'ATM_NAPAS',
            bank: 'Thẻ ATM NAPAS (Merchant Trial V2)',
            cardNumber: '9704540000000062',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '10/18',
            otp: '123456',
            note: 'Thẻ ATM nội địa cấp sẵn của ZaloPay Sandbox'
        },
        {
            type: 'VISA',
            bank: 'VISA / MasterCard',
            cardNumber: '4111111111111111',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '01/28',
            cvv: '123',
            otp: '123456',
            note: 'Thẻ quốc tế dùng thử ZaloPay'
        }
    ],
    MOMO: [
        {
            type: 'ATM_NAPAS',
            bank: 'Thẻ ATM NAPAS (MoMo Test)',
            cardNumber: '9704000000000018',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '03/07',
            otp: '000000',
            note: 'Thẻ ATM nội địa dùng thử MoMo Sandbox'
        },
        {
            type: 'VISA',
            bank: 'VISA / MasterCard',
            cardNumber: '4111111111111111',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '12/28',
            cvv: '123',
            otp: '000000',
            note: 'Thẻ quốc tế dùng thử MoMo'
        }
    ],
    PAYPAL: [
        {
            type: 'VISA',
            bank: 'PayPal Sandbox Card',
            cardNumber: '4032039935147760',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '12/28',
            cvv: '123',
            otp: '123456',
            note: 'Hoặc đăng nhập tài khoản Buyer trên cổng PayPal Sandbox'
        }
    ]
});

const KNOWN_ERROR_TEST_CARDS = Object.freeze({
    '9704195798459170488': 'Thẻ thử nghiệm báo lỗi: Tài khoản không đủ số dư (VNPAY mã lỗi 51)',
    '9704193370791314': 'Thẻ thử nghiệm báo lỗi: Thẻ đang bị khóa hoặc chưa kích hoạt (VNPAY)',
    '9704540000000047': 'Thẻ thử nghiệm báo lỗi: Tài khoản không đủ số dư (ZaloPay Sandbox)'
});

const evaluateSimulatedCard = (provider, cardNumber, otp) => {
    const rawCard = String(cardNumber || '').trim();
    if (!rawCard) return { ok: true };
    const digits = rawCard.replace(/[\s-]+/g, '');
    if (KNOWN_ERROR_TEST_CARDS[digits]) {
        return { ok: false, reason: KNOWN_ERROR_TEST_CARDS[digits] };
    }
    if (!/^\d{15,19}$/.test(digits) || !/^(9704|4|5|35)/.test(digits)) {
        return {
            ok: false,
            reason: 'Số thẻ dùng thử không hợp lệ. Vui lòng nhập thẻ test cấp sẵn (bắt đầu bằng 9704... hoặc 4...)'
        };
    }
    const rawOtp = String(otp || '').trim();
    if (rawOtp && (rawOtp === '999999' || rawOtp.length < 3)) {
        return { ok: false, reason: 'Mã OTP thử nghiệm không hợp lệ (vui lòng nhập 123456 hoặc 000000)' };
    }
    return { ok: true };
};

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
