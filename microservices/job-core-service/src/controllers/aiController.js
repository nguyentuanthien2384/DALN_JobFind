import { pool } from '../libs/db.js';
import { enqueueAiTask } from '../libs/aiTaskRequest.js';
import { createLogger } from '../../../shared/logger.js';
import { isValidAiPdf, MAX_AI_PDF_BASE64_LENGTH } from '../../../shared/aiPdf.js';

const logger = createLogger('job-core-service');

// AI Worker chay bat dong bo: request tra ve ngay mot taskId, ket qua den sau.
// Bang nay la cho hen gap giua hai ben. Tao rieng mot bang moi, khong dung vao
// bang nao san co, nen viec them he thong microservice khong anh huong backend cu.
export const ensureAiTaskTable = async (db = pool) => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS ai_tasks (
            id VARCHAR(64) PRIMARY KEY,
            type VARCHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            userId INT NULL,
            input LONGTEXT NULL,
            result LONGTEXT NULL,
            error TEXT NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            INDEX idx_ai_tasks_user (userId),
            INDEX idx_ai_tasks_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    logger.info('bang ai_tasks da san sang');
};

const userIdOf = (req) => (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null);
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const optionalString = (value) => value == null || typeof value === 'string';
const validJobId = (value) => (typeof value === 'number' || typeof value === 'string')
    && /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const validLanguage = (value) => value == null || value === '' || value === 'vi' || value === 'en';
const recruiterRole = (role) => ['COMPANY', 'EMPLOYER'].includes(role);

// Replays must recheck tenant access even though the immutable job snapshot is
// reused. Read membership from the database, never from client-supplied metadata.
const recruiterJob = async (db, userId, jobId, companyId) => {
    const [rows] = await db.query(
        `SELECT d.name, d.descriptionHTML, c.id AS companyId FROM posts p
         JOIN detailposts d ON d.id = p.detailPostId
         JOIN users u ON u.id = p.userId
         JOIN companies c ON c.id = u.companyId
         JOIN users viewer ON viewer.id = ? AND viewer.companyId = c.id
         JOIN accounts viewerAccount ON viewerAccount.userId = viewer.id
         WHERE p.id = ? AND c.statusCode = 'S1' AND c.censorCode = 'CS1'
           AND viewerAccount.statusCode = 'S1' AND viewerAccount.roleCode IN ('COMPANY', 'EMPLOYER')
           ${companyId === undefined ? '' : 'AND c.id = ?'}`,
        companyId === undefined ? [userId, jobId] : [userId, jobId, companyId]
    );
    if (!rows.length || !Number.isSafeInteger(Number(rows[0].companyId)) || Number(rows[0].companyId) <= 0) {
        throw Object.assign(new Error('Job not found'), { code: 'AI_REQUEST_JOB_NOT_FOUND' });
    }
    return { ...rows[0], companyId: Number(rows[0].companyId) };
};

const requestFailed = (res, type, error) => {
    if (error.code === 'AI_REQUEST_TOO_LARGE') {
        return res.status(413).json({ errCode: 1, errMessage: 'Dữ liệu yêu cầu AI vượt giới hạn 8 MiB' });
    }
    const expected = {
        AI_REQUEST_KEY_INVALID: [400, 'Mã gửi lại yêu cầu không hợp lệ'],
        AI_REQUEST_UNAUTHORIZED: [401, 'Bạn cần đăng nhập để gửi yêu cầu AI'],
        AI_REQUEST_KEY_CONFLICT: [409, 'Mã gửi lại đã được dùng cho nội dung khác'],
        AI_REQUEST_STATE_CONFLICT: [409, 'Yêu cầu đã lưu cần được kiểm tra, không thể tự tạo lại'],
        AI_REQUEST_JOB_NOT_FOUND: [404, 'Không tìm thấy tin tuyển dụng']
    };
    if (Object.hasOwn(expected, error.code)) {
        const [status, errMessage] = expected[error.code];
        return res.status(status).json({ errCode: status === 404 ? 2 : status, errMessage });
    }
    // MySQL error messages/SQL can contain CV data. Log only an error code.
    logger.error('khong luu duoc yeu cau AI', { type, code: error.code || 'AI_REQUEST_FAILED' });
    return res.status(500).json({ errCode: -1, errMessage: 'Không thể xác nhận đã lưu yêu cầu AI' });
};

// Boc tach CV: nhan file PDF dang base64, tra ve JSON co cau truc.
export const parseResume = async (req, res) => {
    const { fileBase64, fileName } = req.body || {};
    if (typeof fileBase64 === 'string' && fileBase64.length > MAX_AI_PDF_BASE64_LENGTH) {
        return res.status(413).json({ errCode: 1, errMessage: 'Tệp CV vượt giới hạn 5 MiB' });
    }
    if (!isValidAiPdf(fileBase64) || !optionalString(fileName)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Tệp CV phải là PDF hợp lệ, tối đa 5 MiB' });
    }
    try {
        const taskId = await enqueueAiTask({
            type: 'parse_resume', userId: userIdOf(req), input: { fileName },
            payload: { fileBase64, fileName },
            requestData: { fileBase64, fileName: fileName ?? null },
            idempotencyKey: req.headers['idempotency-key']
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang phân tích CV' });
    } catch (error) { return requestFailed(res, 'parse_resume', error); }
};

// Build an editable CV from the candidate's own notes, with optional job context.
export const generateCv = async (req, res) => {
    const { sourceText, jobId, language } = req.body || {};
    if (!nonEmptyString(sourceText) || sourceText.length > 20000
        || (jobId !== undefined && (!Number.isSafeInteger(jobId) || jobId <= 0))
        || !['vi', 'en'].includes(language)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Nhập thông tin CV tối đa 20.000 ký tự, mã tin và ngôn ngữ hợp lệ' });
    }
    try {
        const taskId = await enqueueAiTask({
            type: 'generate_cv', userId: userIdOf(req), input: { jobId, language },
            requestData: { sourceText, jobId: jobId ?? null, language },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
                if (jobId === undefined) return { sourceText, language };
                const [rows] = await conn.query(
                    `SELECT d.name, d.descriptionHTML FROM posts p
                     JOIN detailposts d ON d.id = p.detailPostId
                     JOIN users u ON u.id = p.userId
                     JOIN companies c ON c.id = u.companyId
                     WHERE p.id = ? AND p.statusCode = 'PS1'
                       AND c.statusCode = 'S1' AND c.censorCode = 'CS1'`, [jobId]
                );
                if (!rows.length) throw Object.assign(new Error('Job not found'), { code: 'AI_REQUEST_JOB_NOT_FOUND' });
                return { sourceText, language, jobId, jobTitle: rows[0].name, jobDescription: rows[0].descriptionHTML };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang tạo bản nháp CV' });
    } catch (error) { return requestFailed(res, 'generate_cv', error); }
};

// Cham diem do khop giua CV va mo ta cong viec.
export const matchCv = async (req, res) => {
    const { resumeText, fileBase64, fileName, jobId } = req.body || {};
    const fromPdf = fileBase64 !== undefined;
    if (typeof fileBase64 === 'string' && fileBase64.length > MAX_AI_PDF_BASE64_LENGTH) {
        return res.status(413).json({ errCode: 1, errMessage: 'Tệp CV vượt giới hạn 5 MiB' });
    }
    if (!validJobId(jobId) || (fromPdf
        ? resumeText !== undefined || !isValidAiPdf(fileBase64) || !optionalString(fileName) || (fileName?.length || 0) > 255
        : !nonEmptyString(resumeText) || resumeText.length > 10000 || fileName !== undefined)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Nội dung CV hoặc mã tin tuyển dụng không hợp lệ' });
    }
    const resume = fromPdf ? { fileBase64, fileName: fileName ?? null } : { resumeText };
    const recruiter = recruiterRole(req.user?.roleCode || req.headers['x-user-role']);

    try {
        const companyId = recruiter ? (await recruiterJob(pool, userIdOf(req), jobId)).companyId : undefined;
        const taskId = await enqueueAiTask({
            type: 'match_cv', userId: userIdOf(req), input: { jobId, ...(recruiter && { companyId }) },
            requestData: { ...resume, jobId: Number(jobId), ...(recruiter && { companyId }) },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
                if (recruiter) {
                    const job = await recruiterJob(conn, userIdOf(req), jobId, companyId);
                    return { ...resume, jobTitle: job.name, jobDescription: job.descriptionHTML };
                }
                const [rows] = await conn.query(
                    `SELECT d.name, d.descriptionHTML FROM posts p
                     JOIN detailposts d ON d.id = p.detailPostId
                     JOIN users u ON u.id = p.userId
                     JOIN companies c ON c.id = u.companyId
                     WHERE p.id = ? AND p.statusCode = 'PS1'
                       AND c.statusCode = 'S1' AND c.censorCode = 'CS1'`,
                    [jobId]
                );
                if (!rows.length) throw Object.assign(new Error('Job not found'), { code: 'AI_REQUEST_JOB_NOT_FOUND' });
                return { ...resume, jobTitle: rows[0].name, jobDescription: rows[0].descriptionHTML };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang chấm độ khớp' });
    } catch (error) { return requestFailed(res, 'match_cv', error); }
};

// Sinh thu ung tuyen bang tieng Anh.
export const coverLetter = async (req, res) => {
    const { resumeText, jobId, language } = req.body || {};
    if (!nonEmptyString(resumeText) || !validJobId(jobId) || !validLanguage(language)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Nội dung CV, mã tin hoặc ngôn ngữ không hợp lệ' });
    }

    try {
        const taskId = await enqueueAiTask({
            type: 'cover_letter', userId: userIdOf(req), input: { jobId, language },
            requestData: { resumeText, jobId: Number(jobId), language: language || 'en' },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
                const [rows] = await conn.query(
                    `SELECT d.name, d.descriptionHTML, c.name AS companyName
                     FROM posts p
                     JOIN detailposts d ON d.id = p.detailPostId
                     JOIN users u ON u.id = p.userId
                     JOIN companies c ON c.id = u.companyId
                     WHERE p.id = ? AND p.statusCode = 'PS1'
                       AND c.statusCode = 'S1' AND c.censorCode = 'CS1'`,
                    [jobId]
                );
                if (!rows.length) throw Object.assign(new Error('Job not found'), { code: 'AI_REQUEST_JOB_NOT_FOUND' });
                return {
                    resumeText, jobTitle: rows[0].name, jobDescription: rows[0].descriptionHTML,
                    companyName: rows[0].companyName || 'the company', language: language || 'en'
                };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang soạn thư ứng tuyển' });
    } catch (error) { return requestFailed(res, 'cover_letter', error); }
};

// Client hoi ket qua bang taskId nhan duoc luc gui yeu cau.
export const getTask = async (req, res) => {
    const userId = userIdOf(req);
    const role = req.user?.roleCode || req.headers['x-user-role'];
    const [rows] = await pool.query('SELECT * FROM ai_tasks WHERE id = ?', [req.params.taskId]);
    if (!rows.length) {
        return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy yêu cầu' });
    }

    const task = rows[0];
    // Ket qua AI co the chua noi dung CV cua nguoi dung, khong de nguoi khac xem.
    if (role !== 'ADMIN' && (task.userId === null || task.userId !== userId
        || (recruiterRole(role) && task.type !== 'match_cv'))) {
        return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền xem kết quả này' });
    }

    if (role !== 'ADMIN') {
        let input;
        try { input = typeof task.input === 'string' ? JSON.parse(task.input) : task.input; }
        catch { return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền xem kết quả này' }); }
        // A recruiter result remains owned by its original company even if the
        // actor moves companies, loses approval or becomes a candidate later.
        if (recruiterRole(role) || input?.companyId !== undefined) {
            if (!recruiterRole(role) || !Number.isSafeInteger(input?.companyId) || input.companyId <= 0) {
                return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền xem kết quả này' });
            }
            const [membership] = await pool.query(
                `SELECT c.id AS companyId FROM users viewer
                 JOIN accounts viewerAccount ON viewerAccount.userId = viewer.id
                 JOIN companies c ON c.id = viewer.companyId
                 WHERE viewer.id = ? AND c.id = ? AND c.statusCode = 'S1' AND c.censorCode = 'CS1'
                   AND viewerAccount.statusCode = 'S1' AND viewerAccount.roleCode IN ('COMPANY', 'EMPLOYER')`,
                [userId, input.companyId]
            );
            if (!membership.length) return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền xem kết quả này' });
        }
    }

    return res.json({
        errCode: 0,
        data: {
            id: task.id,
            type: task.type,
            status: task.status,
            result: task.result ? JSON.parse(task.result) : null,
            error: task.error,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
        }
    });
};

// Kept as a re-export for existing imports; result handling owns its transaction.
export { handleAiResult } from '../libs/aiResultHandler.js';
