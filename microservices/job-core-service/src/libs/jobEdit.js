import { assertTransactionalPostingTables } from './postingQuota.js';

export const DETAIL_FIELDS = Object.freeze([
    'name', 'descriptionHTML', 'descriptionMarkdown', 'categoryJobCode', 'addressCode',
    'salaryJobCode', 'amount', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode'
]);

export class JobEditError extends Error {
    constructor(message, statusCode = 409) { super(message); this.statusCode = statusCode; }
}

// Current locking reads, in the same user -> company -> post order as posting.
// The preliminary snapshot is ONLY a hint for which author row to lock.
export const lockJobForEdit = async (conn, initial, { userId, companyId, roleCode }) => {
    await assertTransactionalPostingTables(conn);
    const ids = [...new Set([userId, initial.userId].filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new JobEditError('Danh tính người sửa tin không hợp lệ', 403);
    const [users] = await conn.query(`SELECT id, companyId FROM users WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, ids);
    const actor = users.find(user => user.id === userId);
    const owner = users.find(user => user.id === initial.userId);
    const admin = roleCode === 'ADMIN';
    if (!actor || (!admin && (!companyId || actor.companyId !== companyId || owner?.companyId !== companyId))) {
        throw new JobEditError('Bạn không có quyền sửa tin hoặc thông tin công ty đã thay đổi', 403);
    }
    if (owner?.companyId) {
        const [[company]] = await conn.query('SELECT id, statusCode, censorCode FROM companies WHERE id = ? FOR UPDATE', [owner.companyId]);
        if (!admin && (!company || company.statusCode !== 'S1' || company.censorCode !== 'CS1')) {
            throw new JobEditError('Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại', 403);
        }
    }
    const [[post]] = await conn.query('SELECT id, userId, detailPostId, statusCode, timeEnd, isHot FROM posts WHERE id = ? FOR UPDATE', [initial.id]);
    if (!post || post.statusCode === 'PS4') throw new JobEditError('Tin đã được gỡ hoặc không còn tồn tại');
    if (post.userId !== initial.userId) throw new JobEditError('Người đăng tin đã thay đổi, vui lòng tải lại trang');
    return post;
};

// Editing never extends a paid post or changes its featured flag. The existing UI
// resends the unchanged deadline; accept that without silently ignoring edits.
export const assertUnchangedDeadline = (post, patch) => {
    if (Object.hasOwn(patch, 'timeEnd') && String(patch.timeEnd) !== String(post.timeEnd)) {
        throw new JobEditError('Không thể đổi ngày hết hạn khi sửa tin; vui lòng dùng chức năng Đăng lại');
    }
};

export const editedDetail = (current, patch) => {
    const detail = Object.fromEntries(DETAIL_FIELDS.map(field => [field,
        Object.hasOwn(patch, field)
            ? (field === 'amount' ? Number(patch[field]) : patch[field])
            : current[field] ?? null
    ]));
    const changed = DETAIL_FIELDS.some(field => detail[field] !== (current[field] ?? null));
    const needsModeration = detail.name !== current.name || detail.descriptionHTML !== current.descriptionHTML;
    return { detail, changed, needsModeration };
};
