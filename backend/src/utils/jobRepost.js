import db from '../models/index';
import { PostingQuotaError, normalizePostHot, assertTransactionalPostingTables, lockPostingCompany, consumeLockedPostingQuota } from './postingQuota';
import { isJobRevision, jobRevision } from './jobRevision';
import { enqueueLegacyJobCreated } from './legacyOutbox';

// Identity is supplied by the authenticated controller, never by the body.
// Keep the legacy shared immutable detail snapshot and manual PS3 policy.
export const repostLegacyPost = async (data, identity = {}) => {
    const actorId = Number(data.userId), sourceId = Number(data.postId), deadline = Number(data.timeEnd);
    if (![data.userId, data.postId].every(id => ['number', 'string'].includes(typeof id))
        || ![actorId, sourceId].every(id => Number.isSafeInteger(id) && id > 0)
        || !['number', 'string'].includes(typeof data.timeEnd) || !Number.isSafeInteger(deadline)
        || !Number.isFinite(new Date(deadline).getTime()) || deadline <= Date.now()
        || (Object.hasOwn(data, 'expectedRevision') && !isJobRevision(data.expectedRevision))) {
        return { errCode: 1, errMessage: 'Thông tin đăng lại không hợp lệ; ngày kết thúc phải sau thời điểm hiện tại' };
    }
    const initial = await db.Post.findOne({ where: { id: sourceId }, attributes: ['id', 'userId'], raw: true });
    if (!initial) return { errCode: 2, errMessage: 'Bài viết không tồn tại' };
    try {
        return await db.sequelize.transaction(async transaction => {
            await assertTransactionalPostingTables(transaction);
            // Match edit/moderation lock order: users sorted -> company -> post -> detail.
            // Reading the owner only after taking the company/post lock would
            // permit stale membership or invert locks against the other writers.
            const ids = [...new Set([actorId, initial.userId].filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
            const users = await db.User.findAll({ where: { id: ids }, attributes: ['id', 'companyId'], order: [['id', 'ASC']],
                transaction, lock: transaction.LOCK.UPDATE, raw: true });
            const actor = users.find(user => user.id === actorId), owner = users.find(user => user.id === initial.userId);
            const admin = identity.roleCode === 'ADMIN';
            if (!actor?.companyId || (!admin && (actor.companyId !== owner?.companyId
                || (identity.companyId !== undefined && Number(identity.companyId) !== actor.companyId)
                || (identity.roleCode !== undefined && !['EMPLOYER', 'COMPANY'].includes(identity.roleCode))))) {
                throw new PostingQuotaError('Bạn không có quyền đăng lại tin hoặc thông tin công ty đã thay đổi');
            }
            // ADMIN still needs its own approved company and quota as before;
            // copying another company's source never charges that source company.
            const company = await lockPostingCompany(actorId, transaction);
            const source = await db.Post.findOne({ where: { id: sourceId }, transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!source || !['PS1', 'PS2', 'PS3'].includes(source.statusCode)) throw new PostingQuotaError('Tin đã được gỡ hoặc không còn tồn tại');
            if (source.userId !== initial.userId) throw new PostingQuotaError('Người đăng tin đã thay đổi, vui lòng tải lại');
            const detail = await db.DetailPost.findOne({ where: { id: source.detailPostId }, transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!detail) throw new PostingQuotaError('Không tìm thấy nội dung tin gốc');
            if (data.expectedRevision !== undefined && data.expectedRevision !== jobRevision(source, detail)) {
                return { errCode: 4, conflict: true, errMessage: 'Tin gốc đã thay đổi. Vui lòng tải lại trước khi đăng lại' };
            }
            // A long row-lock wait must not make a previously valid deadline expire.
            if (deadline <= Date.now()) throw new PostingQuotaError('Ngày kết thúc phải sau thời điểm hiện tại');
            const isHot = normalizePostHot(source.isHot);
            await consumeLockedPostingQuota(company, isHot, transaction);
            const inserted = await db.Post.create({ statusCode: 'PS3', timeEnd: String(deadline), userId: actorId,
                isHot, detailPostId: detail.id }, { transaction });
            const post = await db.Post.findOne({ where: { id: inserted.id }, transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!post || post.id === sourceId || post.userId !== actorId || post.detailPostId !== detail.id
                || post.statusCode !== 'PS3' || Number(post.isHot) !== isHot || String(post.timeEnd) !== String(deadline)) {
                throw new PostingQuotaError('Không đọc được tin vừa đăng lại, vui lòng thử lại');
            }
            await enqueueLegacyJobCreated({ post, detail, owner: actor, company }, transaction);
            return { errCode: 0, errMessage: 'Tạo bài tuyển dụng thành công hãy chờ quản trị viên duyệt', postId: post.id };
        });
    } catch (error) {
        if (error instanceof PostingQuotaError) return { errCode: 2, errMessage: error.message };
        throw error;
    }
};
