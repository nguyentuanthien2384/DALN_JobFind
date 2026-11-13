import axios from '../axios';
import { postAi } from './aiSearchService';
import { submitAiTask, waitAiTask } from './aiAssist';
import {
    applyAiGradeAssessment,
    deleteApplicationAssessment,
    deleteDomainTemplate,
    domainLabelOf,
    generateAssessmentWithAi,
    getApplicationAssessment,
    getApplicationAssessmentTemplates,
    getMyAssessment,
    gradeApplicationAssessment,
    gradeAssessmentWithAi,
    listDomainTemplates,
    saveDomainTemplate,
    serializeAnswersForApi,
    serializeManualGradeForApi,
    serializeQuestionForApi,
    startMyAssessment,
    submitMyAssessment,
    upsertApplicationAssessment
} from './assessmentService';

jest.mock('../axios', () => ({
    __esModule: true,
    default: {
        get: jest.fn(),
        post: jest.fn(),
        delete: jest.fn()
    }
}));

jest.mock('./aiSearchService', () => ({
    postAi: jest.fn()
}));

jest.mock('./aiAssist', () => ({
    submitAiTask: jest.fn(),
    waitAiTask: jest.fn()
}));

beforeEach(() => {
    axios.get.mockReset().mockResolvedValue({ errCode: 0, data: {} });
    axios.post.mockReset().mockResolvedValue({ errCode: 0, data: {} });
    axios.delete.mockReset().mockResolvedValue({ errCode: 0 });
    postAi.mockReset().mockResolvedValue({ errCode: 0, taskId: 'task-1' });
    submitAiTask.mockReset().mockResolvedValue('task-1');
    waitAiTask.mockReset().mockResolvedValue({ title: 'AI test', questions: [] });
});

describe('assessmentSerializers', () => {
    it('resolves domain labels without copying IT as a fallback', () => {
        expect(domainLabelOf('luat')).toBe('Luật');
        expect(domainLabelOf('custom-domain', 'Ngành tùy chỉnh')).toBe('Ngành tùy chỉnh');
        expect(domainLabelOf('')).toBe('Chưa xác định lĩnh vực');
    });

    it('serializes mixed questions cleanly with strict schema properties', () => {
        const mcqSingle = serializeQuestionForApi({
            id: 'q1',
            type: 'mcq_single',
            prompt: '  Câu hỏi 1  ',
            points: 2,
            options: [{ id: 'A', text: 'Đáp án A' }, { id: 'B', text: '' }],
            correctOptionIds: ['A', 'Z'],
            explanation: null,
            uiOnlyFlag: true
        });
        expect(mcqSingle).toEqual({
            id: 'q1',
            order: 1,
            type: 'mcq_single',
            prompt: 'Câu hỏi 1',
            points: 2,
            options: [{ id: 'A', text: 'Đáp án A' }],
            correctOptionIds: ['A']
        });
        expect(mcqSingle).not.toHaveProperty('uiOnlyFlag');
        expect(mcqSingle).not.toHaveProperty('explanation');

        const mcqMulti = serializeQuestionForApi({
            type: 'mcq_multi',
            prompt: 'Multi',
            options: [{ id: 'A', text: '1' }, { id: 'B', text: '2' }],
            correctOptionIds: ['A', 'B']
        }, 1);
        expect(mcqMulti.correctOptionIds).toEqual(['A', 'B']);

        const codeQ = serializeQuestionForApi({
            type: 'code',
            prompt: 'Code SQL',
            language: 'unknown_lang',
            starterCode: 'SELECT 1;'
        }, 2);
        expect(codeQ.language).toBe('javascript');
        expect(codeQ.starterCode).toBe('SELECT 1;');

        const textQ = serializeQuestionForApi({
            type: 'unknown_type',
            prompt: 'Tự luận',
            maxLength: 20,
            placeholder: 'Nhập...',
            rubric: 'Chuẩn'
        }, 3);
        expect(textQ.type).toBe('text');
        expect(textQ.maxLength).toBe(50);
    });

    it('serializes answers and manual grades cleanly within valid bounds', () => {
        const questions = [
            { id: 'q1', type: 'mcq_single', points: 2, options: [{ id: 'A' }, { id: 'B' }] },
            { id: 'q2', type: 'code', points: 5 },
            { id: 'q3', type: 'text', points: 3 }
        ];

        expect(serializeAnswersForApi(questions, {
            q1: { selectedOptionIds: ['B', 'INVALID', 'A'] },
            q2: { codeAnswer: 'return 1;' }
        })).toEqual({
            q1: { selectedOptionIds: ['B'] },
            q2: { codeAnswer: 'return 1;' },
            q3: { textAnswer: '' }
        });

        expect(serializeManualGradeForApi({
            questions,
            scores: {
                q1: { earnedPoints: 2, comment: 'Đúng' },
                q2: { earnedPoints: 99, comment: 'Vượt ngưỡng' },
                q3: { earnedPoints: -3 }
            },
            overallFeedback: '  Tốt  ',
            recommendation: 'INVALID_REC'
        })).toEqual({
            questionScores: [
                { questionId: 'q1', earnedPoints: 2, comment: 'Đúng' },
                { questionId: 'q2', earnedPoints: 5, comment: 'Vượt ngưỡng' },
                { questionId: 'q3', earnedPoints: 0 }
            ],
            overallFeedback: 'Tốt',
            recommendation: null
        });
    });
});

describe('assessmentService API calls', () => {
    it('calls recruiter template and application assessment endpoints cleanly', async () => {
        await listDomainTemplates('luat');
        expect(axios.get).toHaveBeenCalledWith('/api/applications/assessment-templates', { params: { domainCode: 'luat' } });

        await listDomainTemplates();
        expect(axios.get).toHaveBeenCalledWith('/api/applications/assessment-templates', { params: undefined });

        await saveDomainTemplate({
            domainCode: 'luat',
            title: 'Mẫu Luật',
            difficulty: 'INVALID',
            questions: [{ type: 'text', prompt: 'Q1', points: 5 }]
        });
        expect(axios.post).toHaveBeenCalledWith('/api/applications/assessment-templates', expect.objectContaining({
            domainCode: 'luat',
            title: 'Mẫu Luật',
            difficulty: 'MID'
        }));

        await deleteDomainTemplate('tpl-1');
        expect(axios.delete).toHaveBeenCalledWith('/api/applications/assessment-templates/tpl-1');

        await getApplicationAssessmentTemplates(101, 'luat');
        expect(axios.get).toHaveBeenCalledWith('/api/applications/101/assessment/templates', { params: { domainCode: 'luat' } });

        await getApplicationAssessment(101);
        expect(axios.get).toHaveBeenCalledWith('/api/applications/101/assessment');

        await upsertApplicationAssessment(101, {
            domainCode: 'luat',
            title: 'Bài test Luật',
            timeLimitMinutes: 45,
            questions: [{ type: 'text', prompt: 'Phân tích', points: 5 }],
            saveAsTemplate: true
        });
        expect(axios.post).toHaveBeenCalledWith('/api/applications/101/assessment', expect.objectContaining({
            domainCode: 'luat',
            title: 'Bài test Luật',
            timeLimitMinutes: 45,
            saveAsTemplate: true
        }));

        await deleteApplicationAssessment(101);
        expect(axios.delete).toHaveBeenCalledWith('/api/applications/101/assessment');
    });

    it('rejects invalid application ids before hitting HTTP', () => {
        expect(() => getApplicationAssessment(0)).toThrow('không hợp lệ');
        expect(() => getMyAssessment('abc')).toThrow('không hợp lệ');
    });

    it('orchestrates AI assessment generation and manual/AI grading flows', async () => {
        submitAiTask.mockImplementationOnce(async (fn) => {
            await fn({ idempotencyKey: 'k1' });
            return 'task-gen-1';
        });
        const generated = await generateAssessmentWithAi(101, {
            questionCount: 4,
            difficulty: 'SENIOR',
            questionMix: 'mixed',
            focusTopics: 'PostgreSQL',
            language: 'vi'
        });
        expect(postAi).toHaveBeenCalledWith('/api/applications/101/assessment/ai-generate', {
            questionCount: 4,
            difficulty: 'SENIOR',
            questionMix: 'mixed',
            focusTopics: 'PostgreSQL',
            language: 'vi'
        }, { idempotencyKey: 'k1' });
        expect(waitAiTask).toHaveBeenCalledWith('task-gen-1', 'generate_assessment', { signal: undefined, timeoutMs: 180000 });
        expect(generated).toEqual({ title: 'AI test', questions: [] });

        await gradeApplicationAssessment(101, {
            questions: [{ id: 'q1', type: 'text', points: 4 }],
            scores: { q1: { earnedPoints: 3, comment: 'Ổn' } },
            overallFeedback: 'Khá',
            recommendation: 'PASS'
        });
        expect(axios.post).toHaveBeenCalledWith('/api/applications/101/assessment/grade', expect.objectContaining({
            overallFeedback: 'Khá',
            recommendation: 'PASS'
        }));

        submitAiTask.mockImplementationOnce(async (fn) => {
            await fn({ idempotencyKey: 'k2' });
            return 'task-grade-1';
        });
        await gradeAssessmentWithAi(101, { language: 'vi' });
        expect(postAi).toHaveBeenCalledWith('/api/applications/101/assessment/ai-grade', { language: 'vi' }, { idempotencyKey: 'k2' });
        expect(waitAiTask).toHaveBeenCalledWith('task-grade-1', 'grade_assessment', { signal: undefined, timeoutMs: 180000 });
        expect(axios.post).toHaveBeenCalledWith('/api/applications/101/assessment/apply-ai-grade', { taskId: 'task-grade-1' });

        await applyAiGradeAssessment(101, 'task-manual-2');
        expect(axios.post).toHaveBeenCalledWith('/api/applications/101/assessment/apply-ai-grade', { taskId: 'task-manual-2' });
    });

    it('calls candidate assessment endpoints cleanly', async () => {
        await getMyAssessment(101);
        expect(axios.get).toHaveBeenCalledWith('/api/my-applications/101/assessment');

        await startMyAssessment(101);
        expect(axios.post).toHaveBeenCalledWith('/api/my-applications/101/assessment/start', {});

        await submitMyAssessment(101, [{ id: 'q1', type: 'text' }], { q1: { textAnswer: 'Trả lời' } });
        expect(axios.post).toHaveBeenCalledWith('/api/my-applications/101/assessment/submit', {
            answers: { q1: { textAnswer: 'Trả lời' } }
        });
    });
});
