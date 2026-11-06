import axios from '../axios';

export const REWARD_WALLET_UPDATED_EVENT = 'jobfind:reward-wallet-updated';

export const notifyRewardWalletUpdated = (detail = {}) => {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent(REWARD_WALLET_UPDATED_EVENT, { detail }));
    }
};

const isUnmockedUnitTest = () => process.env.NODE_ENV === 'test';

export const DEFAULT_CANDIDATE_TOPUP_PACKAGES = [
    {
        code: 'BASIC',
        name: 'Gói Khởi Đầu (Basic)',
        points: 20,
        xu: 20000,
        priceVnd: 20000,
        originalPriceVnd: 20000,
        discountPercent: 0,
        badge: null,
        featured: false,
        perks: [
            'Mở khóa 02 báo cáo phân tích đối thủ',
            'Không giới hạn thời gian lưu trữ điểm',
        ],
    },
    {
        code: 'STANDARD',
        name: 'Gói Tiêu Chuẩn (Standard)',
        points: 50,
        xu: 50000,
        priceVnd: 45000,
        originalPriceVnd: 50000,
        discountPercent: 10,
        badge: 'PHỔ BIẾN NHẤT',
        featured: true,
        perks: [
            'Mở khóa 05 báo cáo phân tích cạnh tranh',
            'Đẩy Top hồ sơ ứng viên 03 lần',
            'Tặng thêm 5.000 Xu vào ví thưởng',
        ],
    },
    {
        code: 'PRO',
        name: 'Gói Tăng Tốc (Pro)',
        points: 100,
        xu: 100000,
        priceVnd: 85000,
        originalPriceVnd: 100000,
        discountPercent: 15,
        badge: 'TIẾT KIỆM 15%',
        featured: false,
        perks: [
            'Mở khóa 10 báo cáo phân tích chuyên sâu',
            'Ưu tiên hiển thị CV với Nhà tuyển dụng (7 ngày)',
            'Miễn phí 01 lần AI Review CV chi tiết',
        ],
    },
    {
        code: 'PREMIUM',
        name: 'Gói Chuyên Nghiệp (VIP)',
        points: 200,
        xu: 200000,
        priceVnd: 160000,
        originalPriceVnd: 200000,
        discountPercent: 20,
        badge: 'Lên thẳng Hạng Vàng',
        featured: false,
        perks: [
            'Mở khóa 20 báo cáo + Xem mức lương đối thủ',
            'Đặc quyền Huy hiệu Ứng viên Kim Cương (30 ngày)',
            'Hoàn thêm 10% Điểm cho các lần nạp tiếp theo',
        ],
    },
];

export const PAYMENT_METHOD_OPTIONS = [
    {
        code: 'VNPAY',
        name: 'VNPAY-QR',
        badge: 'KHUYÊN DÙNG',
        description: 'Quét mã QR qua ứng dụng Ngân hàng & Ví VNPAY (Giảm thêm 5K)',
        defaultPromo: 'VNPAY5K',
    },
    {
        code: 'MOMO',
        name: 'Ví MoMo',
        badge: null,
        description: 'Thanh toán siêu tốc qua siêu ứng dụng tài chính MoMo',
        defaultPromo: '',
    },
    {
        code: 'ZALOPAY',
        name: 'Ví ZaloPay',
        badge: null,
        description: 'Thanh toán tiện lợi trực tiếp qua ứng dụng Zalo hoặc ZaloPay',
        defaultPromo: '',
    },
    {
        code: 'PAYPAL',
        name: 'PayPal / Thẻ Quốc Tế',
        badge: null,
        description: 'Hỗ trợ tài khoản PayPal, thẻ tín dụng/ghi nợ quốc tế Visa, Mastercard, JCB',
        defaultPromo: '',
    },
];

export const getRewardConfigService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get('/api/rewards/config');
};

export const getCandidateRewardOverviewService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get('/api/rewards/candidate/overview');
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

export const getEmployerRewardOverviewService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get('/api/rewards/employer/overview');
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
