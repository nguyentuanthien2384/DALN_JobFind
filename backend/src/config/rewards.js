// ===== CAU HINH TICH DIEM & THANH TOAN (mot nguon su that cho server) =====
// Moi gia tien / so diem deu do SERVER tinh tu bang nay: client chi gui ma goi,
// khong bao gio gui gia hay so diem (chong sua gia tren trinh duyet).
require('dotenv').config();

const toPositiveInt = (value, fallback) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
};

// 1 Diem thuong = 1.000 Xu = 1.000 VND (giong quy uoc tren thiet ke).
const POINT_VALUE_VND = 1000;

// Goi nap diem cho ung vien (gia VND). bonus = diem tang them.
const CANDIDATE_TOPUP_PACKAGES = Object.freeze([
    { code: 'BASIC', name: 'Gói Cơ Bản', price: 20000, points: 20, bonus: 2, badge: '+2 Điểm thưởng' },
    { code: 'STANDARD', name: 'Gói Tiêu Chuẩn', price: 50000, points: 50, bonus: 10, popular: true, badge: 'Tặng +10 Điểm (Tổng 60 Điểm)' },
    { code: 'PRO', name: 'Gói Chuyên Nghiệp', price: 100000, points: 100, bonus: 30, badge: '+30 Điểm (Tổng 130 Điểm)' },
    { code: 'PREMIUM', name: 'Gói Cao Cấp', price: 200000, points: 200, bonus: 80, badge: 'Tặng 1 lượt Đẩy Top CV', perk: 'TOP_CV_BOOST' }
]);

// Cach nhan diem mien phi cho ung vien.
const CANDIDATE_EARN_RULES = Object.freeze({
    APPLY_JOB: 5, // nop CV vao mot tin (moi tin chi tinh mot lan)
    DAILY_CHECKIN: 1, // diem danh moi ngay
    PROFILE_COMPLETE: 20 // ho so dat 100% (chi mot lan)
});

// Bao cao canh tranh (mo hinh TopCV): dung diem de xem so luong & chan dung ung vien da nop.
const COMPETITION_REPORT = Object.freeze({
    unlockCost: toPositiveInt(process.env.COMPETITION_REPORT_COST, 10),
    validDays: toPositiveInt(process.env.COMPETITION_REPORT_VALID_DAYS, 30)
});

// Hang ung vien theo tong diem da tung nhan (lifetimeEarned).
const CANDIDATE_TIERS = Object.freeze([
    { code: 'BRONZE', name: 'Hạng Đồng', min: 0 },
    { code: 'SILVER', name: 'Hạng Bạc', min: 30 },
    { code: 'GOLD', name: 'Hạng Vàng', min: 150 },
    { code: 'DIAMOND', name: 'Hạng Kim Cương', min: 500 }
]);

// ===== JOBFIND REWARDS cho nha tuyen dung (mo hinh TopCV Rewards / Top Point) =====
// 1 Top Point cho moi 100.000 VND thanh toan thanh cong. Diem xet hang tinh trong 365 ngay.
const EMPLOYER_REWARDS = Object.freeze({
    vndPerPoint: toPositiveInt(process.env.TOP_POINT_VND_PER_POINT, 100000),
    rankWindowDays: 365,
    tiers: Object.freeze([
        { code: 'MEMBER', name: 'Thành viên', min: 0, multiplier: 1, perks: ['Tích 1 Top Point / 100.000đ'] },
        { code: 'SILVER', name: 'Hạng Bạc', min: 10, multiplier: 1.1, perks: ['+10% Top Point mỗi giao dịch', 'Ưu tiên hỗ trợ'] },
        { code: 'GOLD', name: 'Hạng Vàng', min: 50, multiplier: 1.2, perks: ['+20% Top Point mỗi giao dịch', 'Chuyên viên chăm sóc riêng'] },
        { code: 'DIAMOND', name: 'Hạng Kim Cương', min: 200, multiplier: 1.5, perks: ['+50% Top Point mỗi giao dịch', 'Quà tri ân hằng quý'] }
    ]),
    // Qua doi bang Top Point: cong truc tiep vao quyen loi cua cong ty.
    catalog: Object.freeze([
        { code: 'POST_1', name: '1 lượt đăng tin thường', cost: 3, allowanceField: 'allowPost', amount: 1, icon: 'fas fa-file-alt' },
        { code: 'HOT_POST_1', name: '1 lượt đăng tin nổi bật', cost: 6, allowanceField: 'allowHotPost', amount: 1, icon: 'fas fa-fire' },
        { code: 'CV_5', name: '5 lượt xem hồ sơ ứng viên', cost: 4, allowanceField: 'allowCv', amount: 5, icon: 'fas fa-id-card' },
        { code: 'CV_20', name: '20 lượt xem hồ sơ ứng viên', cost: 14, allowanceField: 'allowCv', amount: 20, icon: 'fas fa-users' }
    ])
});

// Ty gia quy doi khi goi dich vu cho nha tuyen dung dang niem yet bang USD.
const USD_VND_RATE = toPositiveInt(process.env.PAYMENT_USD_VND_RATE, 25000);

// Ma giam gia (co the ghi de bang PAYMENT_PROMO_CODES dang JSON).
const DEFAULT_PROMO_CODES = {
    VNPAY5K: { provider: 'VNPAY', discount: 5000, minAmount: 20000, description: 'Giảm 5.000đ khi thanh toán VNPAY-QR' },
    ARCHITECT5K: { provider: null, discount: 5000, minAmount: 20000, description: 'Ưu đãi Career Architect giảm 5.000đ' },
    MOMO5K: { provider: 'MOMO', discount: 5000, minAmount: 20000, description: 'Giảm 5.000đ khi thanh toán ví MoMo' },
    ZALOPAY5K: { provider: 'ZALOPAY', discount: 5000, minAmount: 20000, description: 'Giảm 5.000đ khi thanh toán ví ZaloPay' },
    JOBFIND10K: { provider: null, discount: 10000, minAmount: 50000, description: 'Giảm 10.000đ cho đơn từ 50.000đ' }
};
const loadPromoCodes = () => {
    if (!process.env.PAYMENT_PROMO_CODES) return DEFAULT_PROMO_CODES;
    try {
        const parsed = JSON.parse(process.env.PAYMENT_PROMO_CODES);
        return parsed && typeof parsed === 'object' ? parsed : DEFAULT_PROMO_CODES;
    } catch (error) {
        return DEFAULT_PROMO_CODES;
    }
};

const tierFor = (tiers, points) => {
    const value = Number(points) || 0;
    let index = 0;
    tiers.forEach((tier, position) => { if (value >= tier.min) index = position; });
    const current = tiers[index];
    const next = tiers[index + 1] || null;
    return {
        ...current,
        next: next ? { code: next.code, name: next.name, min: next.min, remaining: Math.max(0, next.min - value) } : null,
        progress: next ? Math.min(100, Math.round(((value - current.min) / (next.min - current.min)) * 100)) : 100
    };
};

module.exports = {
    POINT_VALUE_VND,
    CANDIDATE_TOPUP_PACKAGES,
    CANDIDATE_EARN_RULES,
    COMPETITION_REPORT,
    CANDIDATE_TIERS,
    EMPLOYER_REWARDS,
    USD_VND_RATE,
    loadPromoCodes,
    tierFor
};
