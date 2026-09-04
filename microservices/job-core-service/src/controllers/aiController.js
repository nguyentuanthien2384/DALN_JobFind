import crypto from 'node:crypto';
import { pool } from '../libs/db.js';
import { publish } from '../../../shared/rabbitmq.js';
import { EVENTS } from '../../../shared/events.js';
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

const createTask = async (type, userId, input) => {
    const id = crypto.randomUUID();
    const now = new Date();
    await pool.query(
        'INSERT INTO ai_tasks (id, type, status, userId, input, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)',
        [id, type, 'pending', userId, JSON.stringify(input).slice(0, 60000), now, now]
    );
    return id;
};

const userIdOf = (req) => (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null);

// Boc tach CV: nhan file PDF dang base64, tra ve JSON co cau truc.
export const parseResume = async (req, res) => {
    const { fileBase64, fileName } = req.body || {};
    if (!fileBase64) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu file CV' });
    }
    const taskId = await createTask('parse_resume', userIdOf(req), { fileName });
    await publish(EVENTS.AI_PARSE_RESUME, { taskId, fileBase64, fileName });
    return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang phân tích CV' });
};

// Cham diem do khop giua CV va mo ta cong viec.
export const matchCv = async (req, res) => {
    const { resumeText, jobId } = req.body || {};
    if (!resumeText || !jobId) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu nội dung CV hoặc mã tin tuyển dụng' });
    }

    const [rows] = await pool.query(
        `SELECT d.name, d.descriptionHTML FROM posts p
         JOIN detailposts d ON d.id = p.detailPostId
         JOIN users u ON u.id = p.userId
         JOIN companies c ON c.id = u.companyId
         WHERE p.id = ? AND p.statusCode = 'PS1'
           AND c.statusCode = 'S1' AND c.censorCode = 'CS1'`,
        [jobId]
    );
    if (!rows.length) {
        return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' });
    }

    const taskId = await createTask('match_cv', userIdOf(req), { jobId });
    await publish(EVENTS.AI_MATCH_CV, {
        taskId,
        resumeText,
        jobTitle: rows[0].name,
        jobDescription: rows[0].descriptionHTML
    });
    return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang chấm độ khớp' });
};

// Sinh thu ung tuyen bang tieng Anh.
export const coverLetter = async (req, res) => {
    const { resumeText, jobId, language } = req.body || {};
    if (!resumeText || !jobId) {
        return res.status(400).json({ errCode: 1, errMessage: 'Thiếu nội dung CV hoặc mã tin tuyển dụng' });
    }

    const [rows] = await pool.query(
        `SELECT d.name, d.descriptionHTML, c.name AS companyName
         FROM posts p
         JOIN detailposts d ON d.id = p.detailPostId
         JOIN users u ON u.id = p.userId
         JOIN companies c ON c.id = u.companyId
         WHERE p.id = ? AND p.statusCode = 'PS1'
           AND c.statusCode = 'S1' AND c.censorCode = 'CS1'`,
        [jobId]
    );
    if (!rows.length) {
        return res.status(404).json({ errCode: 2, errMessage: 'Không tìm thấy tin tuyển dụng' });
    }

    const taskId = await createTask('cover_letter', userIdOf(req), { jobId, language });
    await publish(EVENTS.AI_COVER_LETTER, {
        taskId,
        resumeText,
        jobTitle: rows[0].name,
        jobDescription: rows[0].descriptionHTML,
        companyName: rows[0].companyName || 'the company',
        language: language || 'en'
    });
    return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang soạn thư ứng tuyển' });
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
