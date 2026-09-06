import db from '../models/index';
import { assertTransactionalPostingTables, PostingQuotaError } from './postingQuota';
import { isJobRevision, jobRevision } from './jobRevision';

const fields = [
    'name', 'descriptionHTML', 'descriptionMarkdown', 'categoryJobCode', 'addressCode',
    'salaryJobCode', 'amount', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode'
];

// Called only after controller authorization. The second argument is trusted
// req.user metadata, never roleCode/companyId copied from the submitted body.
export const updateLegacyPost = async (data, identity = {}) => {
    if (Object.prototype.hasOwnProperty.call(data, 'expectedRevision') && !isJobRevision(data.expectedRevision)) {
        return { errCode: 1, errMessage: 'Mã phiên bản tin không hợp lệ' };
    }
    const initial = await db.Post.findOne({ where: { id: data.id }, attributes: ['id', 'userId'], raw: true });
    if (!initial) return { errCode: 2, errMessage: 'Bài đăng không tồn tại !' };
    try {
        return await db.sequelize.transaction(async transaction => {
            await assertTransactionalPostingTables(transaction);
            const ids = [...new Set([Number(data.userId), initial.userId].filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
            const users = await db.User.findAll({ where: { id: ids }, attributes: ['id', 'companyId'],
                order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE, raw: true });
            const actor = users.find(user => user.id === Number(data.userId));
            const owner = users.find(user => user.id === initial.userId);
            const admin = identity.roleCode === 'ADMIN';
            if (!actor || (!admin && (!actor.companyId || actor.companyId !== owner?.companyId
                || (identity.companyId !== undefined && Number(identity.companyId) !== actor.companyId)))) {
                throw new PostingQuotaError('Bạn không có quyền sửa tin hoặc thông tin công ty đã thay đổi');
            }
            if (owner?.companyId) {
                const company = await db.Company.findOne({ where: { id: owner.companyId }, attributes: ['id', 'statusCode', 'censorCode'],
                    transaction, lock: transaction.LOCK.UPDATE, raw: true });
                if (!admin && (!company || company.statusCode !== 'S1' || company.censorCode !== 'CS1')) {
                    throw new PostingQuotaError('Công ty chưa được duyệt, đã bị khóa hoặc không tồn tại');
                }
            }
            const post = await db.Post.findOne({ where: { id: data.id }, transaction, lock: transaction.LOCK.UPDATE, raw: false });
            if (!post || post.statusCode === 'PS4') throw new PostingQuotaError('Tin đã được gỡ hoặc không còn tồn tại');
            if (post.userId !== initial.userId) throw new PostingQuotaError('Người đăng tin đã thay đổi, vui lòng tải lại trang');
            const current = await db.DetailPost.findOne({ where: { id: post.detailPostId }, transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!current) throw new PostingQuotaError('Không tìm thấy nội dung tin, vui lòng tải lại trang');
            if (data.expectedRevision !== undefined && data.expectedRevision !== jobRevision(post, current)) {
                return { errCode: 4, conflict: true, errMessage: 'Tin đã thay đổi từ khi bạn mở biểu mẫu. Vui lòng tải lại trước khi lưu' };
            }
            if (String(data.timeEnd) !== String(post.timeEnd)) {
                throw new PostingQuotaError('Không thể đổi ngày hết hạn khi sửa tin; vui lòng dùng chức năng Đăng lại');
            }
            const next = Object.fromEntries(fields.map(field => [field, field === 'amount' ? Number(data[field]) : data[field]]));
            if (fields.every(field => next[field] === current[field])) {
                return { errCode: 0, errMessage: 'Nội dung tin không thay đổi', changed: false, editRevision: jobRevision(post, current) };
            }
            // A new snapshot even when apparently unshared: re-posting may start
            // concurrently. Never modify a sibling's content or transfer authorship.
            const detail = await db.DetailPost.create(next, { transaction });
            post.detailPostId = detail.id;
            post.statusCode = 'PS3'; // Preserve the legacy manual review policy.
            await post.save({ transaction, fields: ['detailPostId', 'statusCode', 'updatedAt'] });
            return { errCode: 0, errMessage: 'Đã chỉnh sửa bài viết thành công hãy chờ quản trị viên duyệt', changed: true,
                editRevision: jobRevision(post, next) };
        });
    } catch (error) {
        if (error instanceof PostingQuotaError) return { errCode: 2, errMessage: error.message };
        throw error;
    }
};
