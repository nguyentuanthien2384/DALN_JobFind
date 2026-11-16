import axios from '../axios';
import { SESSION_ENDED_EVENT } from '../auth/sessionExpiry';
import { readJsonStorage } from '../util/storage';

export const REWARD_WALLET_UPDATED_EVENT = 'jobfind:reward-wallet-updated';
export const CANDIDATE_PROFILE_UPDATED_EVENT = 'jobfind:candidate-profile-updated';

// Keep reports in other tabs in sync after a successful profile/settings save.
export const notifyCandidateProfileUpdated = (userId) => {
    const detail = { userId: Number(userId), updatedAt: Date.now() };
    if (!Number.isInteger(detail.userId) || detail.userId <= 0) return;
    try {
        localStorage.setItem(CANDIDATE_PROFILE_UPDATED_EVENT, JSON.stringify(detail));
    } catch (_error) {
        // The current tab still receives the update when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent(CANDIDATE_PROFILE_UPDATED_EVENT, { detail }));
};

const isUnmockedUnitTest = () => process.env.NODE_ENV === 'test';

const readActiveUser = () => readJsonStorage('userData');

let cachedCandidateUserId = null;
let cachedCandidateOverview = null;
let cachedCandidateOverviewAt = 0;
let inflightCandidateOverview = null;

let cachedEmployerCompanyId = null;
let cachedEmployerOverview = null;
let cachedEmployerOverviewAt = 0;
let inflightEmployerOverview = null;

const OVERVIEW_CACHE_TTL_MS = 60000;

export const clearRewardOverviewCache = () => {
    cachedCandidateUserId = null;
    cachedCandidateOverview = null;
    cachedCandidateOverviewAt = 0;
    inflightCandidateOverview = null;

    cachedEmployerCompanyId = null;
    cachedEmployerOverview = null;
    cachedEmployerOverviewAt = 0;
    inflightEmployerOverview = null;
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(SESSION_ENDED_EVENT, clearRewardOverviewCache);
}

export const getCachedCandidateRewardOverview = () => {
    if (isUnmockedUnitTest()) return null;
    const user = readActiveUser();
    if (!user?.id || (user.roleCode && user.roleCode !== 'CANDIDATE')) return null;
    if (Number(cachedCandidateUserId) !== Number(user.id)) return null;
    return cachedCandidateOverview;
};

export const setCachedCandidateRewardOverview = (data) => {
    if (isUnmockedUnitTest() || !data) return;
    const user = readActiveUser();
    if (!user?.id || (user.roleCode && user.roleCode !== 'CANDIDATE')) return;
    cachedCandidateUserId = Number(user.id);
    cachedCandidateOverview = data;
    cachedCandidateOverviewAt = Date.now();
};

export const getCachedEmployerRewardOverview = () => {
    if (isUnmockedUnitTest()) return null;
    const user = readActiveUser();
    if (!user?.companyId || (user.roleCode !== 'COMPANY' && user.roleCode !== 'EMPLOYER')) return null;
    if (Number(cachedEmployerCompanyId) !== Number(user.companyId)) return null;
    return cachedEmployerOverview;
};

export const setCachedEmployerRewardOverview = (data) => {
    if (isUnmockedUnitTest() || !data) return;
    const user = readActiveUser();
    if (!user?.companyId || (user.roleCode !== 'COMPANY' && user.roleCode !== 'EMPLOYER')) return;
    cachedEmployerCompanyId = Number(user.companyId);
    cachedEmployerOverview = data;
    cachedEmployerOverviewAt = Date.now();
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
        name: 'Gói Cơ Bản',
        points: 22,
        totalPoints: 22,
        basePoints: 20,
        bonusPoints: 2,
        xu: 22000,
        priceVnd: 20000,
        originalPriceVnd: 22000,
        discountPercent: 9,
        featured: false,
    },
    {
        code: 'STANDARD',
        name: 'Gói Tiêu Chuẩn',
        points: 60,
        totalPoints: 60,
        basePoints: 50,
        bonusPoints: 10,
        xu: 60000,
        priceVnd: 50000,
        originalPriceVnd: 60000,
        discountPercent: 17,
        featured: true,
    },
    {
        code: 'PRO',
        name: 'Gói Nâng Cao',
        points: 130,
        totalPoints: 130,
        basePoints: 100,
        bonusPoints: 30,
        xu: 130000,
        priceVnd: 100000,
        originalPriceVnd: 130000,
        discountPercent: 23,
        featured: false,
    },
    {
        code: 'PREMIUM',
        name: 'Gói Chuyên Nghiệp',
        points: 280,
        totalPoints: 280,
        basePoints: 200,
        bonusPoints: 80,
        xu: 280000,
        priceVnd: 200000,
        originalPriceVnd: 280000,
        discountPercent: 29,
        featured: false,
    },
];

export const PAYMENT_METHOD_OPTIONS = [
    {
        code: 'VNPAY',
        name: 'Cổng thanh toán VNPAY',
        description: 'Thẻ ATM / Tài khoản ngân hàng nội địa',
        defaultPromo: '',
    },
    {
        code: 'MOMO',
        name: 'Ví điện tử MoMo',
        description: 'Thanh toán qua ứng dụng MoMo hoặc thẻ liên kết',
        defaultPromo: '',
    },
    {
        code: 'ZALOPAY',
        name: 'Ví điện tử ZaloPay',
        description: 'Thanh toán qua ZaloPay hoặc thẻ ngân hàng nội địa',
        defaultPromo: '',
    },
    {
        code: 'PAYPAL',
        name: 'PayPal / Thẻ Quốc Tế',
        description: 'Thanh toán quốc tế bằng thẻ Visa, MasterCard hoặc PayPal',
        defaultPromo: '',
    },
];

export const getRewardConfigService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get('/api/rewards/config');
};

export const getCandidateRewardOverviewService = ({ force = false } = {}) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    const user = readActiveUser();
    if (user?.roleCode && user.roleCode !== 'CANDIDATE') {
        return Promise.resolve({ errCode: 3, errMessage: 'Tính năng chỉ dành cho ứng viên', data: null });
    }
    const now = Date.now();
    const cached = getCachedCandidateRewardOverview();
    if (!force && cached && now - cachedCandidateOverviewAt < OVERVIEW_CACHE_TTL_MS) {
        return Promise.resolve({ errCode: 0, data: cached, cached: true });
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
    const cached = getCachedEmployerRewardOverview();
    if (!force && cached && now - cachedEmployerOverviewAt < OVERVIEW_CACHE_TTL_MS) {
        return Promise.resolve({ errCode: 0, data: cached, cached: true });
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

export const getAdminRewardsOverviewService = (params = {}) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.get('/api/rewards/admin/overview', { params });
};

export const redeemEmployerPointsService = (rewardCode) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/rewards/employer/redeem', { rewardCode });
};

export const DEFAULT_PROMO_CATALOG = {
    VNPAY5K: {
        code: 'VNPAY5K',
        discountType: 'FIXED',
        discountVnd: 5000,
        discountPercent: 0,
        maxDiscount: 0,
        provider: 'VNPAY',
        purpose: null,
        minAmountVnd: 20000,
        isActive: true,
        label: 'Giảm 5.000đ qua VNPAY',
        description: 'Giảm 5.000đ khi thanh toán VNPAY-QR',
    },
    ARCHITECT5K: {
        code: 'ARCHITECT5K',
        discountType: 'FIXED',
        discountVnd: 5000,
        discountPercent: 0,
        maxDiscount: 0,
        provider: null,
        purpose: null,
        minAmountVnd: 20000,
        isActive: true,
        label: 'Giảm 5.000đ',
        description: 'Ưu đãi Career Architect giảm 5.000đ',
    },
    MOMO5K: {
        code: 'MOMO5K',
        discountType: 'FIXED',
        discountVnd: 5000,
        discountPercent: 0,
        maxDiscount: 0,
        provider: 'MOMO',
        purpose: null,
        minAmountVnd: 20000,
        isActive: true,
        label: 'Giảm 5.000đ qua MoMo',
        description: 'Giảm 5.000đ khi thanh toán ví MoMo',
    },
    ZALOPAY5K: {
        code: 'ZALOPAY5K',
        discountType: 'FIXED',
        discountVnd: 5000,
        discountPercent: 0,
        maxDiscount: 0,
        provider: 'ZALOPAY',
        purpose: null,
        minAmountVnd: 20000,
        isActive: true,
        label: 'Giảm 5.000đ qua ZaloPay',
        description: 'Giảm 5.000đ khi thanh toán ví ZaloPay',
    },
    JOBFIND10K: {
        code: 'JOBFIND10K',
        discountType: 'FIXED',
        discountVnd: 10000,
        discountPercent: 0,
        maxDiscount: 0,
        provider: null,
        purpose: null,
        minAmountVnd: 50000,
        isActive: true,
        label: 'Giảm 10.000đ',
        description: 'Giảm 10.000đ cho đơn từ 50.000đ',
    },
    JOBFIND20K: {
        code: 'JOBFIND20K',
        discountType: 'FIXED',
        discountVnd: 20000,
        discountPercent: 0,
        maxDiscount: 0,
        provider: null,
        purpose: null,
        minAmountVnd: 100000,
        isActive: true,
        label: 'Giảm 20.000đ',
        description: 'Giảm 20.000đ cho đơn từ 100.000đ',
    },
    VIP15: {
        code: 'VIP15',
        discountType: 'PERCENT',
        discountVnd: 0,
        discountPercent: 15,
        maxDiscount: 50000,
        provider: null,
        purpose: null,
        minAmountVnd: 100000,
        isActive: true,
        label: 'Giảm 15% (tối đa 50.000đ)',
        description: 'Giảm 15% (tối đa 50.000đ) cho đơn từ 100.000đ',
    },
};

export const normalizeClientPromoRule = (code, raw = {}) => {
    const normalizedCode = String(code || raw.code || '').trim().toUpperCase();
    const isPercent =
        String(raw.discountType || '').toUpperCase() === 'PERCENT' || Number(raw.discountPercent) > 0;
    const discountVnd = Number(raw.discountVnd ?? raw.discount ?? 0) || 0;
    const discountPercent = isPercent ? Number(raw.discountPercent ?? raw.discount ?? 0) || 0 : 0;
    const maxDiscount = Number(raw.maxDiscount ?? 0) || 0;
    const minAmountVnd = Number(raw.minAmountVnd ?? raw.minAmount ?? 0) || 0;
    const provider = raw.provider && raw.provider !== 'ALL' ? String(raw.provider).trim().toUpperCase() : null;
    const purpose = raw.purpose && raw.purpose !== 'ALL' ? String(raw.purpose).trim().toUpperCase() : null;
    const isActive = raw.isActive === undefined ? true : Boolean(Number(raw.isActive) !== 0 && raw.isActive !== false);
    const label =
        raw.label ||
        raw.description ||
        (isPercent
            ? `Giảm ${discountPercent}%${maxDiscount > 0 ? ` (tối đa ${maxDiscount.toLocaleString('vi-VN')}đ)` : ''}`
            : `Giảm ${discountVnd.toLocaleString('vi-VN')}đ`);
    return {
        code: normalizedCode,
        discountType: isPercent ? 'PERCENT' : 'FIXED',
        discountVnd,
        discountPercent,
        maxDiscount,
        minAmountVnd,
        provider,
        purpose,
        isActive,
        expiresAt: raw.expiresAt || null,
        label,
        description: raw.description || label,
    };
};

export const buildPromoCatalogMap = (promoList = null) => {
    const map = { ...DEFAULT_PROMO_CATALOG };
    if (Array.isArray(promoList) && promoList.length > 0) {
        promoList.forEach((item) => {
            if (!item || !item.code) return;
            const normalized = normalizeClientPromoRule(item.code, item);
            if (normalized.isActive === false) {
                delete map[normalized.code];
            } else {
                map[normalized.code] = normalized;
            }
        });
    }
    return map;
};

export const evaluatePromoRuleClient = (
    rule,
    { amountVnd = 0, provider = null, purpose = null } = {}
) => {
    if (!rule || rule.isActive === false) {
        return {
            valid: false,
            discountVnd: 0,
            label: null,
            reason: 'Mã giảm giá không tồn tại hoặc đã hết hạn.',
        };
    }
    if (rule.expiresAt && new Date(rule.expiresAt).getTime() < Date.now()) {
        return {
            valid: false,
            discountVnd: 0,
            label: null,
            reason: `Mã ${rule.code} đã hết hạn sử dụng.`,
        };
    }
    if (rule.purpose && purpose && String(rule.purpose).toUpperCase() !== String(purpose).toUpperCase()) {
        return {
            valid: false,
            discountVnd: 0,
            label: null,
            reason: `Mã ${rule.code} không áp dụng cho loại giao dịch này.`,
        };
    }
    if (rule.provider && provider && String(rule.provider).toUpperCase() !== String(provider).toUpperCase()) {
        return {
            valid: false,
            discountVnd: 0,
            label: null,
            reason: `Mã ${rule.code} chỉ áp dụng cho phương thức ${rule.provider}.`,
        };
    }
    const basePrice = Number(amountVnd || 0);
    if (rule.minAmountVnd && basePrice < rule.minAmountVnd) {
        return {
            valid: false,
            discountVnd: 0,
            label: null,
            reason: `Mã ${rule.code} áp dụng cho gói từ ${Number(rule.minAmountVnd).toLocaleString('vi-VN')} VNĐ.`,
        };
    }
    let rawDiscount = Number(rule.discountVnd || 0);
    if (rule.discountType === 'PERCENT' || Number(rule.discountPercent) > 0) {
        rawDiscount = Math.round((basePrice * Number(rule.discountPercent)) / 100);
        if (Number(rule.maxDiscount) > 0) {
            rawDiscount = Math.min(rawDiscount, Number(rule.maxDiscount));
        }
    }
    const discountVnd = Math.min(rawDiscount, Math.max(0, basePrice - 5000));
    return {
        valid: true,
        discountVnd,
        label: rule.label || `Giảm ${discountVnd.toLocaleString('vi-VN')}đ`,
        reason: null,
    };
};

export const previewPromoCodeService = (payload) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/payments/promo/preview', payload);
};

export const getAdminPromoCodesService = () => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: [] });
    return axios.get('/api/payments/promo/admin');
};

export const upsertAdminPromoCodeService = (payload) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.post('/api/payments/promo/admin', payload);
};

export const deleteAdminPromoCodeService = (code) => {
    if (isUnmockedUnitTest()) return Promise.resolve({ errCode: 0, data: null });
    return axios.delete(`/api/payments/promo/admin/${encodeURIComponent(code)}`);
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
