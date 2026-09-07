import { createJobRequestOptions, repostJob } from './jobPostingService';
import { reupPostService } from './userService';
import { JOB_CLASSIFICATIONS, isJobRevision, jobDeadlineDate } from './jobFormAdapter';
import { assertJobEditorIdentity, readCoreJobSnapshot, readCoreEditPending } from './jobEditSession';
import { readLegacyRepostAttempt, prepareLegacyRepostAttempt, assertPendingLegacyRepost,
    settleLegacyRepostAttempt, isLegacyRepostReceipt } from './legacyRepostAttempt';

const validId = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const scope = (user, id) => {
    if (![user?.id, user?.companyId, id].every(validId)) throw new Error('Tài khoản, công ty hoặc tin gốc không hợp lệ');
    return `${Number(user.id)}:${Number(user.companyId)}:${Number(id)}`;
};
const slot = (user, id) => 'jobfind:core-repost:v1:' + scope(user, id);
const codes = JOB_CLASSIFICATIONS.map(([, raw]) => raw);
const copiedFields = ['name', 'descriptionHTML', 'descriptionMarkdown', ...codes, 'amount', 'isHot'];
const nullableString = value => value === null || typeof value === 'string';
const validCopy = copy => copy && !Array.isArray(copy) && Object.keys(copy).length === copiedFields.length
    && copiedFields.every(field => Object.prototype.hasOwnProperty.call(copy, field))
    && typeof copy.name === 'string' && typeof copy.descriptionHTML === 'string' && nullableString(copy.descriptionMarkdown)
    && codes.every(field => nullableString(copy[field])) && [0, 1].includes(copy.isHot)
    && (copy.amount === null || (Number.isSafeInteger(copy.amount) && copy.amount > 0 && copy.amount <= 100000));
const changed = () => new Error('Thao tác đăng lại đã lưu thay đổi. Hãy tải lại để đối chiếu; không tạo mã mới');
const validate = (attempt, user, id) => {
    const body = attempt?.payload;
    if (attempt?.version !== 1 || attempt.writer !== 'core' || attempt.scope !== scope(user, id)
        || typeof attempt.key !== 'string' || !/^[a-f0-9]{32}$/.test(attempt.key)
        || !['pending', 'rejected', 'blocked', 'succeeded'].includes(attempt.status)
        || !body || Array.isArray(body) || Object.keys(body).length !== 2
        || !isJobRevision(body.expectedRevision) || !Number.isSafeInteger(body.timeEnd)
        || body.timeEnd <= 0 || body.timeEnd > 8640000000000000 || !validCopy(attempt.expected)
        || (attempt.status === 'succeeded' && (!validId(attempt.postId) || Number(attempt.postId) === Number(id)))) {
        throw new Error('Không đọc được thao tác đăng lại Job Core đã lưu. Hãy giữ thông tin và liên hệ hỗ trợ');
    }
    return attempt;
};
const readCore = (user, id) => {
    const raw = sessionStorage.getItem(slot(user, id));
    return raw === null ? null : validate(JSON.parse(raw), user, id);
};
const saveCore = (user, id, attempt) => {
    validate(attempt, user, id);
    const json = JSON.stringify(attempt), name = slot(user, id);
    sessionStorage.setItem(name, json);
    if (sessionStorage.getItem(name) !== json) throw new Error('Không giữ được mã đăng lại; chưa gửi yêu cầu');
    return JSON.parse(json);
};
const legacy = attempt => attempt ? { ...attempt, writer: 'legacy' } : null;
const untag = attempt => { if (!attempt) return attempt; const { writer, ...record } = attempt; return record; };
const same = (left, right) => left?.key === right?.key && left?.writer === right?.writer && left?.scope === right?.scope
    && JSON.stringify(left?.payload) === JSON.stringify(right?.payload) && JSON.stringify(left?.expected) === JSON.stringify(right?.expected);

export const jobRepostMode = () => {
    const mode = process.env.REACT_APP_JOB_REPOST_MODE ?? 'legacy';
    if (!['legacy', 'core'].includes(mode)) throw new Error('Cấu hình luồng đăng lại không hợp lệ. Vui lòng liên hệ quản trị viên');
    return mode;
};
export const readJobRepostAttempt = (user, id) => {
    let old, current;
    try { old = readLegacyRepostAttempt(user, id); current = readCore(user, id); }
    catch (error) {
        if (error instanceof SyntaxError) throw new Error('Không đọc được thao tác đăng lại đã lưu. Hãy giữ thông tin và liên hệ hỗ trợ');
        throw error;
    }
    if (old && current) throw new Error('Có thao tác ở cả hai luồng đăng lại. Hãy giữ thông tin và liên hệ hỗ trợ để đối chiếu');
    return current || legacy(old);
};

// Only for NEW/corrected intents. A replay must not depend on today's source,
// deadline, availability or revision. Never use the unsaved form as this copy.
export const coreRepostSource = (response, id, user, expectedRevision) => {
    const { form } = readCoreJobSnapshot(response, id, user);
    const deadline = jobDeadlineDate(form.timeEnd);
    if (!isJobRevision(expectedRevision) || form.editRevision !== expectedRevision
        || !['PS1', 'PS2', 'PS3'].includes(form.statusCode) || !deadline || deadline.getTime() > Date.now()) {
        throw new Error('Tin gốc đã thay đổi hoặc chưa đủ điều kiện đăng lại. Hãy giữ nội dung và tải lại tin trước khi tiếp tục');
    }
    return Object.fromEntries(copiedFields.map(field => [field, response.data[field]]));
};
export const prepareJobRepostAttempt = (user, id, payload, previous, mode, expected) => {
    assertJobEditorIdentity(user);
    if (user.roleCode === 'ADMIN') throw new Error('Màn hình quản trị chỉ xem tin, không đăng lại');
    if (readCoreEditPending(user, id)) throw new Error('Cần đối chiếu lần sửa Job Core trước khi tạo yêu cầu đăng lại mới');
    const current = readJobRepostAttempt(user, id);
    if ((current || previous) && (!same(current, previous) || current?.status !== 'rejected' || previous?.status !== 'rejected')) throw changed();
    const writer = current?.writer || mode;
    if (writer === 'legacy') return legacy(prepareLegacyRepostAttempt(user, id, payload, untag(previous)));
    if (writer !== 'core') throw new Error('Cấu hình luồng đăng lại không hợp lệ');
    return saveCore(user, id, { version: 1, writer: 'core', scope: scope(user, id),
        key: previous?.key || createJobRequestOptions().idempotencyKey,
        payload: { timeEnd: payload.timeEnd, expectedRevision: payload.expectedRevision }, expected, status: 'pending' });
};
export const assertPendingJobRepost = (user, id, sent) => {
    // Preserve the existing legacy account-change diagnostic before the stricter
    // editor role check; neither check is allowed to dispatch or mutate storage.
    if (sent.writer === 'legacy') assertPendingLegacyRepost(user, id, sent);
    assertJobEditorIdentity(user);
    const current = readJobRepostAttempt(user, id);
    if (!current || !same(current, sent) || !['pending', 'succeeded'].includes(current.status)) throw changed();
};
export const sendJobRepostAttempt = (user, id, sent) => {
    assertPendingJobRepost(user, id, sent);
    return sent.writer === 'core'
        ? repostJob(id, sent.payload.timeEnd, { idempotencyKey: sent.key, expectedRevision: sent.payload.expectedRevision })
        : reupPostService(sent.payload, { idempotencyKey: sent.key });
};
export const settleJobRepostAttempt = (user, id, sent, patch) => {
    const current = readJobRepostAttempt(user, id);
    if (!current || !same(current, sent)) throw changed();
    if (sent.writer === 'legacy') return legacy(settleLegacyRepostAttempt(user, id, untag(sent), patch));
    // Late completion may settle only its original record, never another view's
    // intent. A late failure cannot erase confirmation or malformed-success evidence.
    if (['succeeded', 'blocked'].includes(current.status)) return current;
    return saveCore(user, id, { ...sent, ...patch });
};
export const isCoreRepostReceipt = (response, id, sent, user) => {
    const job = response?.data;
    // Core returns the ORIGINAL accepted snapshot, not current moderation state.
    // idempotencyKey from the transport helper is a CLIENT echo, not server proof.
    return response?.errCode === 0 && job && !Array.isArray(job) && validId(job.id) && Number(job.id) !== Number(id)
        && validId(job.userId) && Number(job.userId) === Number(user.id)
        && validId(job.companyId) && Number(job.companyId) === Number(user.companyId)
        && sent.scope === scope(user, id) && job.statusCode === 'PS3'
        && validId(job.timeEnd) && String(job.timeEnd) === String(sent.payload.timeEnd)
        && validCopy(sent.expected) && copiedFields.every(field => job[field] === sent.expected[field]);
};
export const jobRepostOutcome = (response, id, sent, user) => {
    if (sent.writer === 'core' ? isCoreRepostReceipt(response, id, sent, user) : isLegacyRepostReceipt(response, sent)) {
        return { status: 'succeeded', postId: Number(sent.writer === 'core' ? response.data.id : response.postId) };
    }
    if (response?.errCode === 0) return { status: 'blocked' };
    const uncertain = response?.httpStatus >= 500 || ['network', 'timeout', 'cancelled', 'unavailable', 'server', 'unknown'].includes(response?.errorType);
    if (sent.writer === 'legacy') {
        if (response?.conflict || response?.httpStatus === 409 || response?.errorType === 'conflict'
            || ([1, 2, 3].includes(response?.errCode) && !uncertain)) return { status: 'rejected' };
    } else if (!uncertain && [400, 403, 409, 413, 415, 422, 429].includes(response?.httpStatus)) return { status: 'rejected' };
    return { status: 'pending' };
};
