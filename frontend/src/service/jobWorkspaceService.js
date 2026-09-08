import axios from '../axios';
import { assertJobEditorIdentity } from './jobEditSession';
import { jobStatusLabel } from './jobFormAdapter';

const validId = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const nullableText = value => value === null || typeof value === 'string';
const validDate = value => value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
const validCount = value => Number.isSafeInteger(value) && value >= 0;
export const jobWorkspaceMode = user => {
    if (user?.roleCode === 'ADMIN') return 'legacy'; // Administration/manual decisions are not migrated by this flag.
    if (!['COMPANY', 'EMPLOYER'].includes(user?.roleCode) || !validId(user.id) || !validId(user.companyId)) throw new Error('Tài khoản hoặc công ty chưa hợp lệ');
    const mode = process.env.REACT_APP_JOB_WORKSPACE_MODE ?? 'legacy';
    if (!['legacy', 'core'].includes(mode)) throw new Error('Cấu hình danh sách/kiểm duyệt không hợp lệ; không tự chuyển luồng');
    return mode;
};
export const workspaceSelection = user => {
    try { return { mode: jobWorkspaceMode(user), error: '' }; }
    catch (error) { return { mode: null, error: error.message }; }
};
const paging = ({ limit = 5, offset = 0 } = {}) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
        throw new Error('Phân trang không hợp lệ');
    }
    return { limit, offset };
};
const options = signal => ({ timeout: 15000, ...(signal && { signal }) });
export const listManagedJobs = (query = {}, signal) => {
    const params = paging(query), search = query.search ?? '', statusCode = query.statusCode ?? '';
    if (typeof search !== 'string' || search.length > 255 || !['', 'PS1', 'PS2', 'PS3', 'PS4'].includes(statusCode)
        || Object.keys(query).some(key => !['limit', 'offset', 'search', 'statusCode'].includes(key))) throw new Error('Bộ lọc danh sách không hợp lệ');
    return axios.get(`/api/jobs/manage?${new URLSearchParams({ ...params, search, statusCode })}`, options(signal));
};
export const getManagedJobReview = (id, query = {}, signal) => {
    if (!validId(id) || Object.keys(query).some(key => !['limit', 'offset'].includes(key))) throw new Error('Tin hoặc phân trang không hợp lệ');
    return axios.get(`/api/jobs/${id}/review?${new URLSearchParams(paging(query))}`, options(signal));
};
const badResponse = () => new Error('Dữ liệu quản lý không đầy đủ hoặc không đúng công ty. Hãy tải lại; không tự chuyển sang nguồn khác');
const checkScope = user => {
    assertJobEditorIdentity(user);
    if (!['COMPANY', 'EMPLOYER'].includes(user.roleCode)) throw badResponse();
};
const checkPage = (rows, count, query) => {
    const { limit, offset } = paging(query);
    if (!Array.isArray(rows) || !validCount(count) || rows.length > limit || rows.length > Math.max(0, count - offset)
        || new Set(rows.map(row => String(row?.id))).size !== rows.length) throw badResponse();
};
// Normalize into the existing read-only table shape without inventing a revision
// or moderation provenance. Editing always rereads private detail separately.
export const readManagedJobList = (response, user, query) => {
    checkScope(user);
    if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Không đọc được danh sách qua Job Core');
    checkPage(response.data, response.count, query);
    const data = response.data.map(row => {
        if (!row || !validId(row.id) || !validId(row.userId) || !validId(row.companyId) || Number(row.companyId) !== Number(user.companyId)
            || !nullableText(row.name) || !nullableText(row.statusCode) || !nullableText(row.timeEnd) || !validDate(row.updatedAt)
            || ![null, 0, 1].includes(row.isHot) || !nullableText(row.authorFirstName) || !nullableText(row.authorLastName)
            || (query?.statusCode && row.statusCode !== query.statusCode)) throw badResponse();
        return { id: row.id, statusCode: row.statusCode, timeEnd: row.timeEnd,
            postDetailData: { name: row.name }, statusPostData: { code: row.statusCode, value: jobStatusLabel(row.statusCode) },
            userPostData: { firstName: row.authorFirstName, lastName: row.authorLastName } };
    });
    return { data, count: response.count };
};
export const reviewStateLabel = state => ({
    ai_requested: 'Đã gửi yêu cầu AI kiểm duyệt; chưa xác nhận worker đang xử lý.',
    ai_failed: 'Lần xử lý AI gặp lỗi. Đây không phải quyết định từ chối tin; vui lòng liên hệ hỗ trợ.',
    ai_applied: 'Kết quả AI đã được áp dụng cho bản tin hiện tại.',
    no_active_ai: 'Không có yêu cầu AI hiện hành. Theo dõi trạng thái tin và ghi chú thủ công bên dưới.',
    untracked: 'Chưa xác định được luồng kiểm duyệt hiện hành; không suy ra từ riêng trạng thái tin.'
}[state]);
export const readManagedJobReview = (response, id, user, query) => {
    checkScope(user);
    if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Không đọc được thông tin kiểm duyệt qua Job Core');
    const result = response.data, job = result?.job;
    if (!job || !validId(job.id) || String(job.id) !== String(id) || !validId(job.companyId) || Number(job.companyId) !== Number(user.companyId)
        || !nullableText(job.name) || !nullableText(job.statusCode) || typeof job.reviewState !== 'string' || !Object.prototype.hasOwnProperty.call({
            untracked: 1, no_active_ai: 1, ai_requested: 1, ai_failed: 1, ai_applied: 1 }, job.reviewState)
        || (['ai_requested', 'ai_failed'].includes(job.reviewState) && job.statusCode !== 'PS3')
        || (job.reviewState === 'ai_applied' && !['PS1', 'PS2'].includes(job.statusCode))) throw badResponse();
    checkPage(result.notes, result.count, query);
    const notes = result.notes.map(note => {
        if (!note || !validId(note.id) || !nullableText(note.note) || !validDate(note.createdAt)
            || !(note.authorId === null || validId(note.authorId)) || !nullableText(note.authorFirstName) || !nullableText(note.authorLastName)) throw badResponse();
        return { id: note.id, note: note.note, createdAt: note.createdAt,
            userNoteData: { id: note.authorId, firstName: note.authorFirstName, lastName: note.authorLastName } };
    });
    return { job: { id: job.id, name: job.name, statusCode: job.statusCode, reviewState: job.reviewState }, notes, count: result.count };
};
