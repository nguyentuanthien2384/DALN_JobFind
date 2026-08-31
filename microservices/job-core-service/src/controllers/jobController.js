import { pool, withTransaction } from '../libs/db.js';
import { publish } from '../../../shared/rabbitmq.js';
import { EVENTS } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('job-core-service');

// Danh tinh do Gateway dat vao header sau khi da xac thuc JWT. Service nay khong
// tu giai ma token - do la viec cua Gateway.
const identity = (req) => ({
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    roleCode: req.headers['x-user-role'] || null,
    companyId: req.headers['x-company-id'] ? Number(req.headers['x-company-id']) : null
});

// Doc day du mot tin de dua vao event. Ben Doc (Search) can du thong tin de
// dung index ma khong phai goi nguoc lai - do chinh la diem mau chot cua CQRS.
const loadJobForEvent = async (postId) => {
    const [rows] = await pool.query(
        `SELECT p.id, p.statusCode, p.timePost, p.timeEnd, p.isHot, p.userId,
                d.name, d.descriptionHTML, d.descriptionMarkdown, d.amount,
                d.categoryJobCode, d.addressCode, d.salaryJobCode,
                d.categoryJoblevelCode, d.categoryWorktypeCode,
                d.experienceJobCode, d.genderPostCode,
                u.companyId,
                c.name AS companyName, c.thumbnail AS companyLogo,
                c.statusCode AS companyStatusCode,
                c.censorCode AS companyCensorCode
         FROM posts p
         JOIN detailposts d ON d.id = p.detailPostId
         LEFT JOIN users u ON u.id = p.userId
         LEFT JOIN companies c ON c.id = u.companyId
         WHERE p.id = ?`,
        [postId]
    );
    return rows[0] || null;
};

export const createJob = async (req, res) => {
    const { userId, companyId } = identity(req);
    const b = req.body || {};

    if (!b.name || !b.descriptionHTML || !b.categoryJobCode) {
        return res.status(400).json({
            errCode: 1,
            errMessage: 'Thiếu tên tin, mô tả hoặc ngành nghề'
        });
    }

    try {
        const postId = await withTransaction(async (conn) => {
            const [detail] = await conn.query(
                `INSERT INTO detailposts
                 (name, descriptionHTML, descriptionMarkdown, categoryJobCode, addressCode,
                  salaryJobCode, amount, categoryJoblevelCode, categoryWorktypeCode,
                  experienceJobCode, genderPostCode)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                [
                    b.name, b.descriptionHTML, b.descriptionMarkdown || '',
                    b.categoryJobCode, b.addressCode || null, b.salaryJobCode || null,
                    b.amount || 1, b.categoryJoblevelCode || null,
                    b.categoryWorktypeCode || null, b.experienceJobCode || null,
                    b.genderPostCode || null
                ]
            );

            const now = new Date();
            const [post] = await conn.query(
                `INSERT INTO posts
                 (statusCode, timeEnd, userId, isHot, timePost, detailPostId, createdAt, updatedAt)
                 VALUES (?,?,?,?,?,?,?,?)`,
                [
                    // PS3 = cho kiem duyet. Tin chi hien ra sau khi AI duyet xong.
                    'PS3',
                    b.timeEnd || String(Date.now() + 30 * 24 * 3600 * 1000),
                    userId,
                    b.isHot ? 1 : 0,
                    String(Date.now()),
                    detail.insertId,
                    now, now
                ]
            );
            return post.insertId;
        });

        const job = await loadJobForEvent(postId);

        // Bao cho ca he thong biet. Search Service se dung index, AI Worker se
        // kiem duyet noi dung - ca hai chay song song va khong lam cham API nay.
        await publish(EVENTS.JOB_CREATED, { job });
        await publish(EVENTS.AI_MODERATE_JOB, {
            jobId: postId,
            name: job.name,
            descriptionHTML: job.descriptionHTML
        });

        logger.info('da tao tin tuyen dung', { postId, userId, companyId });
        return res.status(201).json({ errCode: 0, data: job });
    } catch (error) {
        logger.error('tao tin that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không tạo được tin tuyển dụng' });
    }
};

export const updateJob = async (req, res) => {
    const { userId, roleCode, companyId } = identity(req);
    const postId = Number(req.params.id);
    const b = req.body || {};

    try {
        const existing = await loadJobForEvent(postId);
        if (!existing) {
            return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' });
        }

        // Chi nguoi cua chinh cong ty do (hoac admin) moi duoc sua.
        const isOwner = existing.companyId !== null && existing.companyId === companyId;
        if (roleCode !== 'ADMIN' && !isOwner) {
            return res.status(403).json({
                errCode: 3,
                errMessage: 'Bạn không có quyền sửa tin của công ty khác'
            });
        }

        await withTransaction(async (conn) => {
            await conn.query(
                `UPDATE detailposts SET
                   name = COALESCE(?, name),
                   descriptionHTML = COALESCE(?, descriptionHTML),
                   descriptionMarkdown = COALESCE(?, descriptionMarkdown),
                   categoryJobCode = COALESCE(?, categoryJobCode),
                   addressCode = COALESCE(?, addressCode),
                   salaryJobCode = COALESCE(?, salaryJobCode),
                   amount = COALESCE(?, amount),
                   categoryJoblevelCode = COALESCE(?, categoryJoblevelCode),
                   categoryWorktypeCode = COALESCE(?, categoryWorktypeCode),
                   experienceJobCode = COALESCE(?, experienceJobCode)
                 WHERE id = (SELECT detailPostId FROM posts WHERE id = ?)`,
                [
                    b.name ?? null, b.descriptionHTML ?? null, b.descriptionMarkdown ?? null,
                    b.categoryJobCode ?? null, b.addressCode ?? null, b.salaryJobCode ?? null,
                    b.amount ?? null, b.categoryJoblevelCode ?? null,
                    b.categoryWorktypeCode ?? null, b.experienceJobCode ?? null,
                    postId
                ]
            );
            await conn.query('UPDATE posts SET updatedAt = ? WHERE id = ?', [new Date(), postId]);
        });

        const job = await loadJobForEvent(postId);
        await publish(EVENTS.JOB_UPDATED, { job });

        // Noi dung doi thi phai kiem duyet lai.
        if (b.descriptionHTML || b.name) {
            await publish(EVENTS.AI_MODERATE_JOB, {
                jobId: postId, name: job.name, descriptionHTML: job.descriptionHTML
            });
        }

        logger.info('da cap nhat tin', { postId, userId });
        return res.json({ errCode: 0, data: job });
    } catch (error) {
        logger.error('cap nhat tin that bai', { error: error.message, postId });
        return res.status(500).json({ errCode: -1, errMessage: 'Không cập nhật được tin' });
    }
};

export const deleteJob = async (req, res) => {
    const { roleCode, companyId } = identity(req);
    const postId = Number(req.params.id);

    try {
        const existing = await loadJobForEvent(postId);
        if (!existing) {
            return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' });
        }
        const isOwner = existing.companyId !== null && existing.companyId === companyId;
        if (roleCode !== 'ADMIN' && !isOwner) {
            return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền xóa tin này' });
        }

        // Khong xoa han: doi trang thai sang PS4 (da bi chan). Giu lai de con doi
        // chieu voi ho so da ung tuyen vao tin do.
        await pool.query('UPDATE posts SET statusCode = ?, updatedAt = ? WHERE id = ?',
            ['PS4', new Date(), postId]);

        await publish(EVENTS.JOB_DELETED, { jobId: postId });
        return res.json({ errCode: 0, errMessage: 'Đã gỡ tin tuyển dụng' });
    } catch (error) {
        logger.error('xoa tin that bai', { error: error.message, postId });
        return res.status(500).json({ errCode: -1, errMessage: 'Không gỡ được tin' });
    }
};

export const getJob = async (req, res) => {
    try {
        const job = await loadJobForEvent(Number(req.params.id));
        // Day la endpoint public. Tin cho duyet/bi tu choi va tin cua cong ty
        // bi khoa/chua duyet khong duoc lo chi bang cach doan id.
        if (!job
            || job.statusCode !== 'PS1'
            || job.companyStatusCode !== 'S1'
            || job.companyCensorCode !== 'CS1') {
            return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' });
        }
        const {
            companyStatusCode: _companyStatusCode,
            companyCensorCode: _companyCensorCode,
            ...publicJob
        } = job;
        return res.json({ errCode: 0, data: publicJob });
    } catch (error) {
        logger.error('doc tin that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

// Search Service goi luc khoi dong de dung lai toan bo index tu dau.
export const listJobsForReindex = async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT p.id, p.statusCode, p.timePost, p.timeEnd, p.isHot, p.userId,
                    d.name, d.descriptionHTML, d.amount,
                    d.categoryJobCode, d.addressCode, d.salaryJobCode,
                    d.categoryJoblevelCode, d.categoryWorktypeCode,
                    d.experienceJobCode,
                    u.companyId, c.name AS companyName, c.thumbnail AS companyLogo,
                    c.statusCode AS companyStatusCode,
                    c.censorCode AS companyCensorCode
             FROM posts p
             JOIN detailposts d ON d.id = p.detailPostId
             LEFT JOIN users u ON u.id = p.userId
             LEFT JOIN companies c ON c.id = u.companyId`
        );
        return res.json({ errCode: 0, data: rows, count: rows.length });
    } catch (error) {
        logger.error('doc danh sach de dung index that bai', { error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Lỗi hệ thống' });
    }
};

export { loadJobForEvent };
