import { JOB_CLASSIFICATIONS, jobToForm, buildJobUpdate, isJobRevision, jobDeadlineDate } from './jobFormAdapter';
import { createJobRequestOptions } from './jobPostingService';

const validId = value => ['number', 'string'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const textFields = ['name', 'descriptionHTML', 'descriptionMarkdown'];
const editFields = [...textFields, ...JOB_CLASSIFICATIONS.map(([field]) => field), 'amount'];
const identity = user => {
    if (!validId(user?.id) || !['ADMIN', 'COMPANY', 'EMPLOYER'].includes(user.roleCode)
        || (user.roleCode !== 'ADMIN' && !validId(user.companyId))) throw new Error('Tài khoản hoặc công ty chưa hợp lệ để quản lý tin');
    return `${Number(user.id)}:${validId(user.companyId) ? Number(user.companyId) : 0}:${user.roleCode}`;
};
const scope = (user, id) => {
    identity(user);
    if (!validId(id)) throw new Error('Mã tin không hợp lệ');
    return `${Number(user.id)}:${validId(user.companyId) ? Number(user.companyId) : 0}:${Number(id)}`;
};
const slot = (user, id) => 'jobfind:core-edit:v1:' + scope(user, id);
const mismatch = () => new Error('Thao tác sửa đã lưu thay đổi. Hãy giữ nội dung và tải lại để đối chiếu');
export const jobEditMode = () => {
    const mode = process.env.REACT_APP_JOB_EDIT_MODE ?? 'legacy';
    if (!['legacy', 'core'].includes(mode)) throw new Error('Cấu hình luồng xem/sửa tin không hợp lệ. Vui lòng liên hệ quản trị viên');
    return mode;
};
export const assertJobEditorIdentity = user => {
    let current;
    try { current = JSON.parse(localStorage.getItem('userData')); } catch { /* checked below */ }
    if (identity(current) !== identity(user)) throw new Error('Tài khoản hoặc công ty đã thay đổi. Hãy tải lại trước khi tiếp tục');
};

// Do not let a public/partial/foreign-tenant response become an editing baseline.
// Unknown historical codes and nullable optional data are preserved, not filled.
export const readCoreJobSnapshot = (response, id, user) => {
    identity(user);
    const job = response?.data;
    const nullableString = value => value === null || typeof value === 'string';
    if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Không đọc được tin qua Job Core');
    if (!job || Array.isArray(job) || !validId(job.id) || String(job.id) !== String(id)
        || !['PS1', 'PS2', 'PS3', 'PS4'].includes(job.statusCode) || ![0, 1].includes(job.isHot)
        || typeof job.name !== 'string' || typeof job.descriptionHTML !== 'string' || !nullableString(job.descriptionMarkdown)
        || !(job.amount === null || (Number.isSafeInteger(job.amount) && job.amount > 0 && job.amount <= 100000))
        || !JOB_CLASSIFICATIONS.every(([, raw]) => nullableString(job[raw]))
        || !(job.timeEnd === null || ['number', 'string'].includes(typeof job.timeEnd))
        || !(job.userId === null || validId(job.userId)) || !(job.companyId === null || validId(job.companyId))
        || (user.roleCode !== 'ADMIN' && (!validId(job.userId) || Number(job.companyId) !== Number(user.companyId)))) {
        throw new Error('Dữ liệu quản lý tin không đầy đủ hoặc không khớp tài khoản/công ty. Không thể sửa an toàn');
    }
    return { form: jobToForm(job), ownerId: job.userId, companyId: job.companyId };
};
const validate = (record, user, id) => {
    const base = record?.base, draft = record?.draft;
    const form = base?.form;
    if (record?.version !== 1 || record.writer !== 'core' || record.scope !== scope(user, id)
        || typeof record.attemptId !== 'string' || !/^[a-f0-9]{32}$/.test(record.attemptId)
        || !form || form.isActionADD !== false || String(form.id) !== String(id)
        || !validId(base.ownerId) || Number(base.companyId) !== Number(user.companyId)
        || !isJobRevision(form.editRevision) || !jobDeadlineDate(form.timeEnd)
        || !['PS1', 'PS2', 'PS3'].includes(form.statusCode) || ![0, 1].includes(form.isHot)
        || !editFields.every(field => typeof form[field] === 'string')
        || !draft || !editFields.every(field => typeof draft[field] === 'string')
        || ['id', 'timeEnd', 'isHot', 'editRevision', 'statusCode', 'isActionADD'].some(field => draft[field] !== form[field])) throw mismatch();
    const patch = buildJobUpdate(draft, form);
    if (!patch || JSON.stringify(patch) !== JSON.stringify(record.patch)) throw mismatch();
    return record;
};
export const readCoreEditPending = (user, id) => {
    const raw = sessionStorage.getItem(slot(user, id));
    if (raw === null) return null;
    try { return validate(JSON.parse(raw), user, id); }
    catch { throw new Error('Không đọc được lần sửa Job Core đã lưu. Hãy giữ thông tin và liên hệ hỗ trợ; không chuyển luồng để gửi lại'); }
};
export const prepareCoreEditPending = (user, base, values) => {
    assertJobEditorIdentity(user);
    if (user.roleCode === 'ADMIN') throw new Error('Màn hình quản trị chỉ xem tin, không sửa nội dung');
    const id = base?.form?.id;
    if (readCoreEditPending(user, id)) throw mismatch();
    const patch = buildJobUpdate(values, base.form);
    if (!patch) return null;
    const draft = { ...base.form, ...Object.fromEntries(editFields.map(field => [field, values[field]])) };
    // This ID is only a local compare-and-swap token, NOT HTTP idempotency.
    const record = validate({ version: 1, writer: 'core', scope: scope(user, id),
        attemptId: createJobRequestOptions().idempotencyKey, base, draft, patch }, user, id);
    const json = JSON.stringify(record), key = slot(user, id);
    sessionStorage.setItem(key, json);
    if (sessionStorage.getItem(key) !== json) throw new Error('Không giữ được nội dung trước khi sửa; chưa gửi yêu cầu');
    return JSON.parse(json);
};
export const assertCoreEditPending = (user, sent) => {
    assertJobEditorIdentity(user);
    const current = readCoreEditPending(user, sent.base.form.id);
    if (JSON.stringify(current) !== JSON.stringify(sent)) throw mismatch();
};
export const clearCoreEditPending = (user, id, expected) => {
    // A late valid response may finish its ORIGINAL scoped record after unmount
    // or account change. It must never delete a newer request's evidence.
    const current = readCoreEditPending(user, id);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw mismatch();
    sessionStorage.removeItem(slot(user, id));
    if (readCoreEditPending(user, id)) throw new Error('Chưa đối chiếu được lần sửa đã lưu. Vui lòng tải lại');
};
export const acceptCoreEditResponse = (response, sent, user) => {
    const next = readCoreJobSnapshot(response, sent.base.form.id, user);
    const { form } = next;
    if (String(next.ownerId) !== String(sent.base.ownerId) || String(next.companyId) !== String(sent.base.companyId)
        || String(form.timeEnd) !== String(sent.base.form.timeEnd) || form.isHot !== sent.base.form.isHot
        || !isJobRevision(form.editRevision) || form.editRevision === sent.base.form.editRevision || form.statusCode !== 'PS3'
        || editFields.some(field => field === 'amount' ? Number(form[field]) !== Number(sent.draft[field]) : form[field] !== sent.draft[field])) {
        throw new Error('Phản hồi sửa tin không khớp nội dung hoặc phiên bản đã gửi. Hãy tải lại để đối chiếu');
    }
    return next;
};
