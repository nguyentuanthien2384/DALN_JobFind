import { createJobRequestOptions, createJob } from './jobPostingService';
import { createPostService } from './userService';
import { readLegacyCreateAttempt, prepareLegacyCreateAttempt, settleLegacyCreateAttempt,
    clearSuccessfulLegacyCreate, assertLegacyCreateIdentity, assertPendingLegacyCreate,
    isLegacyCreateReceipt } from './legacyCreateAttempt';

const prefix = 'jobfind:core-create:v1:';
const textFields = ['name', 'descriptionHTML', 'descriptionMarkdown', 'categoryJobCode'];
const codeFields = ['addressCode', 'salaryJobCode', 'categoryJoblevelCode', 'categoryWorktypeCode',
    'experienceJobCode', 'genderPostCode'];
const fields = [...textFields, ...codeFields, 'amount', 'timeEnd', 'isHot'];
const validId = id => ['string', 'number'].includes(typeof id) && /^[1-9][0-9]*$/.test(String(id)) && Number.isSafeInteger(Number(id));
const scope = user => {
    if (!validId(user?.id) || !validId(user?.companyId)) throw new Error('Cần đăng nhập và chọn công ty hợp lệ trước khi đăng tin');
    return `${Number(user.id)}:${Number(user.companyId)}`;
};
const changed = () => new Error('Thao tác đang lưu đã thay đổi. Hãy tải lại để đối chiếu; không tạo mã mới');
const validateCore = (attempt, user) => {
    const body = attempt?.payload;
    if (attempt?.version !== 1 || attempt.writer !== 'core' || attempt.scope !== scope(user)
        || typeof attempt.key !== 'string' || !/^[a-f0-9]{32}$/.test(attempt.key)
        || !['pending', 'rejected', 'succeeded', 'blocked'].includes(attempt.status)
        || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).length !== fields.length || Object.keys(body).some(field => !fields.includes(field))
        || textFields.some(field => typeof body[field] !== 'string')
        || codeFields.some(field => body[field] !== null && typeof body[field] !== 'string')
        || !['number', 'string'].includes(typeof body.amount) || (typeof body.amount === 'number' && !Number.isFinite(body.amount))
        || ![0, 1].includes(body.isHot) || !Number.isSafeInteger(body.timeEnd) || body.timeEnd <= 0 || body.timeEnd > 8640000000000000
        || (attempt.status === 'succeeded' && !validId(attempt.postId))) {
        throw new Error('Không đọc được thao tác Job Core đã lưu. Hãy giữ nội dung và liên hệ hỗ trợ trước khi tạo thêm');
    }
    return attempt;
};
const readCore = user => {
    const raw = sessionStorage.getItem(prefix + scope(user));
    return raw === null ? null : validateCore(JSON.parse(raw), user);
};
const saveCore = (user, attempt) => {
    validateCore(attempt, user);
    const json = JSON.stringify(attempt), name = prefix + scope(user);
    sessionStorage.setItem(name, json);
    if (sessionStorage.getItem(name) !== json) throw new Error('Không lưu được mã thao tác; chưa gửi tin');
    return JSON.parse(json);
};
const legacy = attempt => attempt ? { ...attempt, writer: 'legacy' } : null;
const same = (left, right) => left?.key === right?.key && left?.writer === right?.writer
    && left?.scope === right?.scope && JSON.stringify(left?.payload) === JSON.stringify(right?.payload);

// Build-time rollout switch, never a fallback based on availability or errors.
// Existing attempts take precedence even after this switch changes or is invalid.
export const jobCreateMode = () => {
    const mode = process.env.REACT_APP_JOB_CREATE_MODE ?? 'legacy';
    if (!['legacy', 'core'].includes(mode)) throw new Error('Cấu hình luồng đăng tin không hợp lệ. Vui lòng liên hệ quản trị viên');
    return mode;
};
export const readJobCreateAttempt = user => {
    let old, current;
    try { old = readLegacyCreateAttempt(user); current = readCore(user); }
    catch (error) {
        if (error instanceof SyntaxError) throw new Error('Không đọc được thao tác đăng tin đã lưu. Hãy giữ thông tin và liên hệ hỗ trợ để đối chiếu');
        throw error;
    }
    // Includes rejected/succeeded intents: do not discard evidence or choose one
    // arbitrarily if an older client created a second intent during rollback.
    if (old && current) throw new Error('Có thao tác ở cả hai luồng đăng tin. Hãy giữ thông tin và liên hệ hỗ trợ để đối chiếu');
    return current || legacy(old);
};
export const prepareJobCreateAttempt = (user, payload, previous, mode) => {
    assertLegacyCreateIdentity(user);
    const current = readJobCreateAttempt(user);
    if ((current || previous) && (!same(current, previous) || current?.status !== 'rejected' || previous?.status !== 'rejected')) throw changed();
    const writer = current?.writer || mode;
    if (writer === 'legacy') return legacy(prepareLegacyCreateAttempt(user, payload, previous));
    if (writer !== 'core') throw new Error('Cấu hình luồng đăng tin không hợp lệ');
    // Explicit allowlist; identity/ownership/status/revision are never sent from
    // the legacy form. Optional empty codes match Core's normalization.
    const body = { ...Object.fromEntries(textFields.map(field => [field, payload[field] ?? ''])),
        ...Object.fromEntries(codeFields.map(field => [field, payload[field] || null])),
        amount: payload.amount === '' ? 1 : payload.amount, timeEnd: Number(payload.timeEnd), isHot: payload.isHot };
    return saveCore(user, { version: 1, writer: 'core', scope: scope(user),
        key: previous?.key || createJobRequestOptions().idempotencyKey, payload: body, status: 'pending' });
};
export const assertPendingJobCreate = (user, sent) => {
    assertLegacyCreateIdentity(user);
    const current = readJobCreateAttempt(user);
    if (!current || !same(current, sent) || !['pending', 'succeeded'].includes(current.status)) throw changed();
    if (sent.writer === 'legacy') assertPendingLegacyCreate(user, sent);
};
export const sendJobCreateAttempt = (user, sent) => {
    assertPendingJobCreate(user, sent);
    // The saved writer is the only dispatch authority. No reread of the flag,
    // automatic retry, alternative endpoint, or newly generated key here.
    const send = sent.writer === 'core' ? createJob : createPostService;
    return send(sent.payload, { idempotencyKey: sent.key });
};
export const settleJobCreateAttempt = (user, sent, patch) => {
    const current = readJobCreateAttempt(user);
    if (!current || !same(current, sent)) throw changed();
    if (sent.writer === 'legacy') return legacy(settleLegacyCreateAttempt(user, sent, patch));
    // Late errors cannot erase either a confirmed receipt or a malformed-success
    // warning. Persist before checking whether the original view still exists.
    if (['succeeded', 'blocked'].includes(current.status)) return current;
    return saveCore(user, { ...sent, ...patch });
};
export const clearSuccessfulJobCreate = (user, expected) => {
    assertLegacyCreateIdentity(user);
    const current = readJobCreateAttempt(user);
    if (!current || current.status !== 'succeeded' || !same(current, expected) || current.postId !== expected.postId) throw changed();
    if (current.writer === 'legacy') return clearSuccessfulLegacyCreate(user);
    sessionStorage.removeItem(prefix + scope(user));
    if (readJobCreateAttempt(user)) throw new Error('Không thể bắt đầu thao tác mới');
};

// Core returns the ORIGINAL accepted snapshot, including after moderation or
// expiry. Its helper's idempotencyKey is a CLIENT echo, not a server receipt.
// Check the server snapshot against the saved identity and normalized input;
// do not infer current public visibility, editRevision or a replayed flag.
export const isCoreCreateReceipt = (response, sent, user) => {
    const job = response?.data, body = sent.payload;
    return response?.errCode === 0 && job && !Array.isArray(job) && validId(job.id)
        && validId(job.userId) && Number(job.userId) === Number(user.id)
        && validId(job.companyId) && Number(job.companyId) === Number(user.companyId)
        && sent.scope === scope(user) && job.statusCode === 'PS3'
        && textFields.every(field => job[field] === body[field])
        && codeFields.every(field => job[field] === body[field])
        && validId(job.amount) && Number(job.amount) === Number(body.amount)
        && validId(job.timeEnd) && String(job.timeEnd) === String(body.timeEnd)
        && job.isHot === body.isHot;
};
export const jobCreateOutcome = (response, sent, user) => {
    if (sent.writer === 'legacy') {
        if (isLegacyCreateReceipt(response, sent)) return { status: 'succeeded', postId: Number(response.postId) };
        if (response?.errCode === 0 || response?.httpStatus === 409 || response?.conflict || response?.errorType === 'conflict') return { status: 'blocked' };
        if ([1, 2, 3].includes(response?.errCode) && !(response.httpStatus >= 500)
            && !['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(response.errorType)) return { status: 'rejected' };
    } else {
        if (isCoreCreateReceipt(response, sent, user)) return { status: 'succeeded', postId: Number(response.data.id) };
        if (response?.errCode === 0) return { status: 'blocked' };
        // Core uses transport status, not legacy business codes. 409 also covers
        // exhausted quota. Allow corrections ONLY with this same key and writer;
        // an already accepted different input will keep conflicting, not charge.
        if ([400, 403, 409, 413, 415, 422, 429].includes(response?.httpStatus)
            && !['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(response.errorType)) return { status: 'rejected' };
    }
    // Auth expiry, missing route, timeout and 5xx retain the exact pending intent.
    return { status: 'pending' };
};
