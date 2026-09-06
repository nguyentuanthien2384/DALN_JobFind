import db from '../models/index';
import { assertTransactionalPostingTables, PostingQuotaError } from './postingQuota';
import { isJobRevision, jobRevision } from './jobRevision';
import { cancelLegacyModeration } from './moderationFence';
import { enqueueManualModerationNotifications } from './manualModerationOutbox';
import { enqueueLegacyJobUpdated } from './legacyOutbox';

const fail = (httpStatus, errMessage, conflict = false) => ({ errCode: httpStatus === 403 ? 3 : conflict ? 4 : 1,
    httpStatus, errMessage, ...(conflict && { conflict: true }) });
const positiveId = value => ['string', 'number'].includes(typeof value) && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const transitions = {
    approve: { target: 'PS1', from: ['PS2', 'PS3'], message: 'Duyệt bài thành công' },
    reject: { target: 'PS2', from: ['PS3'], message: 'Đã từ chối bài thành công' },
    ban: { target: 'PS4', from: ['PS1', 'PS2', 'PS3'], message: 'Đã chặn bài viết thành công' },
    reopen: { target: 'PS3', from: ['PS4'], message: 'Đã mở lại trạng thái chờ duyệt' }
};

// Role comes from authenticated middleware via a separate argument, never body.
// Status, note, AI fence, search event and recipient intents commit or roll back together.
export const moderateLegacyPost = async (data, action, identity = {}) => {
    if (identity.roleCode !== 'ADMIN') return fail(403, 'Chỉ quản trị viên được kiểm duyệt tin');
    const rule = Object.hasOwn(transitions, action) ? transitions[action] : null;
    const id = action === 'ban' ? data.postId : data.id;
    if (!rule || !positiveId(id) || !positiveId(data.userId)) return fail(400, 'Thông tin kiểm duyệt không hợp lệ');
    if (data.expectedRevision === undefined) return fail(428, 'Cần tải lại phiên bản tin trước khi kiểm duyệt');
    if (!isJobRevision(data.expectedRevision)) return fail(400, 'Mã phiên bản tin không hợp lệ');
    const note = action === 'approve' ? 'Đã duyệt bài thành công' : data.note;
    if (typeof note !== 'string' || !note.trim() || Array.from(note).length > 255) return fail(400, 'Lý do phải có từ 1 đến 255 ký tự');
    const initial = await db.Post.findOne({ where: { id }, attributes: ['id', 'userId'], raw: true });
    if (!initial) return { errCode: 2, httpStatus: 404, errMessage: 'Không tồn tại bài viết' };
    try {
        return await db.sequelize.transaction(async transaction => {
            await assertTransactionalPostingTables(transaction);
            const [tables] = await db.sequelize.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notes'`, { transaction });
            if (tables.length !== 1 || tables[0].engine !== 'InnoDB') throw new PostingQuotaError('Chưa thể kiểm duyệt: bảng ghi chú không hỗ trợ giao dịch');
            const ids = [...new Set([Number(data.userId), initial.userId].filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
            const users = await db.User.findAll({ where: { id: ids }, attributes: ['id', 'companyId'], order: [['id', 'ASC']],
                transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!users.some(user => user.id === Number(data.userId))) return fail(403, 'Tài khoản kiểm duyệt không còn tồn tại');
            const owner = users.find(user => user.id === initial.userId);
            // Same auth -> company -> post order as create/edit; retain ownership
            // context for notifications, without changing quota or paid fields.
            const company = owner?.companyId ? await db.Company.findOne({ where: { id: owner.companyId },
                attributes: ['id', 'name', 'thumbnail', 'statusCode', 'censorCode'],
                transaction, lock: transaction.LOCK.UPDATE, raw: true }) : null;
            const post = await db.Post.findOne({ where: { id }, transaction, lock: transaction.LOCK.UPDATE, raw: false });
            if (!post) return { errCode: 2, httpStatus: 404, errMessage: 'Không tồn tại bài viết' };
            if (post.userId !== initial.userId) return fail(409, 'Người đăng tin đã thay đổi. Vui lòng tải lại', true);
            const detail = await db.DetailPost.findOne({ where: { id: post.detailPostId }, transaction, lock: transaction.LOCK.UPDATE, raw: true });
            if (!detail) return fail(409, 'Không tìm thấy nội dung tin. Vui lòng tải lại', true);
            if (data.expectedRevision !== jobRevision(post, detail)) return fail(409, 'Tin đã thay đổi. Hãy tải lại và xem nội dung trước khi quyết định', true);
            if (post.statusCode === rule.target) return { errCode: 0, changed: false, statusCode: post.statusCode,
                editRevision: data.expectedRevision, errMessage: 'Trạng thái tin không thay đổi' };
            if (!rule.from.includes(post.statusCode)) return fail(409, 'Không thể chuyển từ trạng thái hiện tại. Vui lòng tải lại tin', true);
            // Cancellation and note must roll back together with the status.
            // Reopen is manual PS3, NOT a fresh AI request and NOT publication.
            await cancelLegacyModeration(post.id, transaction);
            post.statusCode = rule.target;
            const fields = ['statusCode', 'updatedAt'];
            if (action === 'approve') { post.timePost = Date.now(); fields.push('timePost'); }
            await post.save({ transaction, fields });
            await db.Note.create({ postId: post.id, note, userId: Number(data.userId) }, { transaction });
            await enqueueLegacyJobUpdated({ post, detail, owner, company }, transaction);
            await enqueueManualModerationNotifications({ action, postId: post.id, posterId: post.userId,
                companyId: owner?.companyId ?? null, companyName: company?.name ?? null, jobTitle: detail.name, note }, transaction);
            return { errCode: 0, changed: true, postId: post.id, statusCode: post.statusCode,
                editRevision: jobRevision(post, detail), errMessage: rule.message };
        });
    } catch (error) {
        if (error instanceof PostingQuotaError) return fail(503, error.message);
        throw error;
    }
};
