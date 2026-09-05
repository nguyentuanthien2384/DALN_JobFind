import { pool } from '../libs/db.js';
import { enqueueAiTask } from '../libs/aiTaskRequest.js';
import { createLogger } from '../../../shared/logger.js';

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
    if (!nonEmptyString(fileBase64) || !optionalString(fileName)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu file CV hoặc tên file không hợp lệ' });
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

// Cham diem do khop giua CV va mo ta cong viec.
export const matchCv = async (req, res) => {
    const { resumeText, jobId } = req.body || {};
    if (!nonEmptyString(resumeText) || !validJobId(jobId)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Nội dung CV hoặc mã tin tuyển dụng không hợp lệ' });
    }

    try {
        const taskId = await enqueueAiTask({
            type: 'match_cv', userId: userIdOf(req), input: { jobId },
            requestData: { resumeText, jobId: Number(jobId) },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
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
                return { resumeText, jobTitle: rows[0].name, jobDescription: rows[0].descriptionHTML };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang chấm độ khớp' });
    } catch (error) { return requestFailed(res, 'match_cv', error); }
};

// Sinh thu ung tuyen bang tieng Anh.
export const coverLetter = async (req, res) => {
    const { resumeText, jobId, language } = req.body || {};
    if (!nonEmptyString(resumeText) || !validJobId(jobId) || !optionalString(language)) {
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
    const role = req.headers['x-user-role'];
    const [rows] = await pool.query('SELECT * FROM ai_tasks WHERE id = ?', [req.params.taskId]);
    if (!rows.length) {
        return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy yêu cầu' });
    }

    const task = rows[0];
    // Ket qua AI co the chua noi dung CV cua nguoi dung, khong de nguoi khac xem.
    if (role !== 'ADMIN' && task.userId !== null && task.userId !== userId) {
        return res.status(403).json({ errCode: 3, errMessage: 'Bạn không có quyền xem kết quả này' });
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
