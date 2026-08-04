// Kho luu ma OTP dat lai mat khau.
//
// Ma OTP song rat ngan (5 phut) nen giu trong bo nho la du: khong can them bang
// va migration, va neu server restart thi nguoi dung chi can bam "Gui lai ma".
// Neu sau nay chay nhieu tien trinh (pm2 cluster) thi doi cho luu nay sang Redis,
// vi moi tien trinh dang giu mot Map rieng.

const OTP_TTL_MS = 5 * 60 * 1000;      // ma het han sau 5 phut
const RESEND_COOLDOWN_MS = 60 * 1000;  // cho 60s moi duoc gui lai
const MAX_ATTEMPTS = 5;                // nhap sai 5 lan thi huy ma

const store = new Map();

// Don cac ma da het han, tranh Map phinh to theo thoi gian.
const purgeExpired = () => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
        if (entry.expiresAt <= now) {
            store.delete(key);
        }
    }
};

const generateCode = () => String(Math.floor(100000 + Math.random() * 900000));

// Tra ve { code, error } - error khac null nghia la chua duoc phep gui.
const issueOtp = (phonenumber) => {
    purgeExpired();
    const existing = store.get(phonenumber);
    if (existing && Date.now() - existing.issuedAt < RESEND_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.issuedAt)) / 1000);
        return { code: null, waitSeconds };
    }

    const code = generateCode();
    store.set(phonenumber, {
        code,
        issuedAt: Date.now(),
        expiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0
    });
    return { code, waitSeconds: 0 };
};

// Tra ve { valid, errMessage }. Ma dung se bi xoa ngay de khong dung lai duoc lan hai.
const verifyOtp = (phonenumber, code) => {
    purgeExpired();
    const entry = store.get(phonenumber);
    if (!entry) {
        return { valid: false, errMessage: 'Mã xác thực không đúng hoặc đã hết hạn' };
    }
    if (entry.attempts >= MAX_ATTEMPTS) {
        store.delete(phonenumber);
        return { valid: false, errMessage: 'Bạn đã nhập sai quá nhiều lần, vui lòng yêu cầu mã mới' };
    }
    if (String(entry.code) !== String(code)) {
        entry.attempts += 1;
        return { valid: false, errMessage: 'Mã xác thực không đúng hoặc đã hết hạn' };
    }
    store.delete(phonenumber);
    return { valid: true };
};

const clearOtp = (phonenumber) => store.delete(phonenumber);

module.exports = {
    issueOtp,
    verifyOtp,
    clearOtp,
    OTP_TTL_MS,
    RESEND_COOLDOWN_MS
};
