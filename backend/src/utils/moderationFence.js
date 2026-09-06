import db from '../models/index';
import { PostingQuotaError } from './postingQuota';

// Caller holds the post lock. A monolith-only database may not have this table;
// no request can exist there yet. Never swallow SQL/permission/schema errors.
// Job Core creates/replaces requests only while holding the same post lock.
export const cancelLegacyModeration = async (postId, transaction) => {
    const [tables] = await db.sequelize.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_moderation_state'`, { transaction });
    if (!tables.length) return;
    if (tables[0].engine !== 'InnoDB') throw new PostingQuotaError('Chưa thể cập nhật tin: bảng kiểm duyệt không hỗ trợ giao dịch');
    await db.sequelize.query(`UPDATE job_moderation_state SET state = 'cancelled', resolvedAt = :now
        WHERE jobId = :postId AND state <> 'cancelled'`, { replacements: { postId, now: new Date() }, transaction });
};
