// Every caller must use the SAME open transaction for quota, post and outbox.
// Lock order matches the legacy writer: user -> company -> (existing post).
export class PostingQuotaError extends Error {
    constructor(message, statusCode = 409) {
        super(message);
        this.statusCode = statusCode;
        this.errCode = 2;
    }
}

export const assertTransactionalPostingTables = async (conn) => {
    // Fail before any mutation if legacy tables cannot roll back. Do not silently
    // convert tables, and do not cache this check across deployment/migrations.
    const required = ['users', 'companies', 'posts', 'detailposts'];
    const [tables] = await conn.query(`SELECT TABLE_NAME AS name, ENGINE AS engine
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?,?,?,?)`, required);
    if (required.some((name) => !tables.some((table) => table.name === name && table.engine === 'InnoDB'))) {
        throw new PostingQuotaError('Chưa thể đăng tin: cấu hình giao dịch dữ liệu chưa sẵn sàng', 503);
    }
};

export const lockPostingCompany = async (conn, { userId, companyId }) => {
    if (!Number.isSafeInteger(userId) || userId <= 0
        || !Number.isSafeInteger(companyId) || companyId <= 0) {
        throw new PostingQuotaError('Người dùng không thuộc công ty hợp lệ', 403);
    }
    await assertTransactionalPostingTables(conn);
    const [[user]] = await conn.query('SELECT id, companyId FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (!user || Number(user.companyId) !== companyId) {
        throw new PostingQuotaError('Thông tin công ty đã thay đổi, vui lòng tải lại trang', 403);
    }
    const [[company]] = await conn.query(
        'SELECT id, statusCode, censorCode FROM companies WHERE id = ? FOR UPDATE', [companyId]
    );
    if (!company || company.statusCode !== 'S1' || company.censorCode !== 'CS1') {
        throw new PostingQuotaError('Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại', 403);
    }
};

// Caller already holds the current user/company locks (or lockJobForEdit with
// no admin bypass). Separating authorization from debit also permits safe replay
// when the previously accepted request spent the last slot.
export const consumeLockedPostingQuota = async (conn, { companyId, isHot }) => {
    if (![undefined, false, true, 0, 1].includes(isHot)) {
        throw new PostingQuotaError('Loại tin tuyển dụng không hợp lệ', 400);
    }
    // Field names come only from this fixed allowlist, never from a request.
    const hot = isHot === true || isHot === 1;
    const field = hot ? 'allowHotPost' : 'allowPost';
    const [result] = await conn.query(
        `UPDATE companies SET ${field} = ${field} - 1 WHERE id = ? AND ${field} > 0`, [companyId]
    );
    if (result.affectedRows !== 1) {
        throw new PostingQuotaError(hot
            ? 'Công ty bạn đã hết số lần đăng bài viết nổi bật'
            : 'Công ty bạn đã hết số lần đăng bài viết bình thường');
    }
};

export const consumePostingQuota = async (conn, context) => {
    if (![undefined, false, true, 0, 1].includes(context.isHot)) {
        throw new PostingQuotaError('Loại tin tuyển dụng không hợp lệ', 400);
    }
    await lockPostingCompany(conn, context);
    await consumeLockedPostingQuota(conn, context);
};
