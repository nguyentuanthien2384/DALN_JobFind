import { pool } from '../libs/db.js';
import { enqueueAiTask } from '../libs/aiTaskRequest.js';
import { isValidAiPdf, MAX_AI_PDF_BASE64_LENGTH } from '../../../shared/aiPdf.js';
import { userIdOf, validJobId, recruiterRole, roleOf, recruiterJob, requestFailed } from './aiController.js';

// AI ho tro viet va loc ho so trong quy trinh tuyen dung. Moi ket qua chi la goi y:
// nguoi dung sua roi tu gui; AI khong gui email, tin nhan hay doi trang thai ho so.

const requestError = (code, message) => Object.assign(new Error(message), { code });
const language = (value) => (value === 'en' ? 'en' : 'vi');

// Published job from an approved company, as used by candidate-facing AI.
const publicJob = async (db, jobId) => {
    const [rows] = await db.query(
        `SELECT d.name, d.descriptionHTML, c.name AS companyName FROM posts p
         JOIN detailposts d ON d.id = p.detailPostId
         JOIN users u ON u.id = p.userId
         JOIN companies c ON c.id = u.companyId
         WHERE p.id = ? AND p.statusCode = 'PS1'
           AND c.statusCode = 'S1' AND c.censorCode = 'CS1'`, [jobId]
    );
    if (!rows.length) throw requestError('AI_REQUEST_JOB_NOT_FOUND', 'Job not found');
    return rows[0];
};

// Current company of an active recruiter account, read from the database.
const recruiterCompany = async (db, userId) => {
    const [rows] = await db.query(
        `SELECT c.id AS companyId FROM users viewer
         JOIN accounts viewerAccount ON viewerAccount.userId = viewer.id
         JOIN companies c ON c.id = viewer.companyId
         WHERE viewer.id = ? AND c.statusCode = 'S1' AND c.censorCode = 'CS1'
           AND viewerAccount.statusCode = 'S1' AND viewerAccount.roleCode IN ('COMPANY', 'EMPLOYER')`, [userId]
    );
    const companyId = Number(rows[0]?.companyId);
    if (!Number.isSafeInteger(companyId) || companyId <= 0) throw requestError('AI_REQUEST_FORBIDDEN', 'Recruiter company required');
    return companyId;
};

// A CV submitted to a job of the recruiter's current approved company: the same
// rule the legacy CV viewer applies (canAccessPostApplicants).
const recruiterCv = async (db, userId, cvId, { companyId, withFile = false } = {}) => {
    const [rows] = await db.query(
        `SELECT cv.id, cv.postId AS jobId, d.name, d.descriptionHTML, c.id AS companyId${withFile ? ', cv.file' : ''}
         FROM cvs cv
         JOIN posts p ON p.id = cv.postId
         JOIN detailposts d ON d.id = p.detailPostId
         JOIN users u ON u.id = p.userId
         JOIN companies c ON c.id = u.companyId
         JOIN users viewer ON viewer.id = ? AND viewer.companyId = c.id
         JOIN accounts viewerAccount ON viewerAccount.userId = viewer.id
         WHERE cv.id = ? AND c.statusCode = 'S1' AND c.censorCode = 'CS1'
           AND viewerAccount.statusCode = 'S1' AND viewerAccount.roleCode IN ('COMPANY', 'EMPLOYER')
           ${companyId === undefined ? '' : 'AND c.id = ?'}`,
        companyId === undefined ? [userId, cvId] : [userId, cvId, companyId]
    );
    if (!rows.length) throw requestError('AI_REQUEST_CV_NOT_FOUND', 'CV not found');
    return { ...rows[0], companyId: Number(rows[0].companyId), jobId: Number(rows[0].jobId) };
};

// Legacy applications store the browser's data URL as BLOB text.
export const submittedPdfBase64 = (file) => {
    const text = Buffer.isBuffer(file) ? file.toString('latin1') : typeof file === 'string' ? file : '';
    const encoded = text.startsWith('data:') ? (/^data:application\/pdf;base64,/i.test(text) ? text.slice(text.indexOf(',') + 1) : '') : text;
    if (!isValidAiPdf(encoded)) throw requestError('AI_REQUEST_CV_INVALID', 'Submitted CV is not a valid PDF');
    return encoded;
};

export const ensureAiScreeningTable = async (db = pool) => {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_application_screenings (
        taskId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        cvId INT NOT NULL,
        jobId INT NOT NULL,
        companyId INT NOT NULL,
        requestedBy INT NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        PRIMARY KEY (taskId),
        INDEX idx_ai_screening_job (companyId, jobId, createdAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
};

// Ung vien: viet loi gioi thieu ngan (toi da 255 ky tu) tu CV dang chon de nop.
export const applicationIntro = async (req, res) => {
    const { jobId, fileBase64 } = req.body || {};
    if (typeof fileBase64 === 'string' && fileBase64.length > MAX_AI_PDF_BASE64_LENGTH) {
        return res.status(413).json({ errCode: 1, errMessage: 'Tệp CV vượt giới hạn 5 MiB' });
    }
    if (!validJobId(jobId) || !isValidAiPdf(fileBase64)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Tệp CV phải là PDF hợp lệ tối đa 5 MiB và mã tin hợp lệ' });
    }
    const lang = language(req.body.language);
    try {
        const taskId = await enqueueAiTask({
            type: 'write_assist', userId: userIdOf(req), input: { kind: 'application_intro', jobId: Number(jobId), language: lang },
            requestData: { kind: 'application_intro', fileBase64, jobId: Number(jobId), language: lang },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
                const job = await publicJob(conn, jobId);
                return { kind: 'application_intro', language: lang, jobId: Number(jobId), fileBase64,
                    jobTitle: job.name, jobDescription: job.descriptionHTML || '', companyName: job.companyName || null };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang viết lời giới thiệu' });
    } catch (error) { return requestFailed(res, 'write_assist', error); }
};

// Nha tuyen dung: soan loi nhan them cho email moi phong van / trung tuyen / tu choi.
export const candidateMessage = async (req, res) => {
    const { jobId, emailType, candidateName, recruiterNotes, interviewed } = req.body || {};
    if (!recruiterRole(roleOf(req))) return requestFailed(res, 'write_assist', requestError('AI_REQUEST_FORBIDDEN', 'Recruiter only'));
    if (!validJobId(jobId) || !['interview', 'offer', 'rejection'].includes(emailType)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Loại email hoặc mã tin tuyển dụng không hợp lệ' });
    }
    const lang = language(req.body.language);
    const intent = {
        kind: 'candidate_email', jobId: Number(jobId), emailType, language: lang,
        candidateName: candidateName?.trim() || null, recruiterNotes: recruiterNotes?.trim() || null,
        ...(emailType === 'rejection' && typeof interviewed === 'boolean' && { interviewed })
    };
    try {
        const userId = userIdOf(req);
        const { companyId } = await recruiterJob(pool, userId, jobId);
        const taskId = await enqueueAiTask({
            type: 'write_assist', userId, input: { kind: 'candidate_email', emailType, jobId: Number(jobId), companyId },
            requestData: { ...intent, companyId },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
                const job = await recruiterJob(conn, userId, jobId, companyId);
                return { ...intent, jobTitle: job.name, companyName: job.companyName || null };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang soạn lời nhắn' });
    } catch (error) { return requestFailed(res, 'write_assist', error); }
};

// Ung vien va nha tuyen dung: goi y tra loi hoac viet lai tin nhan nhap. Tin nhan
// chi di qua outbox toi AI Worker; ban ghi ai_tasks khong luu noi dung hoi thoai.
export const chatAssist = async (req, res) => {
    const { mode, messages, draft } = req.body || {};
    const role = roleOf(req);
    if (role !== 'CANDIDATE' && !recruiterRole(role)) {
        return requestFailed(res, 'write_assist', requestError('AI_REQUEST_FORBIDDEN', 'Candidate or recruiter only'));
    }
    if (mode === 'suggest' && messages?.at(-1)?.from !== 'partner') {
        return res.status(400).json({ errCode: 1, errMessage: 'Chưa có tin nhắn mới của đối phương để gợi ý trả lời' });
    }
    const kind = mode === 'suggest' ? 'chat_reply' : 'chat_polish';
    const intent = {
        kind, language: language(req.body.language), senderRole: role === 'CANDIDATE' ? 'candidate' : 'recruiter',
        messages: (messages || []).map(({ from, text }) => ({ from, text })), ...(kind === 'chat_polish' && { draft })
    };
    try {
        const userId = userIdOf(req);
        const companyId = recruiterRole(role) ? await recruiterCompany(pool, userId) : undefined;
        const taskId = await enqueueAiTask({
            type: 'write_assist', userId, input: { kind, ...(companyId && { companyId }) },
            requestData: { ...intent, ...(companyId && { companyId }) },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn) => {
                if (companyId && await recruiterCompany(conn, userId) !== companyId) throw requestError('AI_REQUEST_FORBIDDEN', 'Company changed');
                return intent;
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: mode === 'suggest' ? 'Đang gợi ý câu trả lời' : 'Đang viết lại tin nhắn' });
    } catch (error) { return requestFailed(res, 'write_assist', error); }
};

// Nha tuyen dung: AI cham CV da nop vao tin cua cong ty. Doc PDF tu CSDL tai may
// chu, nen trinh duyet khong phai tai CV ve roi gui nguoc len.
export const screenApplication = async (req, res) => {
    const { cvId } = req.body || {};
    if (!recruiterRole(roleOf(req))) return requestFailed(res, 'match_cv', requestError('AI_REQUEST_FORBIDDEN', 'Recruiter only'));
    if (!validJobId(cvId)) return res.status(400).json({ errCode: 1, errMessage: 'Mã hồ sơ không hợp lệ' });
    try {
        const userId = userIdOf(req);
        const target = await recruiterCv(pool, userId, cvId);
        const taskId = await enqueueAiTask({
            type: 'match_cv', userId, input: { jobId: target.jobId, companyId: target.companyId, cvId: Number(cvId) },
            requestData: { cvId: Number(cvId), companyId: target.companyId },
            idempotencyKey: req.headers['idempotency-key'],
            payload: async (conn, taskId) => {
                const cv = await recruiterCv(conn, userId, cvId, { companyId: target.companyId, withFile: true });
                const fileBase64 = submittedPdfBase64(cv.file);
                await conn.query(`INSERT INTO ai_application_screenings
                    (taskId, cvId, jobId, companyId, requestedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
                [taskId, Number(cvId), cv.jobId, cv.companyId, userId, new Date()]);
                return { fileBase64, fileName: null, jobId: cv.jobId, jobTitle: cv.name, jobDescription: cv.descriptionHTML || '' };
            }
        });
        return res.status(202).json({ errCode: 0, taskId, errMessage: 'Đang chấm hồ sơ bằng AI' });
    } catch (error) { return requestFailed(res, 'match_cv', error); }
};

const MATCH_FIELDS = ['score', 'verdict', 'summary', 'matchedSkills', 'missingSkills', 'strengths', 'concerns'];

// Ket qua AI moi nhat cho tung CV da nop vao mot tin cua cong ty.
export const listJobScreenings = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!recruiterRole(roleOf(req))) return requestFailed(res, 'match_cv', requestError('AI_REQUEST_FORBIDDEN', 'Recruiter only'));
    try {
        const { companyId } = await recruiterJob(pool, userIdOf(req), req.params.id);
        const [rows] = await pool.query(
            `SELECT s.cvId, s.taskId, s.createdAt, t.status, t.result, t.error, t.updatedAt
             FROM ai_application_screenings s
             JOIN ai_tasks t ON t.id = s.taskId
             WHERE s.companyId = ? AND s.jobId = ?
             ORDER BY s.createdAt DESC LIMIT 2000`,
            [companyId, Number(req.params.id)]
        );
        const latest = new Map();
        for (const row of rows) {
            if (latest.has(row.cvId)) continue;
            let result = null;
            try { result = row.status === 'done' && row.result ? JSON.parse(row.result) : null; } catch { result = null; }
            latest.set(row.cvId, {
                cvId: row.cvId, taskId: row.taskId, status: row.status, error: row.status === 'failed' ? row.error : null,
                createdAt: row.createdAt, updatedAt: row.updatedAt,
                ...(result && Object.fromEntries(MATCH_FIELDS.filter((field) => result[field] !== undefined).map((field) => [field, result[field]])))
            });
        }
        return res.json({ errCode: 0, data: [...latest.values()] });
    } catch (error) { return requestFailed(res, 'match_cv', error); }
};
