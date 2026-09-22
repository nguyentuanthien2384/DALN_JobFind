// Shared validation for local registration, social onboarding and password changes.
export const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

export const isValidRecipientEmail = value => {
    const email = normalizeEmail(value);
    if (!email || email.length > 254) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const [localPart, domain] = parts;
    if (!localPart || localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.')
        || localPart.includes('..') || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)) return false;
    const labels = domain.split('.');
    if (domain.length > 253 || labels.length < 2 || !labels.every(label => label.length > 0
        && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return false;
    if (email === 'example@gmail.com') return false;
    if (['example.com', 'example.net', 'example.org'].some(reserved => domain === reserved || domain.endsWith(`.${reserved}`))) return false;
    return !['.example', '.invalid', '.test', '.local', '.localhost'].some(suffix => domain.endsWith(suffix));
};

export const validateNewPassword = value => {
    if (typeof value !== 'string' || Array.from(value).length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
    // bcrypt only processes its first 72 bytes; reject longer input instead of silently truncating it.
    if (Buffer.byteLength(value, 'utf8') > 72) return 'Mật khẩu không được vượt quá 72 byte (ký tự có dấu có thể chiếm nhiều byte)';
    return '';
};

export const validateRegistration = (data = {}) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
    const fieldErrors = {};
    for (const [field, label] of [['firstName', 'Họ'], ['lastName', 'Tên']]) {
        if (typeof data[field] !== 'string' || !data[field].trim() || Array.from(data[field].trim()).length > 100) {
            fieldErrors[field] = `${label} phải có từ 1 đến 100 ký tự`;
        }
    }
    if (typeof data.phonenumber !== 'string' || !/^\d{10}$/.test(data.phonenumber.trim())) fieldErrors.phonenumber = 'Số điện thoại phải gồm 10 chữ số';
    if (!isValidRecipientEmail(data.email)) fieldErrors.email = 'Email không hợp lệ hoặc không thể nhận thư';
    const passwordError = validateNewPassword(data.password);
    if (passwordError) fieldErrors.password = passwordError;
    return fieldErrors;
};
