import { createJobRequestOptions } from './jobPostingService';
import { isJobRevision } from './jobFormAdapter';
import { assertLegacyCreateIdentity as assertPostingIdentity } from './legacyCreateAttempt';

const validId = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const scope = (user, sourceId) => {
    if (![user?.id, user?.companyId, sourceId].every(validId)) throw new Error('Tài khoản, công ty hoặc tin gốc không hợp lệ');
    return `${Number(user.id)}:${Number(user.companyId)}:${Number(sourceId)}`;
};
const name = (user, sourceId) => 'jobfind:legacy-repost:v1:' + scope(user, sourceId);
const validate = (attempt, user, sourceId) => {
    const payload = attempt?.payload;
    if (attempt?.version !== 1 || attempt.scope !== scope(user, sourceId)
        || typeof attempt.key !== 'string' || !/^[a-f0-9]{32}$/.test(attempt.key)
        || !['pending', 'rejected', 'blocked', 'succeeded'].includes(attempt.status)
        || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== 4 || Object.keys(payload).some(field => !['userId', 'postId', 'timeEnd', 'expectedRevision'].includes(field))
        || !validId(payload.userId) || Number(payload.userId) !== Number(user.id)
        || !validId(payload.postId) || Number(payload.postId) !== Number(sourceId)
        || !Number.isSafeInteger(payload.timeEnd) || payload.timeEnd <= 0 || payload.timeEnd > 8640000000000000
        || !isJobRevision(payload.expectedRevision)
        || (attempt.status === 'succeeded' && (!validId(attempt.postId) || Number(attempt.postId) === Number(sourceId)))) {
        throw new Error('Không đọc được thao tác đăng lại đã lưu. Hãy giữ thông tin và liên hệ hỗ trợ trước khi đăng lại');
    }
    return attempt;
};

// Only the submitted source/revision/deadline, never the unsaved edit form,
// tokens or CVs. Keep unresolved requests and successful receipts across reload
// in this tab. Separate tabs/devices and different keys are separate intents.
export const readLegacyRepostAttempt = (user, sourceId) => {
    const raw = sessionStorage.getItem(name(user, sourceId));
    return raw === null ? null : validate(JSON.parse(raw), user, sourceId);
};
const save = (user, sourceId, attempt) => {
    validate(attempt, user, sourceId);
    const json = JSON.stringify(attempt), slot = name(user, sourceId);
    sessionStorage.setItem(slot, json);
    if (sessionStorage.getItem(slot) !== json) throw new Error('Không lưu được mã thao tác; chưa gửi yêu cầu đăng lại');
    return JSON.parse(json);
};
export const prepareLegacyRepostAttempt = (user, sourceId, payload, previous) => {
    assertPostingIdentity(user);
    const current = readLegacyRepostAttempt(user, sourceId);
    if ((current?.key || null) !== (previous?.key || null)
        || (current && (current.status !== 'rejected' || JSON.stringify(current.payload) !== JSON.stringify(previous.payload)))
        || (previous && previous.status !== 'rejected')) {
        throw new Error('Đã có thao tác đăng lại đang lưu. Hãy tải lại để đối chiếu, không tạo mã mới');
    }
    // Corrections after rejection still use the original key. If an earlier
    // copy actually committed, changed intent will conflict, not charge again.
    return save(user, sourceId, { version: 1, scope: scope(user, sourceId), key: previous?.key || createJobRequestOptions().idempotencyKey,
        payload: JSON.parse(JSON.stringify(payload)), status: 'pending' });
};
export const assertPendingLegacyRepost = (user, sourceId, sent) => {
    assertPostingIdentity(user);
    const current = readLegacyRepostAttempt(user, sourceId);
    if (!current || current.key !== sent.key || JSON.stringify(current.payload) !== JSON.stringify(sent.payload)
        || !['pending', 'succeeded'].includes(current.status)) throw new Error('Thao tác đã lưu thay đổi. Hãy tải lại trước khi đối chiếu');
};
export const settleLegacyRepostAttempt = (user, sourceId, sent, patch) => {
    const current = readLegacyRepostAttempt(user, sourceId);
    if (!current || current.key !== sent.key || JSON.stringify(current.payload) !== JSON.stringify(sent.payload)) {
        throw new Error('Thao tác đã lưu thay đổi. Hãy tải lại để đối chiếu');
    }
    return current.status === 'succeeded' ? current : save(user, sourceId, { ...sent, ...patch });
};
export const isLegacyRepostReceipt = (response, sent) => response?.errCode === 0 && response.idempotencyKey === sent.key
    && typeof response.replayed === 'boolean' && validId(response.postId) && validId(response.sourcePostId)
    && Number(response.sourcePostId) === Number(sent.payload.postId) && Number(response.postId) !== Number(sent.payload.postId);
