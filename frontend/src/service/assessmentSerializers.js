export const ASSESSMENT_DOMAIN_LABELS = Object.freeze({
    'cong-nghe-thong-tin': 'Công nghệ thông tin',
    'truyen-thong': 'Truyền thông',
    'kinh-te': 'Kinh tế',
    'quan-ly-nhan-su': 'Quản lý nhân sự',
    'giao-vien': 'Giáo viên',
    'bat-dong-san': 'Bất động sản',
    'luat': 'Luật',
    'logistics': 'Logistics'
});

export const QUESTION_TYPE_LABELS = Object.freeze({
    mcq_single: 'Trắc nghiệm 1 đáp án',
    mcq_multi: 'Trắc nghiệm nhiều đáp án',
    text: 'Điền tự luận / tình huống',
    code: 'Thực hành viết code'
});

export const CODE_LANGUAGE_LABELS = Object.freeze({
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    java: 'Java',
    sql: 'SQL',
    html_css: 'HTML / CSS',
    other: 'Ngôn ngữ khác'
});

export const ASSESSMENT_STATUS_META = Object.freeze({
    ASSIGNED: { label: 'Đã giao bài test', tone: 'info' },
    IN_PROGRESS: { label: 'Ứng viên đang làm bài', tone: 'warn' },
    SUBMITTED: { label: 'Đã nộp - Chờ chấm', tone: 'pending' },
    GRADED: { label: 'Đã chấm điểm', tone: 'success' }
});

export const RECOMMENDATION_META = Object.freeze({
    PASS: { label: 'Đạt vòng test', tone: 'success' },
    CONSIDER: { label: 'Cần cân nhắc', tone: 'warn' },
    FAIL: { label: 'Chưa đạt', tone: 'danger' }
});

export const domainLabelOf = (domainCode, fallback) => {
    const code = String(domainCode || '').trim().toLowerCase();
    return ASSESSMENT_DOMAIN_LABELS[code] || fallback || code || 'Chưa xác định lĩnh vực';
};

// Chuan hoa cau hoi theo dung hop dong HTTP strict schema (additionalProperties: false).
export const serializeQuestionForApi = (question = {}, index = 0) => {
    const type = ['mcq_single', 'mcq_multi', 'text', 'code'].includes(question.type)
        ? question.type
        : 'text';
    const base = {
        id: String(question.id || `q-${index + 1}`).trim().slice(0, 64),
        order: Math.max(1, Math.min(50, Math.round(Number(question.order) || (index + 1)))),
        type,
        prompt: String(question.prompt || '').trim().slice(0, 4000),
        points: Math.max(0.5, Math.min(100, Number(question.points) || (type.startsWith('mcq') ? 2 : 4)))
    };

    if (type === 'mcq_single' || type === 'mcq_multi') {
        const options = Array.isArray(question.options)
            ? question.options
                .filter((opt) => opt && String(opt.text || '').trim())
                .slice(0, 8)
                .map((opt, idx) => ({
                    id: String(opt.id || String.fromCharCode(65 + idx)).trim().slice(0, 16),
                    text: String(opt.text).trim().slice(0, 1000)
                }))
            : [];
        const validIds = new Set(options.map((o) => o.id));
        const correctOptionIds = Array.isArray(question.correctOptionIds)
            ? [...new Set(question.correctOptionIds.map((id) => String(id).trim()).filter((id) => validIds.has(id)))]
            : [];
        return {
            ...base,
            options,
            correctOptionIds: type === 'mcq_single' ? correctOptionIds.slice(0, 1) : correctOptionIds,
            ...(question.explanation && String(question.explanation).trim()
                ? { explanation: String(question.explanation).trim().slice(0, 2000) }
                : {})
        };
    }

    if (type === 'code') {
        const lang = Object.hasOwn(CODE_LANGUAGE_LABELS, question.language) ? question.language : 'javascript';
        return {
            ...base,
            language: lang,
            ...(typeof question.starterCode === 'string' && question.starterCode
                ? { starterCode: question.starterCode.slice(0, 10000) }
                : {}),
            ...(question.rubric && String(question.rubric).trim()
                ? { rubric: String(question.rubric).trim().slice(0, 3000) }
                : {}),
            ...(question.sampleAnswer && String(question.sampleAnswer).trim()
                ? { sampleAnswer: String(question.sampleAnswer).trim().slice(0, 10000) }
                : {})
        };
    }

    const maxLength = question.maxLength
        ? Math.max(50, Math.min(15000, Math.round(Number(question.maxLength))))
        : undefined;
    return {
        ...base,
        ...(question.placeholder && String(question.placeholder).trim()
            ? { placeholder: String(question.placeholder).trim().slice(0, 300) }
            : {}),
        ...(maxLength ? { maxLength } : {}),
        ...(question.rubric && String(question.rubric).trim()
            ? { rubric: String(question.rubric).trim().slice(0, 3000) }
            : {}),
        ...(question.sampleAnswer && String(question.sampleAnswer).trim()
            ? { sampleAnswer: String(question.sampleAnswer).trim().slice(0, 10000) }
            : {})
    };
};

export const serializeAnswersForApi = (questions = [], rawAnswers = {}) => {
    const serialized = {};
    for (const q of questions) {
        const entry = rawAnswers?.[q.id] || {};
        if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
            const validIds = new Set((q.options || []).map((o) => o.id));
            const selectedOptionIds = Array.isArray(entry.selectedOptionIds)
                ? [...new Set(entry.selectedOptionIds.map((v) => String(v).trim()).filter((v) => validIds.has(v)))]
                : [];
            serialized[q.id] = {
                selectedOptionIds: q.type === 'mcq_single' ? selectedOptionIds.slice(0, 1) : selectedOptionIds
            };
        } else if (q.type === 'code') {
            serialized[q.id] = {
                codeAnswer: typeof entry.codeAnswer === 'string' ? entry.codeAnswer.slice(0, 30000) : ''
            };
        } else {
            serialized[q.id] = {
                textAnswer: typeof entry.textAnswer === 'string' ? entry.textAnswer.slice(0, 15000) : ''
            };
        }
    }
    return serialized;
};

export const serializeManualGradeForApi = ({ questions = [], scores = {}, overallFeedback = null, recommendation = null }) => ({
    questionScores: questions.map((q) => {
        const entry = scores[q.id] || {};
        const max = Number(q.points || 0);
        const earned = Math.max(0, Math.min(max, Number(entry.earnedPoints ?? 0)));
        return {
            questionId: q.id,
            earnedPoints: Number(earned.toFixed(2)),
            ...(entry.comment && String(entry.comment).trim()
                ? { comment: String(entry.comment).trim().slice(0, 2000) }
                : {})
        };
    }),
    overallFeedback: overallFeedback && String(overallFeedback).trim()
        ? String(overallFeedback).trim().slice(0, 4000)
        : null,
    recommendation: ['PASS', 'CONSIDER', 'FAIL'].includes(recommendation) ? recommendation : null
});

export const serializeAssessmentUpsertForApi = (payload = {}) => ({
    ...(payload.templateId ? { templateId: String(payload.templateId) } : {}),
    ...(payload.domainCode ? { domainCode: String(payload.domainCode) } : {}),
    title: String(payload.title || '').trim(),
    description: payload.description && String(payload.description).trim() ? String(payload.description).trim() : null,
    instructions: payload.instructions && String(payload.instructions).trim() ? String(payload.instructions).trim() : null,
    timeLimitMinutes: payload.timeLimitMinutes ? Math.round(Number(payload.timeLimitMinutes)) : null,
    questions: (payload.questions || []).map(serializeQuestionForApi),
    saveAsTemplate: Boolean(payload.saveAsTemplate)
});
