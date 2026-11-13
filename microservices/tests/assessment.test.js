import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './helpers.js';
import {
    DOMAIN_LABELS,
    computeMcqAutoEvaluation,
    findTemplateById,
    getTemplatesForDomain,
    normalizeQuestions,
    sanitizeQuestionsForCandidate
} from '../shared/assessmentTemplates.js';

const mocks = vi.hoisted(() => ({
    pool: { query: vi.fn() },
    withTransaction: vi.fn(),
    getJobDomainContext: vi.fn(),
    fetch: vi.fn()
}));

vi.mock('../application-service/src/libs/db.js', () => ({
    pool: mocks.pool,
    withTransaction: mocks.withTransaction
}));

vi.mock('../application-service/src/libs/jobCatalog.js', () => ({
    getJobDomainContext: mocks.getJobDomainContext,
    closeJobCatalogPool: vi.fn()
}));

const recruiterReq = (overrides = {}) => makeReq({
    headers: { 'x-user-id': '5', 'x-user-role': 'COMPANY', 'x-company-id': '9', 'idempotency-key': 'idem-key-1' },
    ...overrides
});

const candidateReq = (overrides = {}) => makeReq({
    headers: { 'x-user-id': '21', 'x-user-role': 'CANDIDATE' },
    ...overrides
});

const mixedQuestions = () => [
    {
        id: 'q-mcq-1',
        order: 1,
        type: 'mcq_single',
        prompt: 'Event loop là gì?',
        points: 2,
        options: [{ id: 'A', text: 'Đơn luồng bất đồng bộ' }, { id: 'B', text: 'Đa luồng OS' }],
        correctOptionIds: ['A'],
        explanation: 'Node.js chạy event loop đơn luồng.'
    },
    {
        id: 'q-mcq-2',
        order: 2,
        type: 'mcq_multi',
        prompt: 'Chọn biện pháp bảo mật SQL:',
        points: 2,
        options: [{ id: 'A', text: 'Parameterized query' }, { id: 'B', text: 'Nối chuỗi trực tiếp' }, { id: 'C', text: 'Least privilege' }],
        correctOptionIds: ['A', 'C'],
        explanation: 'Không nối chuỗi trực tiếp.'
    },
    {
        id: 'q-code-1',
        order: 3,
        type: 'code',
        prompt: 'Viết hàm tính tổng mảng số nguyên dương.',
        points: 4,
        language: 'javascript',
        starterCode: 'function sumPositive(nums = []) {\n  return 0;\n}',
        rubric: 'Lọc số > 0 và cộng dồn O(n).',
        sampleAnswer: 'return nums.filter((n) => n > 0).reduce((a, b) => a + b, 0);'
    },
    {
        id: 'q-text-1',
        order: 4,
        type: 'text',
        prompt: 'Nêu 2 cách giảm độ trễ p95 cho API danh sách lớn.',
        points: 2,
        placeholder: 'Nhập câu trả lời...',
        rubric: 'Composite index và pagination.',
        sampleAnswer: 'Tạo index theo filter/sort và keyset pagination.'
    }
];

beforeEach(() => {
    mocks.pool.query.mockReset();
    mocks.withTransaction.mockReset();
    mocks.getJobDomainContext.mockReset();
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('domain-strict assessment templates & helpers', () => {
    it('provides dedicated templates for every JobFind domain without cross-domain copying', () => {
        for (const domainCode of Object.keys(DOMAIN_LABELS)) {
            const templates = getTemplatesForDomain(domainCode);
            expect(templates.length).toBeGreaterThanOrEqual(2);
            for (const tpl of templates) {
                expect(tpl.domainCode).toBe(domainCode);
                expect(tpl.domainLabel).toBe(DOMAIN_LABELS[domainCode]);
                if (domainCode !== 'cong-nghe-thong-tin') {
                    // Ngành ngoài IT không được chứa câu hỏi viết code lập trình từ ngành IT copy sang.
                    expect(tpl.questions.some((q) => q.type === 'code')).toBe(false);
                }
            }
        }
        // Không fallback sang IT khi gặp ngành lạ.
        expect(getTemplatesForDomain('linh-vuc-khong-ton-tai')).toEqual([]);
        expect(findTemplateById('tpl-nonexistent')).toBeNull();
    });

    it('supports mixed question formats and strips sensitive grading fields from candidates before GRADED', () => {
        const normalized = normalizeQuestions(mixedQuestions());
        expect(normalized).toHaveLength(4);
        expect(normalized.map((q) => q.type)).toEqual(['mcq_single', 'mcq_multi', 'code', 'text']);

        const sanitized = sanitizeQuestionsForCandidate(normalized, { includeSolutions: false });
        expect(sanitized[0]).not.toHaveProperty('correctOptionIds');
        expect(sanitized[0]).not.toHaveProperty('explanation');
        expect(sanitized[2]).not.toHaveProperty('rubric');
        expect(sanitized[2]).not.toHaveProperty('sampleAnswer');
        expect(sanitized[2].language).toBe('javascript');
        expect(sanitized[2].starterCode).toContain('sumPositive');

        const revealed = sanitizeQuestionsForCandidate(normalized, { includeSolutions: true });
        expect(revealed[0].correctOptionIds).toEqual(['A']);
        expect(revealed[2].rubric).toContain('O(n)');
    });

    it('rejects duplicate question ids and computes deterministic MCQ scores', () => {
        const dup = mixedQuestions();
        dup[1].id = dup[0].id;
        expect(() => normalizeQuestions(dup)).toThrow(/trùng lặp/);

        const evalResult = computeMcqAutoEvaluation(mixedQuestions(), {
            'q-mcq-1': { selectedOptionIds: ['A'] },
            'q-mcq-2': { selectedOptionIds: ['C', 'A'] },
            'q-code-1': { codeAnswer: 'return 1;' }
        });
        expect(evalResult.mcqScore).toBe(4);
        expect(evalResult.mcqMaxScore).toBe(4);
        expect(evalResult.openMaxScore).toBe(6);
        expect(evalResult.totalMaxScore).toBe(10);
        expect(evalResult.perQuestion.filter((p) => p.autoGraded)).toHaveLength(2);
    });
});

describe('assessmentController permissions, domain guard, candidate submission, and dual grading', () => {
    it('blocks recruiters from creating or AI-generating tests when candidate is not in phong_van stage (409)', async () => {
        const { upsertApplicationAssessment, aiGenerateApplicationAssessment } = await import('../application-service/src/controllers/assessmentController.js');

        mocks.pool.query.mockResolvedValue({
            rows: [{ id: 100, job_id: 55, company_id: 9, candidate_id: 21, stage: 'dang_xem_xet' }]
        });

        const res1 = makeRes();
        await upsertApplicationAssessment(
            recruiterReq({ params: { id: '100' }, body: { title: 'Test', questions: mixedQuestions() } }),
            res1
        );
        expect(res1.statusCode).toBe(409);
        expect(res1.body.errMessage).toContain('phong_van');

        const res2 = makeRes();
        await aiGenerateApplicationAssessment(
            recruiterReq({ params: { id: '100' }, body: { questionCount: 4 } }),
            res2
        );
        expect(res2.statusCode).toBe(409);
    });

    it('blocks cross-company access (403) and cross-domain test copying (400)', async () => {
        const { upsertApplicationAssessment, getApplicationAssessmentTemplates } = await import('../application-service/src/controllers/assessmentController.js');

        // Cross-company -> 403
        mocks.pool.query.mockResolvedValueOnce({
            rows: [{ id: 100, job_id: 55, company_id: 99, candidate_id: 21, stage: 'phong_van' }]
        });
        const resCrossCompany = makeRes();
        await upsertApplicationAssessment(
            recruiterReq({ params: { id: '100' }, body: { title: 'Test', questions: mixedQuestions() } }),
            resCrossCompany
        );
        expect(resCrossCompany.statusCode).toBe(403);

        // Same company, phong_van stage, Luật domain job rejecting IT templateId or IT domainCode
        const lawApp = { id: 101, job_id: 77, company_id: 9, candidate_id: 21, stage: 'phong_van' };
        mocks.pool.query.mockResolvedValue({ rows: [lawApp] });
        mocks.getJobDomainContext.mockResolvedValue({
            jobId: 77,
            jobTitle: 'Chuyên viên Pháp chế',
            categoryJobCode: 'luat',
            domainCode: 'luat',
            domainLabel: 'Luật'
        });

        const resWrongDomain = makeRes();
        await upsertApplicationAssessment(
            recruiterReq({
                params: { id: '101' },
                body: { domainCode: 'cong-nghe-thong-tin', title: 'Test IT nhầm ngành', questions: mixedQuestions() }
            }),
            resWrongDomain
        );
        expect(resWrongDomain.statusCode).toBe(400);

        const resCrossTemplate = makeRes();
        await upsertApplicationAssessment(
            recruiterReq({
                params: { id: '101' },
                body: { templateId: 'tpl-it-fullstack', title: 'Copy mẫu IT sang Luật', questions: mixedQuestions() }
            }),
            resCrossTemplate
        );
        expect(resCrossTemplate.statusCode).toBe(400);

        const resWrongQuery = makeRes();
        await getApplicationAssessmentTemplates(
            recruiterReq({ params: { id: '101' }, query: { domainCode: 'cong-nghe-thong-tin' } }),
            resWrongQuery
        );
        expect(resWrongQuery.statusCode).toBe(400);
    });

    it('allows recruiter in phong_van to assign a mixed test and optionally save as domain template', async () => {
        const { upsertApplicationAssessment } = await import('../application-service/src/controllers/assessmentController.js');
        const itApp = { id: 102, job_id: 88, company_id: 9, candidate_id: 21, stage: 'phong_van' };
        mocks.pool.query.mockResolvedValueOnce({ rows: [itApp] });
        mocks.getJobDomainContext.mockResolvedValueOnce({
            jobId: 88,
            jobTitle: 'Senior Node.js Engineer',
            categoryJobCode: 'cong-nghe-thong-tin',
            domainCode: 'cong-nghe-thong-tin',
            domainLabel: 'Công nghệ thông tin'
        });

        const clientQueries = [];
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async (sql, params) => {
                clientQueries.push(sql);
                if (sql.includes('SELECT id, status FROM application_assessments')) return { rows: [] };
                if (sql.includes('INSERT INTO application_assessments')) {
                    return {
                        rows: [{
                            id: 500,
                            application_id: 102,
                            job_id: 88,
                            company_id: 9,
                            candidate_id: 21,
                            domain_code: params[4],
                            domain_label: params[5],
                            template_id: params[6],
                            title: params[7],
                            time_limit_seconds: params[10],
                            questions: mixedQuestions(),
                            status: 'ASSIGNED',
                            max_score: 10
                        }]
                    };
                }
                return { rows: [] };
            })
        }));

        const res = makeRes();
        await upsertApplicationAssessment(
            recruiterReq({
                params: { id: '102' },
                body: {
                    title: 'Đánh giá Node.js Mixed',
                    timeLimitMinutes: 45,
                    questions: mixedQuestions(),
                    saveAsTemplate: true
                }
            }),
            res
        );

        expect(res.statusCode).toBe(200);
        expect(res.body.data.status).toBe('ASSIGNED');
        expect(res.body.data.domainCode).toBe('cong-nghe-thong-tin');
        expect(clientQueries.some((sql) => sql.includes('INSERT INTO domain_test_templates'))).toBe(true);
        const eventSql = clientQueries.find((sql) => sql.includes('INSERT INTO application_events'));
        expect(eventSql).toContain('(application_id, from_stage, to_stage, actor_id, reason)');
        expect(eventSql).not.toMatch(/\b(event_type|note)\b/);
    });

    it('hides solutions during candidate attempt, scores MCQ on submit, and prevents double submission', async () => {
        const { getMyAssessment, submitMyAssessment } = await import('../application-service/src/controllers/assessmentController.js');
        const appRow = { id: 102, job_id: 88, company_id: 9, candidate_id: 21, stage: 'phong_van', job_title: 'Node.js Dev' };
        const assignedRow = {
            id: 500,
            application_id: 102,
            job_id: 88,
            company_id: 9,
            candidate_id: 21,
            domain_code: 'cong-nghe-thong-tin',
            domain_label: 'Công nghệ thông tin',
            title: 'Test Mixed',
            time_limit_seconds: 600,
            started_at: new Date(Date.now() - 120 * 1000).toISOString(),
            questions: mixedQuestions(),
            status: 'IN_PROGRESS',
            max_score: 10
        };

        // Candidate view before grading strips answers/solutions
        mocks.pool.query
            .mockResolvedValueOnce({ rows: [appRow] })
            .mockResolvedValueOnce({ rows: [assignedRow] });
        mocks.getJobDomainContext.mockResolvedValueOnce({
            jobTitle: 'Node.js Dev',
            categoryJobCode: 'cong-nghe-thong-tin',
            domainCode: 'cong-nghe-thong-tin',
            domainLabel: 'Công nghệ thông tin'
        });

        const viewRes = makeRes();
        await getMyAssessment(candidateReq({ params: { id: '102' } }), viewRes);
        expect(viewRes.statusCode).toBe(200);
        expect(viewRes.body.data.assessment.questions[0].correctOptionIds).toBeUndefined();
        expect(viewRes.body.data.assessment.questions[2].sampleAnswer).toBeUndefined();

        // Candidate submit evaluates MCQ & records answers
        const submitQueries = [];
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async (sql, params) => {
                submitQueries.push(sql);
                if (sql.includes('FOR UPDATE')) return { rows: [assignedRow] };
                if (sql.includes('UPDATE application_assessments')) {
                    return {
                        rows: [{
                            ...assignedRow,
                            status: 'SUBMITTED',
                            answers: JSON.parse(params[1]),
                            submitted_at: new Date().toISOString(),
                            mcq_score: params[4],
                            mcq_auto_results: JSON.parse(params[5]),
                            max_score: params[6],
                            time_spent_seconds: params[2],
                            is_overtime: params[3]
                        }]
                    };
                }
                return { rows: [] };
            })
        }));

        const submitRes = makeRes();
        await submitMyAssessment(
            candidateReq({
                params: { id: '102' },
                body: {
                    answers: {
                        'q-mcq-1': { selectedOptionIds: ['A'] },
                        'q-mcq-2': { selectedOptionIds: ['A'] }, // Missing C -> 0 points
                        'q-code-1': { codeAnswer: 'function sumPositive(n){return 0;}' },
                        'q-text-1': { textAnswer: 'Tạo index và dùng keyset pagination.' }
                    }
                }
            }),
            submitRes
        );
        expect(submitRes.statusCode).toBe(200);
        expect(submitRes.body.data.assessment.status).toBe('SUBMITTED');
        const submitEventSql = submitQueries.find((sql) => sql.includes('INSERT INTO application_events'));
        expect(submitEventSql).toContain('(application_id, from_stage, to_stage, actor_id, reason)');
        expect(submitEventSql).not.toMatch(/\b(event_type|note)\b/);
        // Secrets & score still hidden from candidate until graded
        expect(submitRes.body.data.assessment.mcqScore).toBeNull();
        expect(submitRes.body.data.assessment.answers['q-code-1'].codeAnswer).toContain('sumPositive');

        // Re-submit returns 409
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async () => ({ rows: [{ ...assignedRow, status: 'SUBMITTED' }] }))
        }));
        const reSubmitRes = makeRes();
        await submitMyAssessment(candidateReq({ params: { id: '102' }, body: { answers: {} } }), reSubmitRes);
        expect(reSubmitRes.statusCode).toBe(409);
    });

    it('supports manual recruiter grading and AI grading (preserving deterministic MCQ score)', async () => {
        const {
            gradeApplicationAssessmentManually,
            aiGradeApplicationAssessment,
            applyAiGradeToAssessment
        } = await import('../application-service/src/controllers/assessmentController.js');

        const submittedRow = {
            id: 500,
            application_id: 102,
            job_id: 88,
            company_id: 9,
            candidate_id: 21,
            domain_code: 'cong-nghe-thong-tin',
            domain_label: 'Công nghệ thông tin',
            title: 'Test Mixed',
            questions: mixedQuestions(),
            answers: {
                'q-mcq-1': { selectedOptionIds: ['A'] }, // 2/2
                'q-mcq-2': { selectedOptionIds: ['B'] }, // 0/2
                'q-code-1': { codeAnswer: 'return nums.filter(x => x > 0).reduce((a,b)=>a+b,0);' },
                'q-text-1': { textAnswer: 'Composite index' }
            },
            status: 'SUBMITTED',
            submitted_at: new Date().toISOString(),
            max_score: 10
        };
        const appRow = { id: 102, job_id: 88, company_id: 9, candidate_id: 21, stage: 'phong_van', job_title: 'Node.js Dev' };

        // Manual grading out-of-range -> 400
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async () => ({ rows: [submittedRow] }))
        }));
        const invalidGradeRes = makeRes();
        await gradeApplicationAssessmentManually(
            recruiterReq({
                params: { id: '102' },
                body: { questionScores: [{ questionId: 'q-code-1', earnedPoints: 99, comment: 'Quá thang điểm' }] }
            }),
            invalidGradeRes
        );
        expect(invalidGradeRes.statusCode).toBe(400);

        // Enqueue AI grading -> forwards to job-core-service
        mocks.pool.query
            .mockResolvedValueOnce({ rows: [appRow] })
            .mockResolvedValueOnce({ rows: [submittedRow] });
        mocks.fetch.mockResolvedValueOnce({
            status: 202,
            json: async () => ({ errCode: 0, taskId: 'task-grade-1' })
        });
        const enqueueRes = makeRes();
        await aiGradeApplicationAssessment(recruiterReq({ params: { id: '102' }, body: { language: 'vi' } }), enqueueRes);
        expect(enqueueRes.statusCode).toBe(202);
        expect(enqueueRes.body.taskId).toBe('task-grade-1');

        // Apply AI grade rejects mismatched task applicationId (403)
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.fetch.mockResolvedValueOnce({
            status: 200,
            json: async () => ({
                errCode: 0,
                data: { id: 'task-grade-other', type: 'grade_assessment', status: 'done', input: { applicationId: 999, companyId: 9 }, result: {} }
            })
        });
        const wrongTaskRes = makeRes();
        await applyAiGradeToAssessment(recruiterReq({ params: { id: '102' }, body: { taskId: 'task-grade-other' } }), wrongTaskRes);
        expect(wrongTaskRes.statusCode).toBe(403);

        // Apply AI grade succeeds and enforces server MCQ auto-score even if AI result gave full points to wrong MCQ
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.fetch.mockResolvedValueOnce({
            status: 200,
            json: async () => ({
                errCode: 0,
                data: {
                    id: 'task-grade-1',
                    type: 'grade_assessment',
                    status: 'done',
                    input: { applicationId: 102, companyId: 9 },
                    result: {
                        perQuestion: [
                            { questionId: 'q-mcq-1', earnedPoints: 0, comment: 'AI nhầm' },
                            { questionId: 'q-mcq-2', earnedPoints: 2, comment: 'AI chấm nhầm MCQ sai' },
                            { questionId: 'q-code-1', earnedPoints: 3.5, comment: 'Code sạch, đúng O(n)' },
                            { questionId: 'q-text-1', earnedPoints: 1.5, comment: 'Đủ ý chính' }
                        ],
                        overallFeedback: 'Nền tảng tốt',
                        strengths: ['Code tốt'],
                        improvements: ['Ôn lại SQL privilege'],
                        recommendation: 'PASS'
                    }
                }
            })
        });
        const applyQueries = [];
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async (sql, params) => {
                applyQueries.push(sql);
                if (sql.includes('FOR UPDATE')) return { rows: [submittedRow] };
                if (sql.includes('UPDATE application_assessments')) {
                    return {
                        rows: [{
                            ...submittedRow,
                            status: 'GRADED',
                            earned_points: params[1],
                            max_score: params[2],
                            total_score: params[3],
                            grading_mode: params[4],
                            grading_feedback: JSON.parse(params[5]),
                            graded_by: params[7],
                            graded_at: new Date().toISOString()
                        }]
                    };
                }
                return { rows: [] };
            })
        }));

        const applyRes = makeRes();
        await applyAiGradeToAssessment(recruiterReq({ params: { id: '102' }, body: { taskId: 'task-grade-1' } }), applyRes);
        expect(applyRes.statusCode).toBe(200);
        expect(applyRes.body.data.status).toBe('GRADED');
        expect(applyRes.body.data.gradingMode).toBe('AI');
        // MCQ-1 = 2 (server auto), MCQ-2 = 0 (server auto), code = 3.5, text = 1.5 => earned = 7 / 10
        expect(applyRes.body.data.earnedPoints).toBe(7);
        expect(applyRes.body.data.totalScore).toBe(7);
        expect(applyRes.body.data.gradingFeedback.perQuestion.find((p) => p.questionId === 'q-mcq-2').earnedPoints).toBe(0);
        const applyEventSql = applyQueries.find((sql) => sql.includes('INSERT INTO application_events'));
        expect(applyEventSql).toContain('(application_id, from_stage, to_stage, actor_id, reason)');
        expect(applyEventSql).not.toMatch(/\b(event_type|note)\b/);
    });

    it('saves manual recruiter grade and withdraws unassigned assessment using application_events.reason', async () => {
        const {
            gradeApplicationAssessmentManually,
            deleteApplicationAssessment
        } = await import('../application-service/src/controllers/assessmentController.js');

        const appRow = { id: 102, job_id: 88, company_id: 9, candidate_id: 21, stage: 'phong_van', job_title: 'Node.js Dev' };
        const submittedRow = {
            id: 500,
            application_id: 102,
            job_id: 88,
            company_id: 9,
            candidate_id: 21,
            domain_code: 'cong-nghe-thong-tin',
            domain_label: 'Công nghệ thông tin',
            title: 'Test Mixed',
            questions: mixedQuestions(),
            answers: {
                'q-mcq-1': { selectedOptionIds: ['A'] },
                'q-mcq-2': { selectedOptionIds: ['A', 'C'] },
                'q-code-1': { codeAnswer: 'return nums.filter(x => x > 0).reduce((a,b)=>a+b,0);' },
                'q-text-1': { textAnswer: 'Composite index' }
            },
            status: 'SUBMITTED',
            submitted_at: new Date().toISOString(),
            max_score: 10
        };

        const manualQueries = [];
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async (sql, params) => {
                manualQueries.push(sql);
                if (sql.includes('FOR UPDATE')) return { rows: [submittedRow] };
                if (sql.includes('UPDATE application_assessments')) {
                    return {
                        rows: [{
                            ...submittedRow,
                            status: 'GRADED',
                            earned_points: params[1],
                            max_score: params[2],
                            total_score: params[3],
                            grading_mode: params[4],
                            grading_feedback: JSON.parse(params[5]),
                            graded_by: params[7],
                            graded_at: new Date().toISOString()
                        }]
                    };
                }
                return { rows: [] };
            })
        }));

        const manualRes = makeRes();
        await gradeApplicationAssessmentManually(
            recruiterReq({
                params: { id: '102' },
                body: {
                    questionScores: [
                        { questionId: 'q-code-1', earnedPoints: 3.5, comment: 'Rất tốt' },
                        { questionId: 'q-text-1', earnedPoints: 1.5, comment: 'Đầy đủ' }
                    ],
                    overallFeedback: 'Ứng viên phù hợp',
                    recommendation: 'PASS'
                }
            }),
            manualRes
        );
        expect(manualRes.statusCode).toBe(200);
        expect(manualRes.body.data.status).toBe('GRADED');
        expect(manualRes.body.data.gradingMode).toBe('RECRUITER');
        expect(manualRes.body.data.earnedPoints).toBe(9);
        const manualEventSql = manualQueries.find((sql) => sql.includes('INSERT INTO application_events'));
        expect(manualEventSql).toContain('(application_id, from_stage, to_stage, actor_id, reason)');
        expect(manualEventSql).not.toMatch(/\b(event_type|note)\b/);

        const deleteQueries = [];
        mocks.pool.query.mockResolvedValueOnce({ rows: [appRow] });
        mocks.withTransaction.mockImplementationOnce(async (work) => work({
            query: vi.fn(async (sql) => {
                deleteQueries.push(sql);
                if (sql.includes('FOR UPDATE')) return { rows: [{ id: 500, status: 'ASSIGNED', title: 'Test Mixed' }] };
                return { rows: [] };
            })
        }));

        const delRes = makeRes();
        await deleteApplicationAssessment(recruiterReq({ params: { id: '102' } }), delRes);
        expect(delRes.statusCode).toBe(200);
        const delEventSql = deleteQueries.find((sql) => sql.includes('INSERT INTO application_events'));
        expect(delEventSql).toContain('(application_id, from_stage, to_stage, actor_id, reason)');
        expect(delEventSql).not.toMatch(/\b(event_type|note)\b/);
    });
});
