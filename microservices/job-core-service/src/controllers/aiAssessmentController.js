import { pool } from '../libs/db.js';
import { enqueueAiTask } from '../libs/aiTaskRequest.js';
import { domainLabelOf, normalizeDomainCode } from '../../../shared/assessmentTemplates.js';
import { recruiterRole, roleOf, userIdOf, requestFailed } from './aiController.js';

const lookupDomainLabel = async (domainCode) => {
    const code = normalizeDomainCode(domainCode);
    if (!code) return 'Chưa xác định lĩnh vực';
    const [rows] = await pool.query(
        `SELECT value FROM allcodes WHERE type = 'JOBTYPE' AND LOWER(code) = ? LIMIT 1`,
        [code]
    );
    return rows[0]?.value || domainLabelOf(code);
};

// Noi bo: Application Service goi de xep hang tac vu AI tao/cham bai test ma van
// tai su dung bang ai_tasks, outbox_events, va AI Worker chung cua job-core-service.
export const createAssessmentTask = async (req, res) => {
    const role = roleOf(req);
    const userId = userIdOf(req);
    if (!recruiterRole(role) || !Number.isSafeInteger(userId) || userId <= 0) {
        return res.status(403).json({ errCode: 403, errMessage: 'Chỉ nhà tuyển dụng mới có quyền yêu cầu AI hỗ trợ bài test' });
    }
    const { type, input, requestData, payload } = req.body || {};
    if (!['generate_assessment', 'grade_assessment'].includes(type)) {
        return res.status(400).json({ errCode: 1, errMessage: 'Loại tác vụ AI bài test không hợp lệ' });
    }

    try {
        const domainCode = normalizeDomainCode(payload?.domainCode || '');
        const resolvedLabel = payload?.domainLabel || await lookupDomainLabel(domainCode);
        const finalPayload = {
            ...payload,
            domainCode: domainCode || payload?.domainCode || '',
            domainLabel: resolvedLabel
        };
        const taskId = await enqueueAiTask({
            type,
            userId,
            input,
            requestData,
            idempotencyKey: req.headers['idempotency-key'],
            payload: finalPayload
        });
        return res.status(202).json({
            errCode: 0,
            taskId,
            errMessage: type === 'generate_assessment' ? 'Đang tạo bài test bằng AI theo đúng lĩnh vực' : 'Đang chấm bài test bằng AI'
        });
    } catch (error) {
        return requestFailed(res, type, error);
    }
};

export const getAssessmentTask = async (req, res) => {
    try {
        const [[row]] = await pool.query(
            `SELECT id, type, status, userId, input, result, error, createdAt, updatedAt
             FROM ai_tasks WHERE id = ? LIMIT 1`,
            [req.params.taskId]
        );
        if (!row) {
            return res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy tác vụ AI' });
        }
        let parsedResult = null;
        let parsedInput = null;
        try { parsedResult = row.result ? JSON.parse(row.result) : null; } catch { parsedResult = null; }
        try { parsedInput = row.input ? JSON.parse(row.input) : null; } catch { parsedInput = null; }
        return res.json({
            errCode: 0,
            data: {
                id: row.id,
                type: row.type,
                status: row.status,
                userId: Number(row.userId),
                input: parsedInput,
                result: parsedResult,
                error: row.error || null,
                createdAt: new Date(row.createdAt).toISOString(),
                updatedAt: new Date(row.updatedAt).toISOString()
            }
        });
    } catch {
        return res.status(500).json({ errCode: 500, errMessage: 'Không đọc được kết quả tác vụ AI' });
    }
};
