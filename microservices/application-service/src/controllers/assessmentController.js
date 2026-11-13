import { pool, withTransaction } from '../libs/db.js';
import { getJobDomainContext } from '../libs/jobCatalog.js';
import {
    computeMcqAutoEvaluation,
    domainLabelOf,
    findTemplateById,
    getTemplatesForDomain,
    listAllDomainTemplates,
    normalizeDomainCode,
    normalizeQuestions,
    sanitizeQuestionsForCandidate,
    toTenScale,
    DOMAIN_LABELS
} from '../../../shared/assessmentTemplates.js';

const RECRUITER_ROLES = new Set(['COMPANY', 'EMPLOYER']);
const POSITIVE_INT = /^[1-9][0-9]*$/;
const parsePositiveId = (value) => {
    if (value === undefined || value === null || !POSITIVE_INT.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
};

const callerIdentity = (req) => ({
    userId: parsePositiveId(req.headers['x-user-id']),
    roleCode: String(req.headers['x-user-role'] || '').trim().toUpperCase(),
    companyId: parsePositiveId(req.headers['x-company-id'])
});

const requireRecruiterIdentity = (req, res) => {
    const identity = callerIdentity(req);
    if (!identity.userId) {
        res.status(401).json({ errCode: 401, errMessage: 'Chưa xác thực danh tính người dùng' });
        return null;
    }
    if (!RECRUITER_ROLES.has(identity.roleCode) || !identity.companyId) {
        res.status(403).json({
            errCode: 403,
            errMessage: 'Chỉ nhà tuyển dụng thuộc doanh nghiệp đã duyệt mới được tạo hoặc chấm bài test ứng viên'
        });
        return null;
    }
    return identity;
};

const loadScopedApplicationForRecruiter = async (applicationId, identity, res, { allowAdminRead = false } = {}) => {
    const appId = parsePositiveId(applicationId);
    if (!appId) {
        res.status(400).json({ errCode: 1, errMessage: 'Mã hồ sơ ứng tuyển không hợp lệ' });
        return null;
    }
    const { rows } = await pool.query('SELECT * FROM applications WHERE id = $1 LIMIT 1', [appId]);
    if (!rows.length) {
        res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy hồ sơ ứng tuyển' });
        return null;
    }
    const application = rows[0];
    if (!(allowAdminRead && identity.roleCode === 'ADMIN') && Number(application.company_id) !== identity.companyId) {
        res.status(403).json({ errCode: 403, errMessage: 'Không có quyền truy cập hồ sơ của công ty khác' });
        return null;
    }
    return application;
};

const resolveJobDomain = async (application) => {
    const jobCtx = await getJobDomainContext(application.job_id);
    const snapshotDomain = normalizeDomainCode(application.cv_snapshot?.categoryJobCode || '');
    const domainCode = normalizeDomainCode(jobCtx?.categoryJobCode || snapshotDomain || '');
    const domainLabel = domainCode ? domainLabelOf(domainCode, jobCtx?.domainLabel || null) : null;
    return {
        domainCode: domainCode || null,
        domainLabel,
        jobTitle: jobCtx?.jobTitle || application.job_title || 'Vị trí tuyển dụng',
        descriptionHTML: jobCtx?.descriptionHTML || ''
    };
};

const toNumOrNull = (val) => (val === null || val === undefined ? null : Number(val));
const toIsoOrNull = (val) => (val ? new Date(val).toISOString() : null);

/**
 * Records an assessment lifecycle event in `application_events` using the table's `reason` column.
 */
const recordAssessmentEvent = (client, { applicationId, stage, actorId, reason }) => client.query(
    `INSERT INTO application_events (application_id, from_stage, to_stage, actor_id, reason)
     VALUES ($1, $2, $2, $3, $4)`,
    [applicationId, stage, actorId, reason]
);

const serializeAssessment = (row, { forCandidate = false } = {}) => {
    if (!row) return null;
    const isGraded = row.status === 'GRADED';
    const questions = Array.isArray(row.questions) ? row.questions : [];
    const safeQuestions = forCandidate
        ? sanitizeQuestionsForCandidate(questions, { includeSolutions: isGraded })
        : questions;

    const remainingSeconds = row.time_limit_seconds && row.started_at && !row.submitted_at
        ? Math.max(0, Number(row.time_limit_seconds) - Math.floor((Date.now() - new Date(row.started_at).getTime()) / 1000))
        : row.time_limit_seconds ?? null;

    return {
        id: Number(row.id),
        applicationId: Number(row.application_id),
        jobId: Number(row.job_id),
        companyId: Number(row.company_id),
        candidateId: Number(row.candidate_id),
        domainCode: row.domain_code,
        domainLabel: row.domain_label,
        templateId: row.template_id ?? null,
        title: row.title,
        description: row.description ?? null,
        instructions: row.instructions ?? null,
        timeLimitSeconds: row.time_limit_seconds ?? null,
        timeLimitMinutes: row.time_limit_seconds ? Math.round(Number(row.time_limit_seconds) / 60) : null,
        remainingSeconds,
        questions: safeQuestions,
        status: row.status,
        answers: row.answers ?? null,
        startedAt: toIsoOrNull(row.started_at),
        submittedAt: toIsoOrNull(row.submitted_at),
        timeSpentSeconds: row.time_spent_seconds ?? null,
        isOvertime: Boolean(row.is_overtime),
        mcqScore: forCandidate && !isGraded ? null : toNumOrNull(row.mcq_score),
        mcqAutoResults: forCandidate && !isGraded ? null : (row.mcq_auto_results ?? null),
        earnedPoints: forCandidate && !isGraded ? null : toNumOrNull(row.earned_points),
        maxScore: toNumOrNull(row.max_score) ?? 0,
        totalScore: forCandidate && !isGraded ? null : toNumOrNull(row.total_score),
        gradingMode: row.grading_mode ?? null,
        gradingFeedback: forCandidate && !isGraded ? null : (row.grading_feedback ?? null),
        aiGradeTaskId: forCandidate ? null : (row.ai_grade_task_id ?? null),
        gradedBy: forCandidate ? null : (row.graded_by ? Number(row.graded_by) : null),
        gradedAt: toIsoOrNull(row.graded_at),
        createdAt: toIsoOrNull(row.created_at),
        updatedAt: toIsoOrNull(row.updated_at)
    };
};

const serializeCompanyTemplate = (row) => ({
    id: Number(row.id),
    domainCode: row.domain_code,
    domainLabel: row.domain_label,
    title: row.title,
    description: row.description ?? null,
    difficulty: row.difficulty || 'MID',
    timeLimitMinutes: row.time_limit_minutes ?? 40,
    questions: row.questions || [],
    source: 'company',
    createdAt: toIsoOrNull(row.created_at)
});

const jobCoreUrl = () => (process.env.JOB_CORE_URL || 'http://job-core-service:4002').replace(/\/$/, '');

const callJobCoreInternal = async (path, { method = 'GET', req, body } = {}) => {
    const response = await fetch(`${jobCoreUrl()}${path}`, {
        method,
        headers: {
            'x-internal-secret': process.env.INTERNAL_SECRET || '',
            ...(req?.headers?.['x-user-id'] ? { 'x-user-id': String(req.headers['x-user-id']) } : {}),
            ...(req?.headers?.['x-user-role'] ? { 'x-user-role': String(req.headers['x-user-role']) } : {}),
            ...(req?.headers?.['x-company-id'] ? { 'x-company-id': String(req.headers['x-company-id']) } : {}),
            ...(req?.headers?.['idempotency-key'] ? { 'idempotency-key': String(req.headers['idempotency-key']) } : {}),
            ...(body !== undefined ? { 'content-type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
};

const loadTemplatesByDomain = async ({ companyId, domainCode }) => {
    const normalized = normalizeDomainCode(domainCode);
    const builtin = normalized
        ? getTemplatesForDomain(normalized).map((tpl) => ({ ...tpl, source: 'builtin' }))
        : listAllDomainTemplates().map((tpl) => ({ ...tpl, source: 'builtin' }));

    const params = [companyId];
    let sql = `SELECT * FROM domain_test_templates WHERE company_id = $1`;
    if (normalized) {
        params.push(normalized);
        sql += ` AND domain_code = $2`;
    }
    sql += ` ORDER BY updated_at DESC, id DESC`;
    const { rows } = await pool.query(sql, params);
    const custom = rows.map(serializeCompanyTemplate);
    return [...custom, ...builtin];
};

// =================== NHA TUYEN DUNG: KHO DE THEO LINH VUC ===================

export const listDomainTemplates = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = callerIdentity(req);
    if (!identity.userId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác thực' });
    if (identity.roleCode !== 'ADMIN' && (!RECRUITER_ROLES.has(identity.roleCode) || !identity.companyId)) {
        return res.status(403).json({ errCode: 403, errMessage: 'Cần tài khoản doanh nghiệp để xem kho đề' });
    }
    const requestedDomain = normalizeDomainCode(req.query?.domainCode || '');
    try {
        const companyId = identity.companyId || 0;
        const templates = await loadTemplatesByDomain({ companyId, domainCode: requestedDomain });
        return res.json({
            errCode: 0,
            data: {
                domainCode: requestedDomain || null,
                domainLabel: requestedDomain ? domainLabelOf(requestedDomain) : 'Tất cả lĩnh vực',
                hasPrebuiltTemplates: templates.length > 0,
                supportedDomains: DOMAIN_LABELS,
                templates
            }
        });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không tải được kho đề bài test theo lĩnh vực' });
    }
};

export const saveDomainTemplate = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    const { domainCode, title, description = null, timeLimitMinutes = 40, difficulty = 'MID', questions } = req.body || {};
    const normalizedDomain = normalizeDomainCode(domainCode || '');
    if (!normalizedDomain) {
        return res.status(400).json({ errCode: 1, errMessage: 'Phải chọn đúng mã lĩnh vực cho mẫu bài test' });
    }
    let normalizedQuestions;
    try {
        normalizedQuestions = normalizeQuestions(questions);
    } catch (error) {
        return res.status(400).json({ errCode: 1, errMessage: error.message });
    }
    try {
        const { rows } = await pool.query(
            `INSERT INTO domain_test_templates
               (company_id, domain_code, domain_label, title, description, difficulty, time_limit_minutes, questions, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
             RETURNING *`,
            [
                identity.companyId,
                normalizedDomain,
                domainLabelOf(normalizedDomain),
                title.trim(),
                description ? String(description).trim() : null,
                difficulty || 'MID',
                timeLimitMinutes ?? 40,
                JSON.stringify(normalizedQuestions),
                identity.userId
            ]
        );
        return res.status(201).json({ errCode: 0, data: serializeCompanyTemplate(rows[0]), errMessage: 'Đã lưu mẫu bài test theo lĩnh vực' });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không lưu được mẫu bài test' });
    }
};

export const deleteDomainTemplate = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    const templateId = parsePositiveId(req.params.templateId);
    if (!templateId) return res.status(400).json({ errCode: 1, errMessage: 'Mã mẫu không hợp lệ' });
    try {
        const { rowCount } = await pool.query(
            `DELETE FROM domain_test_templates WHERE id = $1 AND company_id = $2`,
            [templateId, identity.companyId]
        );
        if (!rowCount) return res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy mẫu bài test của công ty' });
        return res.json({ errCode: 0, errMessage: 'Đã xóa mẫu bài test' });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không xóa được mẫu bài test' });
    }
};

// =================== NHA TUYEN DUNG: BAI TEST HO SO UNG TUYEN ===================

export const getApplicationAssessmentTemplates = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = callerIdentity(req);
    if (!identity.userId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác thực' });
    if (identity.roleCode !== 'ADMIN' && (!RECRUITER_ROLES.has(identity.roleCode) || !identity.companyId)) {
        return res.status(403).json({ errCode: 403, errMessage: 'Không có quyền truy cập đề thi' });
    }
    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res, { allowAdminRead: true });
        if (!app) return;
        const jobDomain = await resolveJobDomain(app);
        const requestedDomain = normalizeDomainCode(req.query?.domainCode || '');
        if (requestedDomain && jobDomain.domainCode && requestedDomain !== jobDomain.domainCode) {
            return res.status(400).json({
                errCode: 1,
                errMessage: `Không được lấy bài test từ lĩnh vực "${domainLabelOf(requestedDomain)}" sang cho tin tuyển dụng thuộc lĩnh vực "${jobDomain.domainLabel}".`
            });
        }
        if (!jobDomain.domainCode) {
            return res.json({
                errCode: 0,
                data: {
                    domainCode: null,
                    domainLabel: null,
                    hasPrebuiltTemplates: false,
                    templates: []
                }
            });
        }
        const templates = await loadTemplatesByDomain({
            companyId: Number(app.company_id),
            domainCode: jobDomain.domainCode
        });
        return res.json({
            errCode: 0,
            data: {
                domainCode: jobDomain.domainCode,
                domainLabel: jobDomain.domainLabel,
                hasPrebuiltTemplates: templates.length > 0,
                templates
            }
        });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không tải được bộ đề cho hồ sơ ứng tuyển' });
    }
};

export const getApplicationAssessment = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = callerIdentity(req);
    if (!identity.userId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác thực' });
    if (identity.roleCode !== 'ADMIN' && (!RECRUITER_ROLES.has(identity.roleCode) || !identity.companyId)) {
        return res.status(403).json({ errCode: 403, errMessage: 'Không có quyền xem bài test hồ sơ' });
    }
    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res, { allowAdminRead: true });
        if (!app) return;
        const jobDomain = await resolveJobDomain(app);
        const { rows } = await pool.query(
            'SELECT * FROM application_assessments WHERE application_id = $1 LIMIT 1',
            [app.id]
        );
        return res.json({
            errCode: 0,
            data: {
                applicationId: Number(app.id),
                stage: app.stage,
                canCreate: RECRUITER_ROLES.has(identity.roleCode) && app.stage === 'phong_van',
                domainCode: jobDomain.domainCode,
                domainLabel: jobDomain.domainLabel,
                assessment: rows.length ? serializeAssessment(rows[0], { forCandidate: false }) : null
            }
        });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không tải được bài test của ứng viên' });
    }
};

export const upsertApplicationAssessment = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;

    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res);
        if (!app) return;

        // PHAN QUYEN CHAT CHE VONG PHONG VAN CHUYEN SAU
        if (app.stage !== 'phong_van') {
            return res.status(409).json({
                errCode: 409,
                errMessage: 'Chỉ khi ứng viên ở vòng Phỏng vấn chuyên sâu (phong_van), nhà tuyển dụng mới được tùy chọn tạo bài test. Không tạo sẵn ở các vòng khác.'
            });
        }

        const jobDomain = await resolveJobDomain(app);
        if (!jobDomain.domainCode) {
            return res.status(400).json({
                errCode: 1,
                errMessage: 'Tin tuyển dụng chưa có mã lĩnh vực hợp lệ (categoryJobCode) nên chưa thể gán bài test.'
            });
        }

        const body = req.body || {};
        // CHONG COPY CHEO LINH VUC
        if (body.domainCode && normalizeDomainCode(body.domainCode) !== jobDomain.domainCode) {
            return res.status(400).json({
                errCode: 1,
                errMessage: `Bài test phải thuộc đúng lĩnh vực "${jobDomain.domainLabel}" (${jobDomain.domainCode}), tuyệt đối không lấy từ lĩnh vực khác.`
            });
        }

        let resolvedTemplateId = null;
        if (body.templateId) {
            const rawTplId = String(body.templateId).trim();
            let tpl = findTemplateById(rawTplId);
            if (!tpl && POSITIVE_INT.test(rawTplId)) {
                const { rows: tplRows } = await pool.query(
                    'SELECT * FROM domain_test_templates WHERE id = $1 AND company_id = $2 LIMIT 1',
                    [Number(rawTplId), app.company_id]
                );
                if (tplRows.length) tpl = serializeCompanyTemplate(tplRows[0]);
            }
            if (!tpl) {
                return res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy mẫu bài test đã chọn' });
            }
            if (normalizeDomainCode(tpl.domainCode) !== jobDomain.domainCode) {
                return res.status(400).json({
                    errCode: 1,
                    errMessage: `Mẫu bài test thuộc lĩnh vực "${tpl.domainLabel || tpl.domainCode}", không khớp với lĩnh vực "${jobDomain.domainLabel}" của vị trí này.`
                });
            }
            resolvedTemplateId = String(tpl.id);
        }

        let normalizedQuestions;
        try {
            normalizedQuestions = normalizeQuestions(body.questions);
        } catch (error) {
            return res.status(400).json({ errCode: 1, errMessage: error.message });
        }

        const maxScore = Number(normalizedQuestions.reduce((sum, q) => sum + Number(q.points || 0), 0).toFixed(2));
        const timeLimitSeconds = body.timeLimitMinutes ? Number(body.timeLimitMinutes) * 60 : null;

        const saved = await withTransaction(async (client) => {
            const existing = await client.query(
                'SELECT id, status FROM application_assessments WHERE application_id = $1 FOR UPDATE',
                [app.id]
            );
            if (existing.rows.length && ['SUBMITTED', 'GRADED'].includes(existing.rows[0].status)) {
                throw Object.assign(new Error('Ứng viên đã nộp bài test, không thể chỉnh sửa hoặc ghi đè đề thi.'), { statusCode: 409 });
            }

            const result = existing.rows.length
                ? await client.query(
                    `UPDATE application_assessments
                     SET domain_code = $2, domain_label = $3, template_id = $4, title = $5,
                         description = $6, instructions = $7, time_limit_seconds = $8,
                         questions = $9::jsonb, max_score = $10, status = 'ASSIGNED',
                         answers = NULL, started_at = NULL, submitted_at = NULL,
                         time_spent_seconds = NULL, is_overtime = FALSE,
                         mcq_score = NULL, mcq_auto_results = NULL, earned_points = NULL,
                         total_score = NULL, grading_mode = NULL, grading_feedback = NULL,
                         ai_grade_task_id = NULL, graded_by = NULL, graded_at = NULL,
                         updated_at = NOW()
                     WHERE application_id = $1
                     RETURNING *`,
                    [
                        app.id, jobDomain.domainCode, jobDomain.domainLabel, resolvedTemplateId,
                        body.title.trim(), body.description?.trim() || null, body.instructions?.trim() || null,
                        timeLimitSeconds, JSON.stringify(normalizedQuestions), maxScore
                    ]
                )
                : await client.query(
                    `INSERT INTO application_assessments
                       (application_id, job_id, company_id, candidate_id, domain_code, domain_label,
                        template_id, title, description, instructions, time_limit_seconds, questions,
                        status, max_score, created_by)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'ASSIGNED',$13,$14)
                     RETURNING *`,
                    [
                        app.id, app.job_id, app.company_id, app.candidate_id,
                        jobDomain.domainCode, jobDomain.domainLabel, resolvedTemplateId,
                        body.title.trim(), body.description?.trim() || null, body.instructions?.trim() || null,
                        timeLimitSeconds, JSON.stringify(normalizedQuestions), maxScore, identity.userId
                    ]
                );

            if (body.saveAsTemplate) {
                await client.query(
                    `INSERT INTO domain_test_templates
                       (company_id, domain_code, domain_label, title, description, difficulty, time_limit_minutes, questions, created_by)
                     VALUES ($1, $2, $3, $4, $5, 'MID', $6, $7::jsonb, $8)`,
                    [
                        app.company_id, jobDomain.domainCode, jobDomain.domainLabel,
                        body.title.trim(), body.description?.trim() || null,
                        body.timeLimitMinutes ?? 40, JSON.stringify(normalizedQuestions), identity.userId
                    ]
                );
            }

            await recordAssessmentEvent(client, {
                applicationId: app.id,
                stage: app.stage,
                actorId: identity.userId,
                reason: `Đã giao bài test vòng phỏng vấn chuyên sâu (${jobDomain.domainLabel}): ${body.title.trim()}`
            });
            return result.rows[0];
        });

        return res.json({
            errCode: 0,
            data: serializeAssessment(saved, { forCandidate: false }),
            errMessage: 'Đã tạo và giao bài test cho ứng viên trong vòng phỏng vấn'
        });
    } catch (error) {
        if (error.statusCode === 409) {
            return res.status(409).json({ errCode: 409, errMessage: error.message });
        }
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể lưu bài test cho ứng viên' });
    }
};

export const deleteApplicationAssessment = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res);
        if (!app) return;
        if (app.stage !== 'phong_van') {
            return res.status(409).json({
                errCode: 409,
                errMessage: 'Chỉ quản lý bài test trực tiếp khi hồ sơ đang ở vòng Phỏng vấn chuyên sâu'
            });
        }
        await withTransaction(async (client) => {
            const { rows } = await client.query(
                'SELECT id, status, title FROM application_assessments WHERE application_id = $1 FOR UPDATE',
                [app.id]
            );
            if (!rows.length) {
                throw Object.assign(new Error('Ứng viên chưa được giao bài test'), { statusCode: 404 });
            }
            if (['SUBMITTED', 'GRADED'].includes(rows[0].status)) {
                throw Object.assign(new Error('Ứng viên đã nộp bài test, không thể thu hồi đề'), { statusCode: 409 });
            }
            await client.query('DELETE FROM application_assessments WHERE id = $1', [rows[0].id]);
            await recordAssessmentEvent(client, {
                applicationId: app.id,
                stage: app.stage,
                actorId: identity.userId,
                reason: `Đã thu hồi bài test chưa nộp: ${rows[0].title}`
            });
        });
        return res.json({ errCode: 0, errMessage: 'Đã thu hồi bài test của ứng viên' });
    } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 409) {
            return res.status(error.statusCode).json({ errCode: error.statusCode, errMessage: error.message });
        }
        return res.status(500).json({ errCode: -1, errMessage: 'Không thu hồi được bài test' });
    }
};

export const aiGenerateApplicationAssessment = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res);
        if (!app) return;
        if (app.stage !== 'phong_van') {
            return res.status(409).json({
                errCode: 409,
                errMessage: 'Chỉ được nhờ AI tạo bài test khi ứng viên đã vào vòng Phỏng vấn chuyên sâu (phong_van)'
            });
        }
        const jobDomain = await resolveJobDomain(app);
        if (!jobDomain.domainCode) {
            return res.status(400).json({
                errCode: 1,
                errMessage: 'Tin tuyển dụng chưa có mã lĩnh vực hợp lệ nên AI chưa thể tạo bài test chuẩn ngành'
            });
        }

        const {
            questionCount = 5,
            difficulty = 'MID',
            questionMix = 'mixed',
            focusTopics = null,
            language = 'vi'
        } = req.body || {};

        const intent = {
            kind: 'generate_assessment',
            applicationId: Number(app.id),
            jobId: Number(app.job_id),
            companyId: Number(app.company_id),
            domainCode: jobDomain.domainCode,
            questionCount,
            difficulty,
            questionMix,
            focusTopics: focusTopics?.trim() || null,
            language
        };

        const forwarded = await callJobCoreInternal('/internal/ai/assessment-tasks', {
            method: 'POST',
            req,
            body: {
                type: 'generate_assessment',
                input: {
                    applicationId: Number(app.id),
                    jobId: Number(app.job_id),
                    companyId: Number(app.company_id),
                    domainCode: jobDomain.domainCode
                },
                requestData: intent,
                payload: {
                    applicationId: Number(app.id),
                    jobId: Number(app.job_id),
                    companyId: Number(app.company_id),
                    domainCode: jobDomain.domainCode,
                    domainLabel: jobDomain.domainLabel,
                    jobTitle: jobDomain.jobTitle,
                    jobDescription: jobDomain.descriptionHTML || '',
                    questionCount,
                    difficulty,
                    questionMix,
                    focusTopics: focusTopics?.trim() || null,
                    language
                }
            }
        });
        return res.status(forwarded.status).json(forwarded.data);
    } catch {
        return res.status(502).json({ errCode: 502, errMessage: 'Không kết nối được dịch vụ AI tạo bài test' });
    }
};

const finalizeGrading = async ({ app, assessorId, mode, questionScores, overallFeedback, recommendation, strengths = [], improvements = [], aiTaskId = null }) => {
    return withTransaction(async (client) => {
        const { rows } = await client.query(
            'SELECT * FROM application_assessments WHERE application_id = $1 FOR UPDATE',
            [app.id]
        );
        if (!rows.length) {
            throw Object.assign(new Error('Ứng viên chưa được giao bài test'), { statusCode: 404 });
        }
        const assessment = rows[0];
        if (!['SUBMITTED', 'GRADED'].includes(assessment.status)) {
            throw Object.assign(new Error('Chỉ có thể chấm điểm sau khi ứng viên đã nộp bài test'), { statusCode: 409 });
        }
        const assessmentQuestions = Array.isArray(assessment.questions) ? assessment.questions : [];
        const qMap = new Map(assessmentQuestions.map((q) => [q.id, q]));
        const scoreMap = new Map();
        for (const item of questionScores) {
            const q = qMap.get(item.questionId);
            if (!q) {
                throw Object.assign(new Error(`Mã câu hỏi "${item.questionId}" không tồn tại trong đề thi`), { statusCode: 400 });
            }
            const earned = Number(item.earnedPoints);
            const max = Number(q.points || 0);
            if (!Number.isFinite(earned) || earned < 0 || earned > max) {
                throw Object.assign(new Error(`Điểm câu "${item.questionId}" phải trong khoảng [0, ${max}]`), { statusCode: 400 });
            }
            scoreMap.set(item.questionId, {
                questionId: q.id,
                earnedPoints: Number(earned.toFixed(2)),
                maxPoints: Number(max.toFixed(2)),
                passed: earned >= max * 0.6,
                comment: item.comment ? String(item.comment).trim().slice(0, 2000) : ''
            });
        }

        const mcqEval = computeMcqAutoEvaluation(assessmentQuestions, assessment.answers || {});
        const mcqMap = new Map(mcqEval.perQuestion.map((item) => [item.questionId, item]));
        const perQuestion = assessmentQuestions.map((q) => {
            const entry = scoreMap.get(q.id);
            if (entry) {
                // Voi che do AI, luon giu diem MCQ chinh xac tuyet doi tu bo cham tu dong server.
                const mcqItem = mcqMap.get(q.id);
                if (mode === 'AI' && mcqItem?.autoGraded) {
                    return {
                        questionId: q.id,
                        earnedPoints: Number(mcqItem.earnedPoints),
                        maxPoints: Number(q.points || 0),
                        passed: Boolean(mcqItem.isCorrect),
                        comment: entry.comment || (mcqItem.isCorrect ? 'Trắc nghiệm chính xác.' : 'Trắc nghiệm chưa đúng.')
                    };
                }
                return entry;
            }
            const mcqItem = mcqMap.get(q.id);
            if (mcqItem?.autoGraded) {
                return {
                    questionId: q.id,
                    earnedPoints: Number(mcqItem.earnedPoints),
                    maxPoints: Number(q.points || 0),
                    passed: Boolean(mcqItem.isCorrect),
                    comment: mcqItem.isCorrect ? 'Trắc nghiệm chính xác.' : 'Trắc nghiệm chưa đúng.'
                };
            }
            return {
                questionId: q.id,
                earnedPoints: 0,
                maxPoints: Number(q.points || 0),
                passed: false,
                comment: ''
            };
        });

        const earnedPoints = Number(perQuestion.reduce((sum, item) => sum + item.earnedPoints, 0).toFixed(2));
        const maxScore = Number(assessmentQuestions.reduce((sum, q) => sum + Number(q.points || 0), 0).toFixed(2));
        const totalScore = toTenScale(earnedPoints, maxScore);
        const rec = ['PASS', 'CONSIDER', 'FAIL'].includes(recommendation)
            ? recommendation
            : (totalScore >= 7 ? 'PASS' : totalScore >= 5 ? 'CONSIDER' : 'FAIL');

        const feedbackPayload = {
            perQuestion,
            overallFeedback: overallFeedback ? String(overallFeedback).trim().slice(0, 4000) : null,
            strengths,
            improvements,
            recommendation: rec
        };

        const { rows: updated } = await client.query(
            `UPDATE application_assessments
             SET status = 'GRADED',
                 earned_points = $2,
                 max_score = $3,
                 total_score = $4,
                 grading_mode = $5,
                 grading_feedback = $6::jsonb,
                 ai_grade_task_id = COALESCE($7, ai_grade_task_id),
                 graded_by = $8,
                 graded_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1
             RETURNING *`,
            [assessment.id, earnedPoints, maxScore, totalScore, mode, JSON.stringify(feedbackPayload), aiTaskId, assessorId]
        );

        await recordAssessmentEvent(client, {
            applicationId: app.id,
            stage: app.stage,
            actorId: assessorId,
            reason: `${mode === 'AI' ? 'AI chấm bài test' : 'Nhà tuyển dụng chấm bài test'}: ${totalScore}/10 (${earnedPoints}/${maxScore}đ)`
        });
        return updated[0];
    });
};

export const gradeApplicationAssessmentManually = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res);
        if (!app) return;
        const { questionScores, overallFeedback = null, recommendation = null } = req.body || {};
        const updated = await finalizeGrading({
            app,
            assessorId: identity.userId,
            mode: 'RECRUITER',
            questionScores,
            overallFeedback,
            recommendation
        });
        return res.json({
            errCode: 0,
            data: serializeAssessment(updated, { forCandidate: false }),
            errMessage: 'Đã lưu kết quả chấm điểm bài test'
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.statusCode)) {
            return res.status(error.statusCode).json({ errCode: error.statusCode, errMessage: error.message });
        }
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể lưu điểm bài test' });
    }
};

export const aiGradeApplicationAssessment = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res);
        if (!app) return;
        const { rows } = await pool.query(
            'SELECT * FROM application_assessments WHERE application_id = $1 LIMIT 1',
            [app.id]
        );
        if (!rows.length) return res.status(404).json({ errCode: 404, errMessage: 'Chưa có bài test để chấm' });
        const assessment = rows[0];
        if (!['SUBMITTED', 'GRADED'].includes(assessment.status)) {
            return res.status(409).json({ errCode: 409, errMessage: 'Chỉ có thể nhờ AI chấm sau khi ứng viên đã nộp bài' });
        }

        const language = req.body?.language === 'en' ? 'en' : 'vi';
        const mcqEval = computeMcqAutoEvaluation(assessment.questions || [], assessment.answers || {});
        const intent = {
            kind: 'grade_assessment',
            applicationId: Number(app.id),
            assessmentId: Number(assessment.id),
            submittedAt: toIsoOrNull(assessment.submitted_at),
            language
        };

        const forwarded = await callJobCoreInternal('/internal/ai/assessment-tasks', {
            method: 'POST',
            req,
            body: {
                type: 'grade_assessment',
                input: {
                    applicationId: Number(app.id),
                    assessmentId: Number(assessment.id),
                    companyId: Number(app.company_id)
                },
                requestData: intent,
                payload: {
                    applicationId: Number(app.id),
                    assessmentId: Number(assessment.id),
                    jobId: Number(app.job_id),
                    companyId: Number(app.company_id),
                    domainCode: assessment.domain_code,
                    domainLabel: assessment.domain_label,
                    jobTitle: app.job_title || 'Vị trí tuyển dụng',
                    title: assessment.title,
                    questions: assessment.questions || [],
                    answers: assessment.answers || {},
                    mcqAutoEvaluation: mcqEval,
                    language
                }
            }
        });
        return res.status(forwarded.status).json(forwarded.data);
    } catch {
        return res.status(502).json({ errCode: 502, errMessage: 'Không kết nối được dịch vụ AI chấm bài' });
    }
};

export const applyAiGradeToAssessment = async (req, res) => {
    const identity = requireRecruiterIdentity(req, res);
    if (!identity) return;
    const taskId = String(req.body?.taskId || '').trim();
    if (!taskId) return res.status(400).json({ errCode: 1, errMessage: 'Thiếu mã tác vụ AI (taskId)' });

    try {
        const app = await loadScopedApplicationForRecruiter(req.params.id, identity, res);
        if (!app) return;

        const fetched = await callJobCoreInternal(`/internal/ai/assessment-tasks/${encodeURIComponent(taskId)}`, {
            method: 'GET',
            req
        });
        if (fetched.status >= 400 || fetched.data?.errCode !== 0 || !fetched.data?.data) {
            return res.status(fetched.status === 404 ? 404 : 502).json({
                errCode: fetched.status,
                errMessage: fetched.data?.errMessage || 'Không tìm thấy tác vụ AI chấm bài'
            });
        }
        const task = fetched.data.data;
        if (task.type !== 'grade_assessment') {
            return res.status(400).json({ errCode: 1, errMessage: 'Tác vụ AI không phải là tác vụ chấm bài test' });
        }
        if (Number(task.input?.applicationId) !== Number(app.id) || Number(task.input?.companyId) !== Number(app.company_id)) {
            return res.status(403).json({ errCode: 403, errMessage: 'Kết quả AI không thuộc hồ sơ hoặc công ty đang xem' });
        }
        if (task.status !== 'done' || !task.result) {
            return res.status(409).json({ errCode: 409, errMessage: 'AI chưa hoàn tất chấm bài test' });
        }

        const updated = await finalizeGrading({
            app,
            assessorId: identity.userId,
            mode: 'AI',
            questionScores: task.result.perQuestion || [],
            overallFeedback: task.result.overallFeedback || null,
            recommendation: task.result.recommendation || null,
            strengths: task.result.strengths || [],
            improvements: task.result.improvements || [],
            aiTaskId: taskId
        });
        return res.json({
            errCode: 0,
            data: serializeAssessment(updated, { forCandidate: false }),
            errMessage: 'Đã áp dụng kết quả AI chấm bài test'
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.statusCode)) {
            return res.status(error.statusCode).json({ errCode: error.statusCode, errMessage: error.message });
        }
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể áp dụng kết quả AI chấm bài' });
    }
};

// =================== UNG VIEN: XEM, LAM VA NOP BAI TEST ===================

const loadOwnedCandidateApplication = async (applicationId, candidateId, res) => {
    const appId = parsePositiveId(applicationId);
    if (!appId) {
        res.status(400).json({ errCode: 1, errMessage: 'Mã hồ sơ không hợp lệ' });
        return null;
    }
    const { rows } = await pool.query(
        'SELECT * FROM applications WHERE id = $1 AND candidate_id = $2 LIMIT 1',
        [appId, candidateId]
    );
    if (!rows.length) {
        res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy hồ sơ ứng tuyển của bạn' });
        return null;
    }
    return rows[0];
};

export const getMyAssessment = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const candidateId = parsePositiveId(req.headers['x-user-id']);
    if (!candidateId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được ứng viên' });

    try {
        const app = await loadOwnedCandidateApplication(req.params.id, candidateId, res);
        if (!app) return;
        const jobDomain = await resolveJobDomain(app);
        const { rows } = await pool.query(
            'SELECT * FROM application_assessments WHERE application_id = $1 LIMIT 1',
            [app.id]
        );
        return res.json({
            errCode: 0,
            data: {
                applicationId: Number(app.id),
                stage: app.stage,
                jobTitle: jobDomain.jobTitle,
                domainCode: rows[0]?.domain_code || jobDomain.domainCode,
                domainLabel: rows[0]?.domain_label || jobDomain.domainLabel,
                assessment: rows.length ? serializeAssessment(rows[0], { forCandidate: true }) : null
            }
        });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không tải được bài test' });
    }
};

export const startMyAssessment = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const candidateId = parsePositiveId(req.headers['x-user-id']);
    if (!candidateId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được ứng viên' });

    try {
        const app = await loadOwnedCandidateApplication(req.params.id, candidateId, res);
        if (!app) return;
        const { rows } = await pool.query(
            `UPDATE application_assessments
             SET started_at = COALESCE(started_at, NOW()),
                 status = CASE WHEN status = 'ASSIGNED' THEN 'IN_PROGRESS' ELSE status END,
                 updated_at = NOW()
             WHERE application_id = $1 AND candidate_id = $2
             RETURNING *`,
            [app.id, candidateId]
        );
        if (!rows.length) {
            return res.status(404).json({ errCode: 404, errMessage: 'Nhà tuyển dụng chưa tạo bài test cho hồ sơ này' });
        }
        return res.json({
            errCode: 0,
            data: {
                applicationId: Number(app.id),
                stage: app.stage,
                jobTitle: app.job_title || null,
                domainCode: rows[0].domain_code,
                domainLabel: rows[0].domain_label,
                assessment: serializeAssessment(rows[0], { forCandidate: true })
            }
        });
    } catch {
        return res.status(500).json({ errCode: -1, errMessage: 'Không khởi tạo được phiên làm bài test' });
    }
};

export const submitMyAssessment = async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const candidateId = parsePositiveId(req.headers['x-user-id']);
    if (!candidateId) return res.status(401).json({ errCode: 401, errMessage: 'Chưa xác định được ứng viên' });

    try {
        const app = await loadOwnedCandidateApplication(req.params.id, candidateId, res);
        if (!app) return;

        const submitted = await withTransaction(async (client) => {
            const { rows } = await client.query(
                'SELECT * FROM application_assessments WHERE application_id = $1 AND candidate_id = $2 FOR UPDATE',
                [app.id, candidateId]
            );
            if (!rows.length) {
                throw Object.assign(new Error('Nhà tuyển dụng chưa tạo bài test cho hồ sơ này'), { statusCode: 404 });
            }
            const assessment = rows[0];
            if (['SUBMITTED', 'GRADED'].includes(assessment.status)) {
                throw Object.assign(new Error('Bài test đã được nộp trước đó, không thể nộp lại'), { statusCode: 409 });
            }

            const rawAnswers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
            const questions = Array.isArray(assessment.questions) ? assessment.questions : [];
            const normalizedAnswers = {};

            for (const q of questions) {
                const ans = rawAnswers[q.id];
                if (!ans || typeof ans !== 'object') {
                    normalizedAnswers[q.id] = q.type.startsWith('mcq')
                        ? { selectedOptionIds: [] }
                        : q.type === 'code'
                            ? { codeAnswer: '' }
                            : { textAnswer: '' };
                    continue;
                }
                if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
                    const validIds = new Set((q.options || []).map((o) => o.id));
                    const selected = Array.isArray(ans.selectedOptionIds)
                        ? [...new Set(ans.selectedOptionIds.map((v) => String(v).trim()).filter((v) => validIds.has(v)))]
                        : [];
                    if (q.type === 'mcq_single' && selected.length > 1) {
                        throw Object.assign(new Error(`Câu trắc nghiệm 1 đáp án "${q.id}" chỉ được chọn tối đa 1 phương án`), { statusCode: 400 });
                    }
                    normalizedAnswers[q.id] = { selectedOptionIds: selected };
                } else if (q.type === 'code') {
                    const codeAnswer = typeof ans.codeAnswer === 'string' ? ans.codeAnswer.slice(0, 30000) : '';
                    normalizedAnswers[q.id] = { codeAnswer };
                } else {
                    const limit = Number(q.maxLength || 8000);
                    const textAnswer = typeof ans.textAnswer === 'string' ? ans.textAnswer.trim().slice(0, limit) : '';
                    normalizedAnswers[q.id] = { textAnswer };
                }
            }

            const mcqEval = computeMcqAutoEvaluation(questions, normalizedAnswers);
            const startedAt = assessment.started_at ? new Date(assessment.started_at) : new Date();
            const spentSeconds = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));
            const isOvertime = Boolean(assessment.time_limit_seconds && spentSeconds > Number(assessment.time_limit_seconds) + 15);

            const { rows: updated } = await client.query(
                `UPDATE application_assessments
                 SET answers = $2::jsonb,
                     started_at = COALESCE(started_at, NOW()),
                     submitted_at = NOW(),
                     time_spent_seconds = $3,
                     is_overtime = $4,
                     mcq_score = $5,
                     mcq_auto_results = $6::jsonb,
                     max_score = $7,
                     status = 'SUBMITTED',
                     updated_at = NOW()
                 WHERE id = $1
                 RETURNING *`,
                [
                    assessment.id,
                    JSON.stringify(normalizedAnswers),
                    spentSeconds,
                    isOvertime,
                    mcqEval.mcqScore,
                    JSON.stringify(mcqEval),
                    mcqEval.totalMaxScore
                ]
            );

            await recordAssessmentEvent(client, {
                applicationId: app.id,
                stage: app.stage,
                actorId: candidateId,
                reason: `Ứng viên đã nộp bài test: ${assessment.title}`
            });
            return updated[0];
        });

        return res.json({
            errCode: 0,
            data: {
                applicationId: Number(app.id),
                stage: app.stage,
                jobTitle: app.job_title || null,
                domainCode: submitted.domain_code,
                domainLabel: submitted.domain_label,
                assessment: serializeAssessment(submitted, { forCandidate: true })
            },
            errMessage: 'Đã nộp bài test thành công. Nhà tuyển dụng hoặc AI sẽ chấm điểm và phản hồi cho bạn.'
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.statusCode)) {
            return res.status(error.statusCode).json({ errCode: error.statusCode, errMessage: error.message });
        }
        return res.status(500).json({ errCode: -1, errMessage: 'Không thể nộp bài test' });
    }
};
