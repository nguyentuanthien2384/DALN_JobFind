import { createHash } from 'crypto';
import db from '../models/index';
import { PostingQuotaError, normalizePostHot, lockPostingCompany } from './postingQuota';

export class LegacyJobRequestError extends PostingQuotaError {
    constructor(message, httpStatus = 409) {
        super(message);
        this.httpStatus = httpStatus;
        this.errCode = httpStatus === 400 ? 1 : httpStatus === 403 ? 3 : httpStatus === 409 ? 4 : -1;
    }
}

const positiveId = value => ['string', 'number'].includes(typeof value)
    && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const fields = ['name', 'descriptionHTML', 'descriptionMarkdown', 'categoryJobCode', 'addressCode',
    'salaryJobCode', 'categoryJoblevelCode', 'categoryWorktypeCode', 'experienceJobCode', 'genderPostCode'];

// Only fields actually used by the writer enter the intent hash. Never hash
// client-supplied actor/company/status/IDs, object property order or defaults
// computed from the clock. This is deliberately separate from Job Core intent.
export const normalizeLegacyCreate = body => {
    if (fields.some(field => typeof body[field] !== 'string' || !body[field].trim()) || !positiveId(body.amount)
        || !positiveId(body.timeEnd) || Number(body.timeEnd) > 8640000000000000) {
        throw new LegacyJobRequestError('Nội dung, số lượng hoặc ngày hết hạn không hợp lệ', 400);
    }
    return { ...Object.fromEntries(fields.map(field => [field, body[field]])),
        amount: Number(body.amount), timeEnd: String(Number(body.timeEnd)), isHot: normalizePostHot(body.isHot) };
};

const assertLedger = async transaction => {
    const [rows] = await db.sequelize.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_request_keys'`, { transaction });
    if (rows.length !== 1 || rows[0].engine !== 'InnoDB') {
        throw new LegacyJobRequestError('Chưa thể lưu mã thao tác đăng tin; vui lòng thử lại sau', 503);
    }
    const [indexes] = await db.sequelize.query(`SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_request_keys' AND INDEX_NAME = 'PRIMARY'
        ORDER BY SEQ_IN_INDEX`, { transaction });
    const [columns] = await db.sequelize.query(`SELECT COLLATION_NAME AS collationName, CHARACTER_MAXIMUM_LENGTH AS keyLength
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_request_keys'
        AND COLUMN_NAME = 'requestKey'`, { transaction });
    if (indexes.map(row => row.name).join(',') !== 'userId,requestKey'
        || columns[0]?.collationName !== 'ascii_bin' || Number(columns[0]?.keyLength) !== 128) {
        throw new LegacyJobRequestError('Cấu hình khóa chống trùng chưa sẵn sàng; vui lòng thử lại sau', 503);
    }
};

// The existing Core ledger is shared only during the legacy DB transition.
// No startup DDL, expiry, direct-publish fallback or separate commit is allowed.
// Claim BEFORE user/company locks, matching Core. Duplicate INSERT holds a
// shared key lock: use a current shared read, never upgrade it to FOR UPDATE.
export const runLegacyCreateRequest = async (transaction, { data, identity, key }, work) => {
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) {
        throw new LegacyJobRequestError('Mã thao tác đăng tin không hợp lệ', 400);
    }
    if (!positiveId(data.userId) || !positiveId(identity.companyId)
        || !['COMPANY', 'EMPLOYER', 'ADMIN'].includes(identity.roleCode)) {
        throw new LegacyJobRequestError('Không có quyền đăng tin cho công ty này', 403);
    }
    const userId = Number(data.userId), companyId = Number(identity.companyId);
    const input = normalizeLegacyCreate(data), operation = 'legacy-create';
    const hash = createHash('sha256').update(JSON.stringify({ version: 1, operation, input })).digest('hex');
    await assertLedger(transaction);
    try {
        await db.sequelize.query(`INSERT INTO job_request_keys (userId, requestKey, operation, requestHash, companyId)
            VALUES (?, ?, ?, ?, ?)`, { replacements: [userId, key, operation, hash, companyId], transaction });
    } catch (error) {
        if ((error.original?.code || error.parent?.code || error.code) !== 'ER_DUP_ENTRY') throw error;
        const [rows] = await db.sequelize.query(`SELECT operation, requestHash, companyId, postId, responseJson
            FROM job_request_keys WHERE userId = ? AND requestKey = ? LOCK IN SHARE MODE`,
        { replacements: [userId, key], transaction });
        const saved = rows[0];
        // Auth middleware reloads account/role on every HTTP request. Recheck
        // current membership + approval under locks even on a replay with zero quota.
        const company = await lockPostingCompany(userId, transaction);
        if (!saved || Number(saved.companyId) !== companyId || Number(company.id) !== companyId) {
            throw new LegacyJobRequestError('Mã thao tác không thuộc công ty hiện tại', 403);
        }
        if (saved.operation !== operation || saved.requestHash !== hash) {
            throw new LegacyJobRequestError('Mã thao tác đã dùng cho nội dung khác; hãy đối chiếu tin đã đăng');
        }
        const [posts] = await db.sequelize.query('SELECT id, userId FROM posts WHERE id = ? LOCK IN SHARE MODE',
            { replacements: [saved.postId], transaction });
        let response;
        try { response = JSON.parse(saved.responseJson); } catch { /* fail closed */ }
        if (!posts[0] || Number(posts[0].userId) !== userId || !positiveId(saved.postId)
            || response?.errCode !== 0 || response?.postId !== Number(saved.postId)
            || response?.idempotencyKey !== key || response?.replayed !== false
            || typeof response?.errMessage !== 'string') {
            throw new LegacyJobRequestError('Không đối chiếu được tin đã đăng; vui lòng liên hệ quản trị viên');
        }
        // Receipt of original acceptance, not current content or moderation.
        // Missing/reassigned posts never cause recreation or a second charge.
        return { errCode: 0, errMessage: response.errMessage, postId: response.postId,
            idempotencyKey: key, replayed: true };
    }
    // Time-dependent validation belongs AFTER replay: a valid old receipt must
    // still work after its deadline, but a fresh request cannot create expired jobs.
    const response = { ...await work({ ...input, userId }), idempotencyKey: key, replayed: false };
    if (response.errCode !== 0 || !positiveId(response.postId)) throw new Error('Invalid creation receipt');
    const [, affected] = await db.sequelize.query(`UPDATE job_request_keys SET postId = ?, responseJson = ?
        WHERE userId = ? AND requestKey = ? AND postId IS NULL`, {
        replacements: [response.postId, JSON.stringify(response), userId, key], transaction
    });
    if (affected !== 1 && affected?.affectedRows !== 1) throw new Error('Cannot finalize legacy posting request');
    return response;
};
