import { createJobRequestOptions } from './jobPostingService';

const prefix = 'jobfind:legacy-create:v1:';
const payloadFields = ['userId', 'name', 'descriptionHTML', 'descriptionMarkdown', 'categoryJobCode', 'addressCode',
    'salaryJobCode', 'amount', 'timeEnd', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode', 'isHot'];
const validId = id => ['string', 'number'].includes(typeof id) && /^[1-9][0-9]*$/.test(String(id)) && Number.isSafeInteger(Number(id));
const scope = user => {
    if (!validId(user?.id) || !validId(user?.companyId)) throw new Error('Cần đăng nhập và chọn công ty hợp lệ trước khi đăng tin');
    return `${Number(user.id)}:${Number(user.companyId)}`;
};
const validate = (attempt, user) => {
    if (attempt?.version !== 1 || attempt.scope !== scope(user)
        || typeof attempt.key !== 'string' || !/^[a-f0-9]{32}$/.test(attempt.key) || !['pending', 'rejected', 'succeeded', 'blocked'].includes(attempt.status)
        || !attempt.payload || typeof attempt.payload !== 'object' || Array.isArray(attempt.payload)
        || Object.keys(attempt.payload).some(field => !payloadFields.includes(field))
        || Number(attempt.payload.userId) !== Number(user.id)
        || !Number.isSafeInteger(attempt.payload.timeEnd) || attempt.payload.timeEnd <= 0 || attempt.payload.timeEnd > 8640000000000000
        || (attempt.status === 'succeeded' && !validId(attempt.postId))) {
        throw new Error('Không đọc được thao tác đăng tin đã lưu. Hãy giữ nội dung và liên hệ hỗ trợ; không tạo lại khi chưa đối chiếu kết quả');
    }
    return attempt;
};

// Session storage survives refresh/remount in this tab (including auth expiry).
// It stores the submitted job, NOT tokens/CVs. Never expire/delete an unresolved
// attempt automatically. Independently opened tabs represent separate intents.
export const readLegacyCreateAttempt = user => {
    const raw = sessionStorage.getItem(prefix + scope(user));
    return raw === null ? null : validate(JSON.parse(raw), user);
};
export const saveLegacyCreateAttempt = (user, attempt) => {
    validate(attempt, user);
    const json = JSON.stringify(attempt), name = prefix + scope(user);
    sessionStorage.setItem(name, json);
    if (sessionStorage.getItem(name) !== json) throw new Error('Không lưu được mã thao tác; chưa gửi tin');
    return JSON.parse(json);
};
export const prepareLegacyCreateAttempt = (user, payload, previous) => {
    const current = readLegacyCreateAttempt(user);
    if ((current?.key || null) !== (previous?.key || null) ||
        (current && (current.status !== 'rejected' || JSON.stringify(current.payload) !== JSON.stringify(previous.payload)))) {
        throw new Error('Đã có thao tác đang lưu. Hãy tải lại để đối chiếu; không tạo mã mới');
    }
    if (previous && previous.status !== 'rejected') throw new Error('Cần đối chiếu thao tác trước khi gửi nội dung mới');
    // Even after a definite rejection, editing keeps the SAME key. A concurrent
    // accepted request will cause 409 instead of another post/charge.
    return saveLegacyCreateAttempt(user, { version: 1, scope: scope(user),
        key: previous?.key || createJobRequestOptions().idempotencyKey,
        payload: JSON.parse(JSON.stringify(payload)), status: 'pending' });
};
export const settleLegacyCreateAttempt = (user, sent, patch) => {
    const current = readLegacyCreateAttempt(user);
    if (!current || current.key !== sent.key || JSON.stringify(current.payload) !== JSON.stringify(sent.payload)) {
        throw new Error('Thao tác đang lưu đã thay đổi; hãy tải lại để đối chiếu');
    }
    // A late rejection must never overwrite a receipt already confirmed by a retry.
    return current.status === 'succeeded' ? current : saveLegacyCreateAttempt(user, { ...sent, ...patch });
};
export const clearSuccessfulLegacyCreate = user => {
    if (readLegacyCreateAttempt(user)?.status !== 'succeeded') throw new Error('Chưa xác nhận được tin đã tạo');
    sessionStorage.removeItem(prefix + scope(user));
    if (readLegacyCreateAttempt(user)) throw new Error('Không thể bắt đầu thao tác mới');
};
export const assertLegacyCreateIdentity = user => {
    let current;
    try { current = JSON.parse(localStorage.getItem('userData')); } catch { /* checked below */ }
    if (scope(current) !== scope(user)) throw new Error('Tài khoản hoặc công ty đã thay đổi. Hãy tải lại trang trước khi tiếp tục');
};
export const assertPendingLegacyCreate = (user, sent) => {
    assertLegacyCreateIdentity(user);
    const current = readLegacyCreateAttempt(user);
    if (!current || current.key !== sent.key || JSON.stringify(current.payload) !== JSON.stringify(sent.payload)
        || !['pending', 'succeeded'].includes(current.status)) {
        throw new Error('Thao tác đang lưu đã thay đổi. Hãy tải lại để đối chiếu trước khi gửi');
    }
};
export const isLegacyCreateReceipt = (response, attempt) => response?.errCode === 0
    && response.idempotencyKey === attempt.key && typeof response.replayed === 'boolean' && validId(response.postId);
