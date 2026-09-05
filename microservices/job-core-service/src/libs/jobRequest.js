import { createHash } from 'node:crypto';
import { pool } from './db.js';
import { PostingQuotaError, lockPostingCompany } from './postingQuota.js';

export class JobRequestError extends PostingQuotaError {}

const assertLedger = async (conn) => {
    const [[table]] = await conn.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_request_keys'`);
    if (table?.engine !== 'InnoDB') throw new JobRequestError('Chưa thể lưu mã thao tác đăng tin', 503);
};

export const ensureJobRequestTable = async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS job_request_keys (
        userId BIGINT UNSIGNED NOT NULL,
        requestKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        operation VARCHAR(16) NOT NULL,
        requestHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        companyId BIGINT UNSIGNED NOT NULL,
        postId BIGINT UNSIGNED NULL,
        responseJson LONGTEXT NULL,
        createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (userId, requestKey), UNIQUE KEY uq_job_request_post (postId)
    ) ENGINE=InnoDB`);
    await assertLedger(pool);
};

export const normalizeJobCreate = (body) => ({
    name: body.name, descriptionHTML: body.descriptionHTML,
    descriptionMarkdown: body.descriptionMarkdown || '', categoryJobCode: body.categoryJobCode,
    addressCode: body.addressCode || null, salaryJobCode: body.salaryJobCode || null,
    amount: Number(body.amount || 1), categoryJoblevelCode: body.categoryJoblevelCode || null,
    categoryWorktypeCode: body.categoryWorktypeCode || null, experienceJobCode: body.experienceJobCode || null,
    genderPostCode: body.genderPostCode || null, isHot: body.isHot === true || body.isHot === 1 ? 1 : 0,
    // Absence is intent, NOT a newly calculated timestamp on every retry.
    timeEnd: body.timeEnd === undefined ? null : String(body.timeEnd)
});

export const futureJobDeadline = (value) => {
    const time = value == null ? Date.now() + 30 * 24 * 3600 * 1000 : Number(value);
    if (!Number.isSafeInteger(time) || time <= Date.now() || time > 8640000000000000) {
        throw new JobRequestError('Ngày hết hạn phải nằm trong tương lai', 400);
    }
    return String(time);
};

// Run INSIDE the quota/post/outbox transaction. Claim before user/company locks;
// duplicate INSERT waits for the winning commit. Never upgrade its shared key
// lock: use current shared reads, even under MySQL REPEATABLE READ.
export const runJobRequest = async (conn, { userId, companyId, key, operation, input, required = false }, work) => {
    if (key === undefined && !required) return work(); // old modern clients remain compatible
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
        throw new JobRequestError('Mã thao tác đăng tin không hợp lệ hoặc còn thiếu', 400);
    }
    if (![userId, companyId].every(id => Number.isSafeInteger(id) && id > 0)) {
        throw new JobRequestError('Người dùng không thuộc công ty hợp lệ', 403);
    }
    const hash = createHash('sha256').update(JSON.stringify({ version: 1, operation, input })).digest('hex');
    await assertLedger(conn);
    try {
        await conn.query(`INSERT INTO job_request_keys (userId, requestKey, operation, requestHash, companyId)
            VALUES (?,?,?,?,?)`, [userId, key, operation, hash, companyId]);
    } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
        const [[saved]] = await conn.query(`SELECT operation, requestHash, companyId, postId, responseJson
            FROM job_request_keys WHERE userId = ? AND requestKey = ? LOCK IN SHARE MODE`, [userId, key]);
        if (!saved || Number(saved.companyId) !== companyId) {
            throw new JobRequestError('Mã thao tác thuộc công ty khác hoặc không còn hợp lệ', 403);
        }
        if (saved.operation !== operation || saved.requestHash !== hash) {
            throw new JobRequestError('Mã thao tác đã dùng cho nội dung khác; chỉ dùng mã mới khi muốn đăng tin mới');
        }
        await lockPostingCompany(conn, { userId, companyId });
        const [[post]] = await conn.query('SELECT id, userId FROM posts WHERE id = ? LOCK IN SHARE MODE', [saved.postId]);
        let job;
        try { job = JSON.parse(saved.responseJson); } catch { /* fail closed below */ }
        if (!post || Number(post.userId) !== userId || job?.id !== Number(saved.postId)
            || job?.userId !== userId || job?.companyId !== companyId) {
            throw new JobRequestError('Không thể đối chiếu tin đã đăng; vui lòng liên hệ quản trị viên');
        }
        // Original accepted snapshot, not current moderation/visibility. Never
        // recreate a hard-deleted post or resurrect a soft-deleted one.
        return { postId: job.id, job };
    }
    const result = await work();
    const [saved] = await conn.query(`UPDATE job_request_keys SET postId = ?, responseJson = ?
        WHERE userId = ? AND requestKey = ? AND postId IS NULL`,
    [result.postId, JSON.stringify(result.job), userId, key]);
    if (saved.affectedRows !== 1) throw new Error('Cannot finalize posting request');
    return result;
};
