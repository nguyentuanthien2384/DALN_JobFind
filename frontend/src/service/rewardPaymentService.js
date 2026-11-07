import axios from '../axios';

export const REWARD_WALLET_UPDATED_EVENT = 'jobfind:reward-wallet-updated';

const isUnmockedUnitTest = () => process.env.NODE_ENV === 'test';

let cachedCandidateOverview = null;
let cachedCandidateOverviewAt = 0;
let inflightCandidateOverview = null;

let cachedEmployerOverview = null;
let cachedEmployerOverviewAt = 0;
let inflightEmployerOverview = null;

const OVERVIEW_CACHE_TTL_MS = 15000;

export const getCachedCandidateRewardOverview = () => (
    isUnmockedUnitTest() ? null : cachedCandidateOverview
);

export const setCachedCandidateRewardOverview = (data) => {
    if (!isUnmockedUnitTest() && data) {
        cachedCandidateOverview = data;
        cachedCandidateOverviewAt = Date.now();
    }
};

export const getCachedEmployerRewardOverview = () => (
    isUnmockedUnitTest() ? null : cachedEmployerOverview
);

export const setCachedEmployerRewardOverview = (data) => {
    if (!isUnmockedUnitTest() && data) {
        cachedEmployerOverview = data;
        cachedEmployerOverviewAt = Date.now();
    }
};

export const invalidateRewardOverviewCache = () => {
    cachedCandidateOverviewAt = 0;
    cachedEmployerOverviewAt = 0;
    inflightCandidateOverview = null;
    inflightEmployerOverview = null;
};

export const notifyRewardWalletUpdated = (detail = {}) => {
    if (cachedEmployerOverview?.allowances && (detail?.allowance || detail?.allowances)) {
        const nextAllowances = {
            ...cachedEmployerOverview.allowances,
            ...(detail.allowances || {}),
            ...(detail.allowance
                ? {
                    allowCvFree: Number(detail.allowance.free ?? cachedEmployerOverview.allowances.allowCvFree ?? 0),
                    allowCv: Number(detail.allowance.paid ?? cachedEmployerOverview.allowances.allowCv ?? 0),
                }
                : {}),
        };
        cachedEmployerOverview = {
            ...cachedEmployerOverview,
            allowances: nextAllowances,
            company: cachedEmployerOverview.company
                ? { ...cachedEmployerOverview.company, ...nextAllowances }
                : cachedEmployerOverview.company,
        };
    }
    invalidateRewardOverviewCache();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(REWARD_WALLET_UPDATED_EVENT, { detail }));
    }
};

export const subscribeRewardWalletUpdated = (listener) => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof listener !== 'function') {
        return () => {};
    }
    window.addEventListener(REWARD_WALLET_UPDATED_EVENT, listener);
    return () => window.removeEventListener(REWARD_WALLET_UPDATED_EVENT, listener);
};

export const DEFAULT_CANDIDATE_TOPUP_PACKAGES = [
    {
        code: 'BASIC',
        name: 'Gói Khởi Đầu (Basic)',
        points: 22,
        totalPoints: 22,
        basePoints: 20,
        bonusPoints: 2,
        xu: 22000,
        priceVnd: 20000,
        originalPriceVnd: 22000,
        discountPercent: 9,
        badge: 'Tặng +2 Điểm (Tổng 22 Điểm)',
        featured: false,
        perks: [
            'Mở khóa 02 báo cáo phân tích đối thủ',
            'Không giới hạn thời gian lưu trữ điểm',
        ],
    },
    {
        code: 'STANDARD',
        name: 'Gói Tiêu Chuẩn (Standard)',
        points: 60,
        totalPoints: 60,
        basePoints: 50,
        bonusPoints: 10,
        xu: 60000,
        priceVnd: 50000,
        originalPriceVnd: 60000,
        discountPercent: 17,
        badge: 'PHỔ BIẾN NHẤT (+10 Điểm)',
        featured: true,
        perks: [
            'Mở khóa 06 báo cáo phân tích cạnh tranh',
            'Đẩy Top hồ sơ ứng viên 03 lần',
            'Tặng thêm 10 Điểm (10.000 Xu) vào ví thưởng',
        ],
    },
    {
        code: 'PRO',
        name: 'Gói Tăng Tốc (Pro)',
        points: 130,
        totalPoints: 130,
        basePoints: 100,
        bonusPoints: 30,
        xu: 130000,
        priceVnd: 100000,
        originalPriceVnd: 130000,
        discountPercent: 23,
        badge: 'Tặng +30 Điểm (Tổng 130 Điểm)',
        featured: false,
        perks: [
            'Mở khóa 13 báo cáo phân tích chuyên sâu',
            'Ưu tiên hiển thị CV với Nhà tuyển dụng (7 ngày)',
            'Miễn phí 01 lần AI Review CV chi tiết',
        ],
    },
    {
        code: 'PREMIUM',
        name: 'Gói Cao Cấp (VIP)',
        points: 280,
        totalPoints: 280,
        basePoints: 200,
        bonusPoints: 80,
        xu: 280000,
        priceVnd: 200000,
        originalPriceVnd: 280000,
        discountPercent: 29,
        badge: 'Tặng +80 Điểm & Đẩy Top CV',
        featured: false,
        perks: [
            'Mở khóa 28 báo cáo + Xem mức lương đối thủ',
            'Đặc quyền Huy hiệu Ứng viên Kim Cương (30 ngày)',
            'Tặng thêm 80 Điểm thưởng vào ví ngay lập tức',
        ],
    },
];

export const SANDBOX_TEST_CARDS = {
    VNPAY: [
        {
            type: 'ATM_NCB',
            bank: 'NCB (Ngân hàng Quốc Dân)',
            cardNumber: '9704198526191432198',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '07/15',
            otp: '123456',
            note: 'Thẻ nội địa dùng thử miễn phí của VNPAY Sandbox',
        },
        {
            type: 'ATM_NAPAS',
            bank: 'NAPAS / VietinBank',
            cardNumber: '9704000000000018',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '03/07',
            otp: 'otp',
            note: 'Thẻ nội địa NAPAS dùng thử',
        },
        {
            type: 'VISA',
            bank: 'VISA Quốc tế',
            cardNumber: '4456530000001005',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '12/26',
            cvv: '123',
            otp: '123456',
            note: 'Thẻ quốc tế VISA (No 3DS)',
        },
    ],
    ZALOPAY: [
        {
            type: 'ATM_NAPAS',
            bank: 'Thẻ ATM NAPAS (Merchant Trial V2)',
            cardNumber: '9704540000000062',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '10/18',
            otp: '123456',
            note: 'Thẻ ATM nội địa cấp sẵn của ZaloPay Sandbox',
        },
        {
            type: 'VISA',
            bank: 'VISA / MasterCard',
            cardNumber: '4111111111111111',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '01/28',
            cvv: '123',
            otp: '123456',
            note: 'Thẻ quốc tế dùng thử ZaloPay',
        },
    ],
    MOMO: [
        {
            type: 'ATM_NAPAS',
            bank: 'Thẻ ATM NAPAS (MoMo Test)',
            cardNumber: '9704000000000018',
            cardHolder: 'NGUYEN VAN A',
            issueDate: '03/07',
            otp: '000000',
            note: 'Thẻ ATM nội địa dùng thử MoMo Sandbox',
        },
        {
            type: 'VISA',
            bank: 'VISA / MasterCard',
            cardNumber: '4111111111111111',
            cardHolder: 'NGUYEN VAN A',
            expiryDate: '12/28',
            cvv: '123',
            otp: '000000',
            note: 'Thẻ quốc tế dùng thử MoMo',
        },
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
            note: 'Hoặc đăng nhập tài khoản Buyer trên cổng PayPal Sandbox',
        },
    ],
};

export const PAYMENT_METHOD_OPTIONS = [
    {
        code: 'VNPAY',
        name: 'Cổng VNPAY Sandbox',
        badge: 'KHUYÊN DÙNG',
        description: 'Nhập thẻ ATM nội địa NCB / NAPAS, thẻ Visa hoặc VNPAY-QR (Giảm thêm 5K)',
        defaultPromo: 'VNPAY5K',
    },
    {
        code: 'MOMO',
        name: 'Cổng MoMo Sandbox',
        badge: null,
        description: 'Nhập thẻ ATM NAPAS, Visa/MasterCard hoặc Ví MoMo dùng thử',
        defaultPromo: '',
    },
    {
        code: 'ZALOPAY',
        name: 'ZaloPay Gateway (Trial V2)',
        badge: null,
        description: 'Nhập thẻ ATM nội địa NAPAS, Internet Banking hoặc Ví ZaloPay dùng thử',
        defaultPromo: '',
    },
    {
        code: 'PAYPAL',
        name: 'PayPal / Thẻ Quốc Tế',
        badge: null,
        description: 'Hỗ trợ tài khoản PayPal Sandbox và thẻ tín dụng/ghi nợ quốc tế Visa, Mastercard',
        defaultPromo: '',
    },
];

export const getRewardConfigService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get('/api/rewards/config');
};

export const getCandidateRewardOverviewService = ({ force = false } = {}) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    const now = Date.now();
    if (!force && cachedCandidateOverview && now - cachedCandidateOverviewAt < OVERVIEW_CACHE_TTL_MS) {
        return Promise.resolve({ errCode: 0, data: cachedCandidateOverview, cached: true });
    }
    if (!force && inflightCandidateOverview) {
        return inflightCandidateOverview;
    }
    inflightCandidateOverview = axios
        .get('/api/rewards/candidate/overview')
        .then((res) => {
            if (res && res.errCode === 0 && res.data) {
                setCachedCandidateRewardOverview(res.data);
            }
            return res;
        })
        .finally(() => {
            inflightCandidateOverview = null;
        });
    return inflightCandidateOverview;
};

export const claimCandidateDailyCheckinService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/rewards/candidate/check-in');
};

export const claimCandidateProfileCompletionService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/rewards/candidate/claim-profile');
};

export const getJobCompetitionReportService = (postId) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get(`/api/rewards/jobs/${encodeURIComponent(postId)}/competition`);
};

export const unlockJobCompetitionReportService = (postId) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post(`/api/rewards/jobs/${encodeURIComponent(postId)}/unlock-competition`);
};

export const getEmployerRewardOverviewService = ({ force = false } = {}) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    const now = Date.now();
    if (!force && cachedEmployerOverview && now - cachedEmployerOverviewAt < OVERVIEW_CACHE_TTL_MS) {
        return Promise.resolve({ errCode: 0, data: cachedEmployerOverview, cached: true });
    }
    if (!force && inflightEmployerOverview) {
        return inflightEmployerOverview;
    }
    inflightEmployerOverview = axios
        .get('/api/rewards/employer/overview')
        .then((res) => {
            if (res && res.errCode === 0 && res.data) {
                setCachedEmployerRewardOverview(res.data);
            }
            return res;
        })
        .finally(() => {
            inflightEmployerOverview = null;
        });
    return inflightEmployerOverview;
};

export const redeemEmployerPointsService = (rewardCode) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/rewards/employer/redeem', { rewardCode });
};

export const createPaymentCheckoutService = (payload) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/payments/checkout', payload);
};

export const verifyPaymentReturnService = (params = {}) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            searchParams.append(key, String(value));
        }
    });
    return axios.get(`/api/payments/verify-return?${searchParams.toString()}`);
};

export const getMyPaymentOrdersService = (limit = 20) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: [] });
    return axios.get(`/api/payments/orders?limit=${encodeURIComponent(limit)}`);
};
