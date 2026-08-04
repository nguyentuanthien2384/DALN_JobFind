// Gioi han so lan goi cho cac API cong khai (dang nhap, quen mat khau...).
//
// Khong co lop nay thi ke tan cong co the thu hang nghin mat khau moi phut ma
// khong gap tro ngai nao. Dem theo IP, luu trong bo nho - dung cho mot tien trinh;
// neu chay nhieu tien trinh thi chuyen sang Redis hoac express-rate-limit.

const buckets = new Map();

const getClientKey = (req) => {
    // req.ip da tinh den proxy neu app bat 'trust proxy'; fallback cho socket.
    return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
};

// windowMs: khoang thoi gian tinh; max: so lan toi da trong khoang do.
// countOnlyFailures: chi tinh cac lan that bai (dung cho dang nhap, de nhieu
// nguoi dung chung mot dia chi IP van dang nhap binh thuong).
const createRateLimiter = ({ windowMs, max, message, countOnlyFailures = false }) => {
    return (req, res, next) => {
        const key = `${req.path}|${getClientKey(req)}`;
        const now = Date.now();
        const entry = buckets.get(key);

        if (!entry || now > entry.resetAt) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
        } else {
            entry.count += 1;
            if (entry.count > max) {
                const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
                res.setHeader('Retry-After', retryAfter);
                return res.status(429).json({
                    errCode: 429,
                    errMessage: message || `Bạn thao tác quá nhanh, vui lòng thử lại sau ${retryAfter} giây`
                });
            }
        }

        if (countOnlyFailures) {
            // Controller tra ve 200 kem errCode ke ca khi sai mat khau, nen phai
            // xem noi dung tra ve moi biet lan goi nay thanh cong hay that bai.
            const originalJson = res.json.bind(res);
            res.json = (body) => {
                if (body && body.errCode === 0) {
                    const current = buckets.get(key);
                    if (current && current.count > 0) current.count -= 1;
                }
                return originalJson(body);
            };
        }
        return next();
    };
};

// Don dinh ky de Map khong phinh to theo so IP da tung goi.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets.entries()) {
        if (now > entry.resetAt) buckets.delete(key);
    }
}, 5 * 60 * 1000).unref();

const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    countOnlyFailures: true,
    message: 'Bạn đã đăng nhập sai quá nhiều lần, vui lòng thử lại sau ít phút'
});

// Kiem tra so dien thoai da ton tai chua: goi khi dang ky nen phai rong rai hon,
// nguoi dung go nham vai lan van khong bi khoa.
const phoneCheckLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút'
});

const otpLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Bạn đã yêu cầu mã xác thực quá nhiều lần, vui lòng thử lại sau ít phút'
});

const registerLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: 'Bạn đã tạo quá nhiều tài khoản, vui lòng thử lại sau'
});

module.exports = {
    createRateLimiter,
    loginLimiter,
    otpLimiter,
    registerLimiter,
    phoneCheckLimiter
};
