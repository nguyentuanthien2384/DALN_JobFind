import db from '../models/index';

export class PostingQuotaError extends Error {
    constructor(message) {
        super(message);
        this.errCode = 2;
    }
}

// The legacy client sends 0/1 as either a number or a string. Never use truthiness
// here: the string "0" must consume a normal slot, not a featured one.
export const normalizePostHot = (value) => {
    if (value === true || value === 1 || value === '1') return 1;
    if (value === false || value === 0 || value === '0' || value === undefined) return 0;
    throw new PostingQuotaError('Loại tin tuyển dụng không hợp lệ');
};

export const assertTransactionalPostingTables = async (transaction) => {
    const required = ['users', 'companies', 'posts', 'detailposts'];
    const [tables] = await db.sequelize.query(`SELECT TABLE_NAME AS name, ENGINE AS engine
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (:tables)`, { replacements: { tables: required }, transaction });
    if (required.some((name) => !tables.some((table) => table.name === name && table.engine === 'InnoDB'))) {
        throw new PostingQuotaError('Chưa thể đăng tin: cấu hình giao dịch dữ liệu chưa sẵn sàng');
    }
};

export const lockPostingCompany = async (userId, transaction) => {
    await assertTransactionalPostingTables(transaction);
    // Keep this lock order consistent with Job Core and hold both locks until
    // the post commits. A stale membership read must not charge another company.
    const user = await db.User.findOne({
        where: { id: userId }, attributes: ['id', 'companyId'],
        transaction, lock: transaction.LOCK.UPDATE, raw: false
    });
    if (!user?.companyId) throw new PostingQuotaError('Người dùng không thuộc công ty');
    const company = await db.Company.findOne({
        where: { id: user.companyId }, attributes: ['id', 'statusCode', 'censorCode', 'allowPost', 'allowHotPost'],
        transaction, lock: transaction.LOCK.UPDATE, raw: false
    });
    if (!company || company.statusCode !== 'S1' || company.censorCode !== 'CS1') {
        throw new PostingQuotaError('Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại');
    }
    return company;
};

export const consumeLockedPostingQuota = async (company, isHot, transaction) => {
    const field = isHot === 1 ? 'allowHotPost' : 'allowPost';
    const remaining = Number(company[field]);
    if (!Number.isSafeInteger(remaining) || remaining <= 0) {
        throw new PostingQuotaError(isHot === 1
            ? 'Công ty bạn đã hết số lần đăng bài viết nổi bật'
            : 'Công ty bạn đã hết số lần đăng bài viết bình thường');
    }
    company[field] = remaining - 1;
    // Safe read-modify-write ONLY because lockPostingCompany holds FOR UPDATE.
    // Restrict fields to avoid overwriting a concurrent package entitlement.
    await company.save({ transaction, fields: [field], silent: true });
};
