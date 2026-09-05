import { pool, withTransaction } from '../libs/db.js';
import { EVENTS } from '../../../shared/events.js';
import { createLogger } from '../../../shared/logger.js';
import { enqueueOutboxEvent } from '../libs/outbox.js';
import { requestJobModeration, cancelJobModeration } from '../libs/moderationState.js';
import { consumePostingQuota, PostingQuotaError } from '../libs/postingQuota.js';
import { DETAIL_FIELDS, JobEditError, lockJobForEdit, assertUnchangedDeadline, editedDetail } from '../libs/jobEdit.js';

const logger = createLogger('job-core-service');

// Danh tinh do Gateway dat vao header sau khi da xac thuc JWT. Service nay khong
// tu giai ma token - do la viec cua Gateway.
const identity = (req) => ({
    userId: req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null,
    roleCode: req.headers['x-user-role'] || null,
    companyId: req.headers['x-company-id'] ? Number(req.headers['x-company-id']) : null
});

// Shared primary-source snapshot for event payloads and Search refreshes.
// Search rereads this snapshot until all source writers support domain versions.
const loadJobForEvent = async (postId, db = pool, { current = false } = {}) => {
    const [rows] = await db.query(
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
         WHERE p.id = ?${current ? ' LOCK IN SHARE MODE' : ''}`,
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
        const { postId, job } = await withTransaction(async (conn) => {
            await consumePostingQuota(conn, { userId, companyId, isHot: b.isHot });
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
            const createdJob = await loadJobForEvent(post.insertId, conn, { current: true });
            if (!createdJob) throw new Error('Không đọc được tin vừa tạo');

            await enqueueOutboxEvent(conn, {
                aggregateType: 'job',
                aggregateId: post.insertId,
                eventType: EVENTS.JOB_CREATED,
                payload: { job: createdJob }
            });
            await requestJobModeration(conn, createdJob);

            return { postId: post.insertId, job: createdJob };
        });

        logger.info('da tao tin tuyen dung', { postId, userId, companyId });
        return res.status(201).json({ errCode: 0, data: job });
    } catch (error) {
        if (error instanceof PostingQuotaError) {
            return res.status(error.statusCode).json({ errCode: error.errCode, errMessage: error.message });
        }
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

        const job = await withTransaction(async (conn) => {
            const post = await lockJobForEdit(conn, existing, { userId, roleCode, companyId });
            assertUnchangedDeadline(post, b);
            const [[currentDetail]] = await conn.query('SELECT * FROM detailposts WHERE id = ? FOR UPDATE', [post.detailPostId]);
            if (!currentDetail) throw new JobEditError('Không tìm thấy nội dung tin, vui lòng tải lại trang');
            const { detail, changed, needsModeration } = editedDetail(currentDetail, b);
            // Repeatable-read may retain a snapshot from before waiting on the
            // author/company lock. Responses and events must use a current read,
            // including a no-op that observed another writer's committed edit.
            if (!changed) {
                const unchangedJob = await loadJobForEvent(postId, conn, { current: true });
                if (!unchangedJob) throw new Error('Không đọc được tin hiện tại');
                return unchangedJob;
            }

            // Always copy on a real detail edit. A check-then-update of an
            // "unshared" row races with legacy re-posting and changes siblings.
            // Keep the old snapshot; its lifecycle belongs to a retention job.
            const [inserted] = await conn.query(
                `INSERT INTO detailposts (${DETAIL_FIELDS.join(',')}) VALUES (${DETAIL_FIELDS.map(() => '?').join(',')})`,
                DETAIL_FIELDS.map(field => detail[field])
            );
            await conn.query('UPDATE posts SET detailPostId = ?, statusCode = ?, updatedAt = ? WHERE id = ?',
                [inserted.insertId, needsModeration ? 'PS3' : post.statusCode, new Date(), postId]);

            const updatedJob = await loadJobForEvent(postId, conn, { current: true });
            if (!updatedJob) throw new Error('Không đọc được tin vừa cập nhật');

            await enqueueOutboxEvent(conn, {
                aggregateType: 'job',
                aggregateId: postId,
                eventType: EVENTS.JOB_UPDATED,
                payload: { job: updatedJob }
            });

            if (needsModeration) await requestJobModeration(conn, updatedJob);

            return updatedJob;
        });

        logger.info('da cap nhat tin', { postId, userId });
        return res.json({ errCode: 0, data: job });
    } catch (error) {
        if (error instanceof JobEditError || error instanceof PostingQuotaError) {
            return res.status(error.statusCode).json({ errCode: error.statusCode === 403 ? 3 : 4, errMessage: error.message });
        }
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
        await withTransaction(async (conn) => {
            await conn.query('UPDATE posts SET statusCode = ?, updatedAt = ? WHERE id = ?',
                ['PS4', new Date(), postId]);
            await cancelJobModeration(conn, postId);
            await enqueueOutboxEvent(conn, {
                aggregateType: 'job',
                aggregateId: postId,
                eventType: EVENTS.JOB_DELETED,
                payload: { jobId: postId }
            });
        });
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

// Trusted internal read for Search reconciliation. Unlike the public endpoint,
// this must return moderated/blocked jobs so Search can remove their old state.
export const getJobForIndex = async (req, res) => {
    const id = String(req.params.id ?? '');
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        return res.status(400).json({ errCode: 1, errMessage: 'ID tin không hợp lệ' });
    }
    try {
        const job = await loadJobForEvent(Number(id));
        if (!job) return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' });
        return res.json({ errCode: 0, data: job });
    } catch (error) {
        logger.error('doc tin cho Search that bai', { postId: id, error: error.message });
        return res.status(500).json({ errCode: -1, errMessage: 'Không đọc được dữ liệu nguồn' });
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
