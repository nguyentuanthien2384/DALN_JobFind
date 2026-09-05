import { pool } from '../libs/db.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('job-core-service');

// Private read, not a bypass on the public job endpoint. Authorization and
// content come from ONE statement/snapshot, with no check-then-read window.
export const getManagedJob = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const userId = Number(req.headers['x-user-id']);
    const companyId = Number(req.headers['x-company-id']);
    const roleCode = req.headers['x-user-role'];
    const id = Number(req.params.id);
    if (!['ADMIN', 'COMPANY', 'EMPLOYER'].includes(roleCode) || !Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền quản lý tin' });
    }
    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ errCode: 1, errMessage: 'Mã tin không hợp lệ' });
    }
    const admin = roleCode === 'ADMIN';
    if (!admin && (!Number.isSafeInteger(companyId) || companyId <= 0)) {
        return res.status(403).json({ errCode: 3, errMessage: 'Bạn cần thuộc công ty hợp lệ' });
    }
    try {
        // Only explicitly selected job fields. Never return identity secrets,
        // company documents, quota, moderation request IDs, prompts or AI output.
        const [[job]] = await pool.query(`SELECT p.id, p.statusCode, p.timePost, p.timeEnd, p.isHot, p.userId,
                d.name, d.descriptionHTML, d.descriptionMarkdown, d.amount,
                d.categoryJobCode, d.addressCode, d.salaryJobCode, d.categoryJoblevelCode,
                d.categoryWorktypeCode, d.experienceJobCode, d.genderPostCode,
                owner.companyId, c.name AS companyName, c.thumbnail AS companyLogo
            FROM posts p JOIN detailposts d ON d.id = p.detailPostId
            JOIN users actor ON actor.id = ?
            LEFT JOIN users owner ON owner.id = p.userId
            LEFT JOIN companies c ON c.id = owner.companyId
            WHERE p.id = ?${admin ? '' : " AND actor.companyId = ? AND owner.companyId = actor.companyId AND c.statusCode = 'S1' AND c.censorCode = 'CS1'"}`,
        admin ? [userId, id] : [userId, id, companyId]);
        // Same response for unknown IDs and records outside the current tenant.
        if (!job) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin trong phạm vi quản lý' });
        return res.json({ errCode: 0, data: job });
    } catch (error) {
        logger.error('doc tin quan ly that bai', { error: error.message, postId: id });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được thông tin tin tuyển dụng' });
    }
};
