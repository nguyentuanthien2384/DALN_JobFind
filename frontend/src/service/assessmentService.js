import axios from '../axios';
import { postAi } from './aiSearchService';
import { submitAiTask, waitAiTask } from './aiAssist';
import {
    serializeAnswersForApi,
    serializeAssessmentUpsertForApi,
    serializeManualGradeForApi,
    serializeQuestionForApi
} from './assessmentSerializers';

export * from './assessmentSerializers';

const safeId = (value) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1) {
        throw new Error('Mã hồ sơ ứng tuyển không hợp lệ.');
    }
    return encodeURIComponent(String(n));
};

// ================= NHA TUYEN DUNG: KHO DE & BAI TEST HO SO =================

export const listDomainTemplates = (domainCode) =>
    axios.get('/api/applications/assessment-templates', {
        params: domainCode ? { domainCode } : undefined
    });

export const saveDomainTemplate = (payload) =>
    axios.post('/api/applications/assessment-templates', {
        domainCode: String(payload.domainCode || '').trim(),
        title: String(payload.title || '').trim(),
        description: payload.description && String(payload.description).trim() ? String(payload.description).trim() : null,
        timeLimitMinutes: payload.timeLimitMinutes ? Math.round(Number(payload.timeLimitMinutes)) : null,
        difficulty: ['JUNIOR', 'MID', 'SENIOR'].includes(payload.difficulty) ? payload.difficulty : 'MID',
        questions: (payload.questions || []).map(serializeQuestionForApi)
    });

export const deleteDomainTemplate = (templateId) =>
    axios.delete(`/api/applications/assessment-templates/${encodeURIComponent(String(templateId))}`);

export const getApplicationAssessmentTemplates = (applicationId, domainCode) =>
    axios.get(`/api/applications/${safeId(applicationId)}/assessment/templates`, {
        params: domainCode ? { domainCode } : undefined
    });

export const getApplicationAssessment = (applicationId) =>
    axios.get(`/api/applications/${safeId(applicationId)}/assessment`);

export const upsertApplicationAssessment = (applicationId, payload) =>
    axios.post(`/api/applications/${safeId(applicationId)}/assessment`, serializeAssessmentUpsertForApi(payload));

export const deleteApplicationAssessment = (applicationId) =>
    axios.delete(`/api/applications/${safeId(applicationId)}/assessment`);

export const aiGenerateApplicationAssessment = (applicationId, payload = {}, options) =>
    postAi(`/api/applications/${safeId(applicationId)}/assessment/ai-generate`, {
        questionCount: Math.max(3, Math.min(10, Math.round(Number(payload.questionCount) || 5))),
        difficulty: ['JUNIOR', 'MID', 'SENIOR'].includes(payload.difficulty) ? payload.difficulty : 'MID',
        questionMix: ['mixed', 'mcq_focused', 'practical_focused'].includes(payload.questionMix) ? payload.questionMix : 'mixed',
        ...(payload.focusTopics && String(payload.focusTopics).trim()
            ? { focusTopics: String(payload.focusTopics).trim().slice(0, 500) }
            : {}),
        language: payload.language === 'en' ? 'en' : 'vi'
    }, options);

export const generateAssessmentWithAi = async (applicationId, payload = {}, { signal, timeoutMs = 180000 } = {}) => {
    const taskId = await submitAiTask((options) => aiGenerateApplicationAssessment(applicationId, payload, options), { signal });
    return waitAiTask(taskId, 'generate_assessment', { signal, timeoutMs });
};

export const gradeApplicationAssessment = (applicationId, payload) =>
    axios.post(`/api/applications/${safeId(applicationId)}/assessment/grade`, serializeManualGradeForApi(payload));

export const aiGradeApplicationAssessment = (applicationId, payload = {}, options) =>
    postAi(`/api/applications/${safeId(applicationId)}/assessment/ai-grade`, {
        language: payload.language === 'en' ? 'en' : 'vi'
    }, options);

export const applyAiGradeAssessment = (applicationId, taskId) =>
    axios.post(`/api/applications/${safeId(applicationId)}/assessment/apply-ai-grade`, {
        taskId: String(taskId || '').trim()
    });

export const gradeAssessmentWithAi = async (applicationId, payload = {}, { signal, timeoutMs = 180000 } = {}) => {
    const taskId = await submitAiTask((options) => aiGradeApplicationAssessment(applicationId, payload, options), { signal });
    await waitAiTask(taskId, 'grade_assessment', { signal, timeoutMs });
    return applyAiGradeAssessment(applicationId, taskId);
};

// ================= UNG VIEN: XEM, LAM BAI & NOP BAI =================

export const getMyAssessment = (applicationId) =>
    axios.get(`/api/my-applications/${safeId(applicationId)}/assessment`);

export const startMyAssessment = (applicationId) =>
    axios.post(`/api/my-applications/${safeId(applicationId)}/assessment/start`, {});

export const submitMyAssessment = (applicationId, questions, answers, options = {}) =>
    axios.post(`/api/my-applications/${safeId(applicationId)}/assessment/submit`, {
        answers: serializeAnswersForApi(questions, answers),
        ...(typeof options?.sendEmailCopy === 'boolean' ? { sendEmailCopy: options.sendEmailCopy } : {}),
        ...(options?.resendEmailCopy === true ? { resendEmailCopy: true } : {})
    });

export const resendMyAssessmentEmailCopy = (applicationId) =>
    axios.post(`/api/my-applications/${safeId(applicationId)}/assessment/submit`, {
        answers: {},
        resendEmailCopy: true
    });
