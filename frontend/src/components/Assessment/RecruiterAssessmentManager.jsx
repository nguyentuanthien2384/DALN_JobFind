import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import {
    ASSESSMENT_STATUS_META,
    CODE_LANGUAGE_LABELS,
    QUESTION_TYPE_LABELS,
    RECOMMENDATION_META,
    deleteApplicationAssessment,
    domainLabelOf,
    generateAssessmentWithAi,
    getApplicationAssessment,
    getApplicationAssessmentTemplates,
    gradeApplicationAssessment,
    gradeAssessmentWithAi,
    upsertApplicationAssessment
} from '../../service/assessmentService';
import { aiErrorMessage } from '../../service/aiAssist';

const createEmptyQuestion = (type = 'mcq_single', index = 0) => {
    const id = `q-${Date.now().toString(36)}-${index + 1}`;
    if (type === 'mcq_single' || type === 'mcq_multi') {
        return {
            id,
            order: index + 1,
            type,
            prompt: '',
            points: 2,
            options: [
                { id: 'A', text: '' },
                { id: 'B', text: '' },
                { id: 'C', text: '' },
                { id: 'D', text: '' }
            ],
            correctOptionIds: ['A'],
            explanation: ''
        };
    }
    if (type === 'code') {
        return {
            id,
            order: index + 1,
            type: 'code',
            prompt: '',
            points: 4,
            language: 'javascript',
            starterCode: '// Nhap code mau ban dau tai day\n',
            rubric: '',
            sampleAnswer: ''
        };
    }
    return {
        id,
        order: index + 1,
        type: 'text',
        prompt: '',
        points: 3,
        placeholder: 'Nhập câu trả lời chi tiết của bạn...',
        maxLength: 8000,
        rubric: '',
        sampleAnswer: ''
    };
};

const formatDuration = (seconds) => {
    const s = Number(seconds || 0);
    if (!Number.isFinite(s) || s <= 0) return '0 giây';
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    return mins > 0 ? `${mins} phút ${rem} giây` : `${rem} giây`;
};

const blurOnWheel = (e) => {
    e.currentTarget.blur();
};

const clampScore = (raw, maxPoints) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return 0;
    const clamped = Math.max(0, Math.min(Number(maxPoints || 0), num));
    return Math.round(clamped * 100) / 100;
};

const formatAiFailureNotice = (err) => {
    const raw = aiErrorMessage(err);
    if (raw.includes('401') || raw.includes('ANTHROPIC_API_KEY')) {
        return `${raw}. Hãy kiểm tra hoặc cập nhật ANTHROPIC_API_KEY (và ANTHROPIC_BASE_URL nếu dùng gateway) trong tệp microservices/.env rồi khởi động lại ai-worker. Trong lúc này bạn vẫn có thể chấm trực tiếp bên dưới và bấm "Lưu kết quả chấm điểm".`;
    }
    return raw;
};

function QuestionEditorRow({ question, index, onChange, onRemove, canRemove }) {
    const updateField = (patch) => onChange(index, { ...question, ...patch });

    const updateOption = (optIndex, text) => {
        const nextOptions = (question.options || []).map((o, idx) => (idx === optIndex ? { ...o, text } : o));
        updateField({ options: nextOptions });
    };

    const toggleCorrectOption = (optId) => {
        if (question.type === 'mcq_single') {
            updateField({ correctOptionIds: [optId] });
            return;
        }
        const current = new Set(question.correctOptionIds || []);
        if (current.has(optId)) {
            if (current.size > 1) current.delete(optId);
        } else {
            current.add(optId);
        }
        updateField({ correctOptionIds: Array.from(current) });
    };

    return (
        <div className="jf-q-card">
            <div className="jf-q-card-head">
                <span className="jf-q-index">Câu {index + 1} · {QUESTION_TYPE_LABELS[question.type] || question.type}</span>
                <div className="jf-test-actions" style={{ marginTop: 0 }}>
                    <label htmlFor={`pts-${question.id}`} style={{ fontSize: 12 }}>Điểm:</label>
                    <input
                        id={`pts-${question.id}`}
                        type="number"
                        min={0.5}
                        max={100}
                        step={0.5}
                        value={question.points}
                        onWheel={blurOnWheel}
                        onChange={(e) => updateField({ points: Number(e.target.value) || 1 })}
                        className="jf-test-input"
                        style={{ width: 76 }}
                    />
                    {canRemove && (
                        <button type="button" className="jf-test-btn danger" onClick={() => onRemove(index)}>
                            Xóa câu
                        </button>
                    )}
                </div>
            </div>

            <div className="jf-test-field">
                <label htmlFor={`prompt-${question.id}`}>Nội dung câu hỏi *</label>
                <textarea
                    id={`prompt-${question.id}`}
                    className="jf-test-textarea"
                    value={question.prompt || ''}
                    onChange={(e) => updateField({ prompt: e.target.value })}
                    placeholder="Nhập đề bài rõ ràng, đúng nghiệp vụ chuyên môn..."
                />
            </div>

            {(question.type === 'mcq_single' || question.type === 'mcq_multi') && (
                <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: '#334155' }}>
                        Đáp án trắc nghiệm ({question.type === 'mcq_single' ? 'Chọn 1 đáp án đúng' : 'Chọn tất cả đáp án đúng'}):
                    </div>
                    <div className="jf-option-list">
                        {(question.options || []).map((opt, oIdx) => {
                            const checked = (question.correctOptionIds || []).includes(opt.id);
                            return (
                                <div key={opt.id} className={`jf-option-row ${checked ? 'correct' : ''}`}>
                                    <input
                                        type={question.type === 'mcq_single' ? 'radio' : 'checkbox'}
                                        name={`correct-${question.id}`}
                                        checked={checked}
                                        onChange={() => toggleCorrectOption(opt.id)}
                                        aria-label={`Đánh dấu đáp án ${opt.id} đúng`}
                                    />
                                    <strong style={{ minWidth: 20 }}>{opt.id}.</strong>
                                    <input
                                        type="text"
                                        className="jf-test-input"
                                        value={opt.text || ''}
                                        onChange={(e) => updateOption(oIdx, e.target.value)}
                                        placeholder={`Nội dung phương án ${opt.id}`}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {question.type === 'code' && (
                <div className="jf-test-grid" style={{ marginTop: 10 }}>
                    <div className="jf-test-field">
                        <label htmlFor={`lang-${question.id}`}>Ngôn ngữ lập trình / truy vấn</label>
                        <select
                            id={`lang-${question.id}`}
                            className="jf-test-select"
                            value={question.language || 'javascript'}
                            onChange={(e) => updateField({ language: e.target.value })}
                        >
                            {Object.entries(CODE_LANGUAGE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>{v}</option>
                            ))}
                        </select>
                    </div>
                    <div className="jf-test-field">
                        <label htmlFor={`starter-${question.id}`}>Code khung gợi ý cho ứng viên</label>
                        <textarea
                            id={`starter-${question.id}`}
                            className="jf-test-textarea"
                            style={{ fontFamily: 'Consolas, monospace' }}
                            value={question.starterCode || ''}
                            onChange={(e) => updateField({ starterCode: e.target.value })}
                        />
                    </div>
                </div>
            )}

            {(question.type === 'text' || question.type === 'code') && (
                <div className="jf-test-grid" style={{ marginTop: 8 }}>
                    <div className="jf-test-field">
                        <label htmlFor={`rubric-${question.id}`}>Tiêu chí chấm điểm (Rubric - Ẩn với ứng viên)</label>
                        <textarea
                            id={`rubric-${question.id}`}
                            className="jf-test-textarea"
                            value={question.rubric || ''}
                            onChange={(e) => updateField({ rubric: e.target.value })}
                            placeholder="Các ý chính cần đạt để AI hoặc người chấm dựa vào..."
                        />
                    </div>
                    <div className="jf-test-field">
                        <label htmlFor={`sample-${question.id}`}>Đáp án tham khảo</label>
                        <textarea
                            id={`sample-${question.id}`}
                            className="jf-test-textarea"
                            value={question.sampleAnswer || ''}
                            onChange={(e) => updateField({ sampleAnswer: e.target.value })}
                            placeholder="Lời giải chuẩn để đối chiếu khi chấm..."
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function GradingWorkspace({ applicationId, assessment, onUpdated }) {
    const questions = useMemo(() => assessment?.questions || [], [assessment]);
    const [scores, setScores] = useState({});
    const [overallFeedback, setOverallFeedback] = useState('');
    const [recommendation, setRecommendation] = useState('PASS');
    const [savingGrade, setSavingGrade] = useState(false);
    const [aiGrading, setAiGrading] = useState(false);
    const [aiError, setAiError] = useState('');

    useEffect(() => {
        const nextScores = {};
        const fbMap = new Map((assessment?.gradingFeedback?.perQuestion || []).map((item) => [item.questionId, item]));
        const mcqMap = new Map((assessment?.mcqAutoResults?.perQuestion || []).map((item) => [item.questionId, item]));
        for (const q of questions) {
            const fb = fbMap.get(q.id);
            const mcq = mcqMap.get(q.id);
            nextScores[q.id] = {
                earnedPoints: fb ? fb.earnedPoints : (mcq?.autoGraded ? mcq.earnedPoints : 0),
                comment: fb?.comment || (mcq?.autoGraded ? (mcq.isCorrect ? 'Trắc nghiệm đúng (tự động chấm).' : 'Trắc nghiệm chưa đúng.') : '')
            };
        }
        setScores(nextScores);
        setOverallFeedback(assessment?.gradingFeedback?.overallFeedback || '');
        setRecommendation(assessment?.gradingFeedback?.recommendation || 'PASS');
        setAiError('');
    }, [assessment, questions]);

    const liveTotals = useMemo(() => {
        const maxPoints = questions.reduce((sum, q) => sum + Number(q.points || 0), 0);
        const earnedPoints = questions.reduce(
            (sum, q) => sum + clampScore(scores[q.id]?.earnedPoints ?? 0, q.points),
            0
        );
        const roundedEarned = Math.round(earnedPoints * 100) / 100;
        const tenScale = maxPoints > 0 ? Math.round((roundedEarned / maxPoints) * 1000) / 100 : 0;
        return { earnedPoints: roundedEarned, maxPoints: Math.round(maxPoints * 100) / 100, tenScale };
    }, [questions, scores]);

    const adjustQuestionScore = (q, delta) => {
        setScores((prev) => {
            const current = Number(prev[q.id]?.earnedPoints ?? 0);
            return {
                ...prev,
                [q.id]: { ...prev[q.id], earnedPoints: clampScore(current + delta, q.points) }
            };
        });
    };

    const handleSaveManualGrade = async (e) => {
        e.preventDefault();
        setSavingGrade(true);
        setAiError('');
        try {
            const res = await gradeApplicationAssessment(applicationId, {
                questions,
                scores,
                overallFeedback,
                recommendation
            });
            if (res?.errCode === 0) {
                toast.success('Đã lưu kết quả chấm điểm thủ công!');
                onUpdated?.();
            } else {
                toast.error(res?.errMessage || 'Không lưu được điểm chấm');
            }
        } catch (err) {
            toast.error(err?.message || 'Lỗi khi lưu điểm chấm');
        } finally {
            setSavingGrade(false);
        }
    };

    const handleAiGrade = async () => {
        setAiGrading(true);
        setAiError('');
        try {
            const res = await gradeAssessmentWithAi(applicationId, { language: 'vi' });
            if (res?.errCode === 0) {
                toast.success('AI đã chấm xong bài test của ứng viên!');
                onUpdated?.();
            } else {
                const msg = res?.errMessage || 'AI chưa chấm được bài test';
                setAiError(msg);
                toast.error(msg);
            }
        } catch (err) {
            const detail = formatAiFailureNotice(err);
            setAiError(detail);
            toast.error(aiErrorMessage(err));
        } finally {
            setAiGrading(false);
        }
    };

    return (
        <form onSubmit={handleSaveManualGrade}>
            <div className="jf-test-header" style={{ borderBottom: 'none', marginBottom: 8, paddingBottom: 4 }}>
                <div>
                    <strong>Bài làm của ứng viên</strong>
                    <div className="jf-test-sub">
                        Thời gian làm: {formatDuration(assessment.timeSpentSeconds)}
                        {assessment.isOvertime && <span className="jf-test-pill danger" style={{ marginLeft: 8 }}>Quá giờ</span>}
                        {assessment.mcqScore !== null && assessment.mcqScore !== undefined && (
                            <span className="jf-test-pill info" style={{ marginLeft: 8 }}>
                                Điểm trắc nghiệm hệ thống: {assessment.mcqScore}/{assessment.mcqAutoResults?.mcqMaxScore ?? 0}đ
                            </span>
                        )}
                    </div>
                </div>
                <button type="button" className="jf-test-btn primary" onClick={handleAiGrade} disabled={aiGrading || savingGrade}>
                    {aiGrading ? 'AI đang chấm bài...' : 'Nhờ AI chấm bài tự động'}
                </button>
            </div>

            {aiError && (
                <div className="jf-error-banner" role="alert">
                    {aiError}
                </div>
            )}

            {assessment.status === 'GRADED' && (
                <div className="jf-grade-summary">
                    <strong>
                        Điểm tổng kết: {assessment.totalScore}/10 ({assessment.earnedPoints}/{assessment.maxScore}đ) ·{' '}
                        {assessment.gradingMode === 'AI' ? 'Chấm bằng AI' : 'Nhà tuyển dụng chấm'}
                    </strong>
                    {assessment.gradingFeedback?.recommendation && (
                        <span className={`jf-test-pill ${RECOMMENDATION_META[assessment.gradingFeedback.recommendation]?.tone || 'info'}`} style={{ marginLeft: 8 }}>
                            {RECOMMENDATION_META[assessment.gradingFeedback.recommendation]?.label}
                        </span>
                    )}
                    {assessment.gradingFeedback?.overallFeedback && (
                        <p style={{ margin: '6px 0 0', fontSize: 13.5 }}>{assessment.gradingFeedback.overallFeedback}</p>
                    )}
                </div>
            )}

            {questions.map((q, idx) => {
                const ans = assessment.answers?.[q.id] || {};
                const scoreEntry = scores[q.id] || { earnedPoints: 0, comment: '' };
                const currentScore = Number(scoreEntry.earnedPoints ?? 0);
                const codeText = ans.codeAnswer || '(Ứng viên bỏ trống)';
                const codeLines = Math.max(4, String(codeText).split('\n').length);
                const codeGutter = Array.from({ length: codeLines }, (_, i) => i + 1).join('\n');
                return (
                    <div key={q.id} className="jf-q-card">
                        <div className="jf-q-card-head">
                            <span className="jf-q-index">Câu {idx + 1} · {QUESTION_TYPE_LABELS[q.type]} (Tối đa {q.points}đ)</span>
                            <div className="jf-test-actions" style={{ marginTop: 0 }}>
                                <label htmlFor={`grade-pt-${q.id}`} style={{ fontSize: 12.5, fontWeight: 600 }}>Chấm điểm:</label>
                                <div className="jf-score-stepper">
                                    <button
                                        type="button"
                                        className="jf-score-btn"
                                        aria-label={`Giảm điểm câu ${idx + 1}`}
                                        onClick={() => adjustQuestionScore(q, -0.25)}
                                        disabled={currentScore <= 0}
                                    >
                                        −
                                    </button>
                                    <input
                                        id={`grade-pt-${q.id}`}
                                        type="number"
                                        min={0}
                                        max={q.points}
                                        step={0.25}
                                        value={scoreEntry.earnedPoints}
                                        onWheel={blurOnWheel}
                                        onChange={(e) => setScores((prev) => ({
                                            ...prev,
                                            [q.id]: { ...prev[q.id], earnedPoints: clampScore(e.target.value, q.points) }
                                        }))}
                                        className="jf-score-input"
                                    />
                                    <button
                                        type="button"
                                        className="jf-score-btn"
                                        aria-label={`Tăng điểm câu ${idx + 1}`}
                                        onClick={() => adjustQuestionScore(q, 0.25)}
                                        disabled={currentScore >= Number(q.points || 0)}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="jf-q-prompt">{q.prompt}</div>

                        {(q.type === 'mcq_single' || q.type === 'mcq_multi') && (
                            <div className="jf-option-list" style={{ marginBottom: 10 }}>
                                {(q.options || []).map((opt) => {
                                    const chosen = (ans.selectedOptionIds || []).includes(opt.id);
                                    const isCorrect = (q.correctOptionIds || []).includes(opt.id);
                                    return (
                                        <div key={opt.id} className={`jf-option-row is-readonly ${isCorrect ? 'correct' : chosen ? 'wrong' : ''}`}>
                                            <div className="jf-option-main">
                                                <span className="jf-option-letter">{opt.id}</span>
                                                <span className="jf-option-text">{opt.text}</span>
                                            </div>
                                            {(chosen || isCorrect) && (
                                                <div className="jf-option-badges">
                                                    {chosen && (
                                                        <span className={`jf-test-pill ${isCorrect ? 'info' : 'danger'}`}>
                                                            {isCorrect ? '✓ Ứng viên chọn' : '✗ Ứng viên chọn sai'}
                                                        </span>
                                                    )}
                                                    {isCorrect && <span className="jf-test-pill success">✓ Đáp án đúng</span>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {q.type === 'code' && (
                            <div className="jf-code-wrap" style={{ marginBottom: 10 }}>
                                <div className="jf-code-bar">
                                    <span>Bài code của ứng viên ({CODE_LANGUAGE_LABELS[q.language] || q.language})</span>
                                </div>
                                <div className="jf-code-body">
                                    <div className="jf-code-gutter" aria-hidden="true">{codeGutter}</div>
                                    <pre className="jf-code-pre" style={{ flex: 1 }}>{codeText}</pre>
                                </div>
                            </div>
                        )}

                        {q.type === 'text' && (
                            <div className="jf-text-answer-box">
                                <strong>Câu trả lời của ứng viên:</strong>
                                <div style={{ marginTop: 6 }}>{ans.textAnswer || '(Ứng viên bỏ trống)'}</div>
                            </div>
                        )}

                        {(q.rubric || q.sampleAnswer) && (
                            <div className="jf-rubric-box">
                                {q.rubric && <div><strong>Tiêu chí (Rubric):</strong> {q.rubric}</div>}
                                {q.sampleAnswer && <div style={{ marginTop: 4 }}><strong>Đáp án mẫu:</strong> {q.sampleAnswer}</div>}
                            </div>
                        )}

                        <div className="jf-test-field" style={{ marginBottom: 0 }}>
                            <label htmlFor={`grade-cmt-${q.id}`}>Nhận xét cho câu này</label>
                            <input
                                id={`grade-cmt-${q.id}`}
                                type="text"
                                className="jf-test-input"
                                value={scoreEntry.comment || ''}
                                onChange={(e) => setScores((prev) => ({
                                    ...prev,
                                    [q.id]: { ...prev[q.id], comment: e.target.value }
                                }))}
                                placeholder="Nhận xét chi tiết..."
                            />
                        </div>
                    </div>
                );
            })}

            <div className="jf-test-grid">
                <div className="jf-test-field">
                    <label htmlFor="overall-feedback">Đánh giá tổng quan của nhà tuyển dụng</label>
                    <textarea
                        id="overall-feedback"
                        className="jf-test-textarea"
                        value={overallFeedback}
                        onChange={(e) => setOverallFeedback(e.target.value)}
                        placeholder="Tổng kết điểm mạnh, điểm cần cải thiện..."
                    />
                </div>
                <div className="jf-test-field">
                    <label htmlFor="grade-rec">Kết luận vòng test</label>
                    <select
                        id="grade-rec"
                        className="jf-test-select"
                        value={recommendation}
                        onChange={(e) => setRecommendation(e.target.value)}
                    >
                        <option value="PASS">Đạt vòng test (PASS)</option>
                        <option value="CONSIDER">Cần cân nhắc thêm (CONSIDER)</option>
                        <option value="FAIL">Chưa đạt (FAIL)</option>
                    </select>
                </div>
            </div>

            <div className="jf-test-actions" style={{ justifyContent: 'space-between' }}>
                <span className="jf-grade-preview">
                    Tổng điểm dự kiến: {liveTotals.earnedPoints}/{liveTotals.maxPoints}đ ({liveTotals.tenScale}/10)
                </span>
                <button type="submit" className="jf-test-btn success" disabled={savingGrade || aiGrading}>
                    {savingGrade ? 'Đang lưu điểm...' : 'Lưu kết quả chấm điểm thủ công'}
                </button>
            </div>
        </form>
    );
}

export default function RecruiterAssessmentManager({ applicationId, stage, onAssessmentUpdated }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [state, setState] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [tab, setTab] = useState('templates');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [timeLimitMinutes, setTimeLimitMinutes] = useState(40);
    const [questions, setQuestions] = useState([createEmptyQuestion('mcq_single', 0)]);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [saveAsTemplate, setSaveAsTemplate] = useState(false);
    const [savingTest, setSavingTest] = useState(false);

    const [aiConfig, setAiConfig] = useState({
        questionCount: 5,
        difficulty: 'MID',
        questionMix: 'mixed',
        focusTopics: '',
        language: 'vi'
    });
    const [generatingAi, setGeneratingAi] = useState(false);
    const [aiGenerateError, setAiGenerateError] = useState('');
    const [confirmWithdraw, setConfirmWithdraw] = useState(false);

    const hydrateEditorFromAssessment = useCallback((assessment, domainCode) => {
        if (!assessment) {
            setTitle('');
            setDescription('');
            setInstructions('');
            setTimeLimitMinutes(40);
            setSelectedTemplateId('');
            setQuestions([
                createEmptyQuestion('mcq_single', 0),
                createEmptyQuestion(domainCode === 'cong-nghe-thong-tin' ? 'code' : 'text', 1)
            ]);
            return;
        }
        setTitle(assessment.title || '');
        setDescription(assessment.description || '');
        setInstructions(assessment.instructions || '');
        setTimeLimitMinutes(assessment.timeLimitMinutes || 40);
        setSelectedTemplateId(assessment.templateId || '');
        setQuestions(Array.isArray(assessment.questions) && assessment.questions.length
            ? assessment.questions
            : [createEmptyQuestion('mcq_single', 0)]);
    }, []);

    const loadAll = useCallback(async () => {
        if (!applicationId) return;
        setLoading(true);
        setError('');
        try {
            const res = await getApplicationAssessment(applicationId);
            if (res?.errCode !== 0 || !res?.data) {
                setError(res?.errMessage || 'Chưa tải được thông tin bài test.');
                return;
            }
            setState(res.data);
            hydrateEditorFromAssessment(res.data.assessment, res.data.domainCode);

            if (res.data.canCreate && res.data.domainCode) {
                const tplRes = await getApplicationAssessmentTemplates(applicationId);
                if (tplRes?.errCode === 0 && tplRes?.data) {
                    setTemplates(tplRes.data.templates || []);
                }
            } else {
                setTemplates([]);
            }
        } catch {
            setError('Không tải được bài test.');
        } finally {
            setLoading(false);
        }
    }, [applicationId, hydrateEditorFromAssessment]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    const currentAssessment = state?.assessment || null;
    const effectiveStage = state?.stage || stage;
    const canCreate = Boolean(state?.canCreate ?? (effectiveStage === 'phong_van'));
    const domainCode = state?.domainCode || null;
    const domainLabel = state?.domainLabel || domainLabelOf(domainCode);

    const handleSelectTemplate = (tpl) => {
        setSelectedTemplateId(String(tpl.id));
        setTitle(tpl.title || '');
        setDescription(tpl.description || '');
        setTimeLimitMinutes(tpl.timeLimitMinutes || 40);
        setQuestions(JSON.parse(JSON.stringify(tpl.questions || [])));
        setTab('editor');
        toast.info(`Đã nạp mẫu đề "${tpl.title}" đúng ngành ${domainLabel}`);
    };

    const handleGenerateAi = async () => {
        setGeneratingAi(true);
        setAiGenerateError('');
        try {
            const generated = await generateAssessmentWithAi(applicationId, aiConfig);
            setSelectedTemplateId('');
            setTitle(generated.title || `Bài test chuyên sâu ${domainLabel}`);
            setDescription(generated.description || '');
            setTimeLimitMinutes(generated.timeLimitMinutes || 40);
            setQuestions(Array.isArray(generated.questions) ? generated.questions : []);
            setTab('editor');
            toast.success('AI đã tạo bộ đề đúng chuyên ngành! Hãy rà soát trước khi giao.');
        } catch (err) {
            const detail = formatAiFailureNotice(err);
            setAiGenerateError(detail);
            toast.error(aiErrorMessage(err));
        } finally {
            setGeneratingAi(false);
        }
    };

    const handleSaveAssessment = async (e) => {
        e.preventDefault();
        if (!title.trim()) {
            toast.error('Vui lòng nhập tiêu đề bài test.');
            return;
        }
        setSavingTest(true);
        try {
            const res = await upsertApplicationAssessment(applicationId, {
                templateId: selectedTemplateId || null,
                domainCode,
                title,
                description,
                instructions,
                timeLimitMinutes,
                questions,
                saveAsTemplate
            });
            if (res?.errCode === 0) {
                toast.success('Đã giao bài test cho ứng viên trong vòng Phỏng vấn chuyên sâu!');
                await loadAll();
                onAssessmentUpdated?.();
            } else {
                toast.error(res?.errMessage || 'Không lưu được bài test');
            }
        } catch (err) {
            toast.error(err?.message || 'Dữ liệu câu hỏi chưa hợp lệ');
        } finally {
            setSavingTest(false);
        }
    };

    const handleWithdraw = async () => {
        setSavingTest(true);
        try {
            const res = await deleteApplicationAssessment(applicationId);
            if (res?.errCode === 0) {
                toast.success('Đã thu hồi bài test.');
                setConfirmWithdraw(false);
                await loadAll();
                onAssessmentUpdated?.();
            } else {
                toast.error(res?.errMessage || 'Không thu hồi được bài test');
            }
        } finally {
            setSavingTest(false);
        }
    };

    if (loading) {
        return <div className="jf-test-panel">Đang tải thông tin bài test đánh giá...</div>;
    }

    if (error) {
        return <div className="jf-test-panel"><div className="jf-error-banner">{error}</div></div>;
    }

    const isSubmittedOrGraded = currentAssessment && ['SUBMITTED', 'GRADED'].includes(currentAssessment.status);

    return (
        <div className="jf-test-panel">
            <div className="jf-test-header">
                <div>
                    <div className="jf-test-title-row">
                        <h4 className="jf-test-title">Bài test đánh giá chuyên sâu</h4>
                        {domainCode && (
                            <span className="jf-test-pill" title="Khóa cứng theo lĩnh vực tin tuyển dụng, không copy chéo ngành">
                                Ngành: {domainLabel}
                            </span>
                        )}
                        {currentAssessment && (
                            <span className={`jf-test-pill ${ASSESSMENT_STATUS_META[currentAssessment.status]?.tone || 'info'}`}>
                                {ASSESSMENT_STATUS_META[currentAssessment.status]?.label || currentAssessment.status}
                            </span>
                        )}
                    </div>
                    <p className="jf-test-sub">
                        {canCreate
                            ? 'Hồ sơ đã vào vòng Phỏng vấn chuyên sâu: nhà tuyển dụng có thể tùy chọn giao đề mẫu theo ngành, nhờ AI tạo đề hoặc tự soạn đề hỗn hợp.'
                            : 'Bài test chỉ được tùy chọn tạo và giao khi ứng viên ở vòng Phỏng vấn chuyên sâu (phong_van).'}
                    </p>
                </div>
            </div>

            {!currentAssessment && !canCreate && (
                <div className="jf-test-lock">
                    Chức năng tạo/giao bài test đang bị khóa ở vòng này. Khi nào bạn chuyển ứng viên sang bước{' '}
                    <strong>Phỏng vấn chuyên sâu (phong_van)</strong> và muốn cho ứng viên làm thêm bài test, tính năng chọn đề mẫu ngành{' '}
                    <strong>{domainLabel}</strong> hoặc nhờ AI tạo đề sẽ tự động mở khóa.
                </div>
            )}

            {isSubmittedOrGraded && (
                <GradingWorkspace
                    applicationId={applicationId}
                    assessment={currentAssessment}
                    onUpdated={async () => {
                        await loadAll();
                        onAssessmentUpdated?.();
                    }}
                />
            )}

            {canCreate && !isSubmittedOrGraded && (
                <>
                    {!domainCode && (
                        <div className="jf-error-banner">
                            Tin tuyển dụng này chưa gắn mã lĩnh vực (categoryJobCode). Vui lòng cập nhật ngành cho tin tuyển dụng trước khi gán bài test.
                        </div>
                    )}

                    <div className="jf-test-tabs" role="tablist">
                        <button
                            type="button"
                            className={`jf-test-tab ${tab === 'templates' ? 'active' : ''}`}
                            onClick={() => setTab('templates')}
                        >
                            Kho đề chuẩn ngành ({templates.length})
                        </button>
                        <button
                            type="button"
                            className={`jf-test-tab ${tab === 'ai' ? 'active' : ''}`}
                            onClick={() => setTab('ai')}
                        >
                            Nhờ AI tạo bài test
                        </button>
                        <button
                            type="button"
                            className={`jf-test-tab ${tab === 'editor' ? 'active' : ''}`}
                            onClick={() => setTab('editor')}
                        >
                            Soạn &amp; Giao đề ({questions.length} câu)
                        </button>
                    </div>

                    {tab === 'templates' && (
                        <div>
                            {templates.length > 0 ? (
                                <div className="jf-test-tpl-list">
                                    {templates.map((tpl) => (
                                        <div key={tpl.id} className="jf-test-tpl-card">
                                            <div>
                                                <div className="jf-test-title-row" style={{ marginBottom: 4 }}>
                                                    <span className="jf-test-pill info">{tpl.source === 'company' ? 'Đề công ty' : 'Đề chuẩn hệ thống'}</span>
                                                    <span className="jf-test-pill">{tpl.timeLimitMinutes} phút · {tpl.questions?.length || 0} câu</span>
                                                </div>
                                                <h4>{tpl.title}</h4>
                                                <p>{tpl.description}</p>
                                            </div>
                                            <button type="button" className="jf-test-btn primary" onClick={() => handleSelectTemplate(tpl)}>
                                                Dùng đề này &amp; Tùy chỉnh
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="jf-test-lock">
                                    Lĩnh vực <strong>{domainLabel}</strong> chưa có đề mẫu dựng sẵn (hệ thống không copy đề từ ngành khác sang).
                                    Hãy dùng tab <strong>Nhờ AI tạo bài test</strong> hoặc tự soạn ở tab <strong>Soạn &amp; Giao đề</strong>.
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'ai' && (
                        <div>
                            <div className="jf-test-grid">
                                <div className="jf-test-field">
                                    <label htmlFor="ai-q-count">Số lượng câu hỏi (3-10)</label>
                                    <input
                                        id="ai-q-count"
                                        type="number"
                                        min={3}
                                        max={10}
                                        className="jf-test-input"
                                        value={aiConfig.questionCount}
                                        onWheel={blurOnWheel}
                                        onChange={(e) => setAiConfig((p) => ({ ...p, questionCount: Number(e.target.value) || 5 }))}
                                    />
                                </div>
                                <div className="jf-test-field">
                                    <label htmlFor="ai-diff">Độ khó</label>
                                    <select
                                        id="ai-diff"
                                        className="jf-test-select"
                                        value={aiConfig.difficulty}
                                        onChange={(e) => setAiConfig((p) => ({ ...p, difficulty: e.target.value }))}
                                    >
                                        <option value="JUNIOR">Junior / Fresher</option>
                                        <option value="MID">Middle</option>
                                        <option value="SENIOR">Senior / Lead</option>
                                    </select>
                                </div>
                                <div className="jf-test-field">
                                    <label htmlFor="ai-mix">Cấu trúc câu hỏi</label>
                                    <select
                                        id="ai-mix"
                                        className="jf-test-select"
                                        value={aiConfig.questionMix}
                                        onChange={(e) => setAiConfig((p) => ({ ...p, questionMix: e.target.value }))}
                                    >
                                        <option value="mixed">Trộn Trắc nghiệm + Điền/Code thực hành</option>
                                        <option value="mcq_focused">Ưu tiên Trắc nghiệm (kèm câu mở)</option>
                                        <option value="practical_focused">Ưu tiên Thực hành điền / Code</option>
                                    </select>
                                </div>
                            </div>
                            <div className="jf-test-field">
                                <label htmlFor="ai-focus">Chủ đề muốn AI tập trung kiểm tra (tùy chọn)</label>
                                <input
                                    id="ai-focus"
                                    type="text"
                                    className="jf-test-input"
                                    value={aiConfig.focusTopics}
                                    onChange={(e) => setAiConfig((p) => ({ ...p, focusTopics: e.target.value }))}
                                    placeholder={domainCode === 'cong-nghe-thong-tin'
                                        ? 'Ví dụ: SQL Query tối ưu, thiết kế REST API, debug React hooks...'
                                        : `Nhập kiến thức/kỹ năng trọng tâm của ngành ${domainLabel}...`}
                                />
                            </div>
                            <button type="button" className="jf-test-btn primary" onClick={handleGenerateAi} disabled={generatingAi || !domainCode}>
                                {generatingAi ? 'AI đang tạo đề đúng chuyên ngành...' : `Nhờ AI tạo bài test ngành ${domainLabel}`}
                            </button>
                            {aiGenerateError && (
                                <div className="jf-error-banner" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>
                                    {aiGenerateError}
                                </div>
                            )}
                        </div>
                    )}

                    {tab === 'editor' && (
                        <form onSubmit={handleSaveAssessment}>
                            <div className="jf-test-grid">
                                <div className="jf-test-field">
                                    <label htmlFor="assess-title">Tiêu đề bài test *</label>
                                    <input
                                        id="assess-title"
                                        type="text"
                                        className="jf-test-input"
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder={`Bài test chuyên sâu ${domainLabel}`}
                                        required
                                    />
                                </div>
                                <div className="jf-test-field">
                                    <label htmlFor="assess-time">Thời gian làm bài (phút)</label>
                                    <input
                                        id="assess-time"
                                        type="number"
                                        min={5}
                                        max={240}
                                        className="jf-test-input"
                                        value={timeLimitMinutes}
                                        onWheel={blurOnWheel}
                                        onChange={(e) => setTimeLimitMinutes(Number(e.target.value) || 40)}
                                    />
                                </div>
                            </div>

                            <div className="jf-test-field">
                                <label htmlFor="assess-desc">Mô tả / Hướng dẫn làm bài cho ứng viên</label>
                                <textarea
                                    id="assess-desc"
                                    className="jf-test-textarea"
                                    style={{ minHeight: 60 }}
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Lưu ý ứng viên về định dạng câu trả lời hoặc phạm vi đánh giá..."
                                />
                            </div>

                            {questions.map((q, idx) => (
                                <QuestionEditorRow
                                    key={q.id || idx}
                                    question={q}
                                    index={idx}
                                    canRemove={questions.length > 1}
                                    onChange={(i, updated) => setQuestions((prev) => prev.map((item, k) => (k === i ? updated : item)))}
                                    onRemove={(i) => setQuestions((prev) => prev.filter((_, k) => k !== i))}
                                />
                            ))}

                            <div className="jf-test-actions" style={{ marginBottom: 12 }}>
                                <button type="button" className="jf-test-btn" onClick={() => setQuestions((p) => [...p, createEmptyQuestion('mcq_single', p.length)])}>
                                    + Trắc nghiệm 1 đáp án
                                </button>
                                <button type="button" className="jf-test-btn" onClick={() => setQuestions((p) => [...p, createEmptyQuestion('mcq_multi', p.length)])}>
                                    + Trắc nghiệm nhiều đáp án
                                </button>
                                <button type="button" className="jf-test-btn" onClick={() => setQuestions((p) => [...p, createEmptyQuestion('text', p.length)])}>
                                    + Câu điền tự luận / tình huống
                                </button>
                                <button type="button" className="jf-test-btn" onClick={() => setQuestions((p) => [...p, createEmptyQuestion('code', p.length)])}>
                                    + Câu viết code thực hành
                                </button>
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                                <input
                                    type="checkbox"
                                    checked={saveAsTemplate}
                                    onChange={(e) => setSaveAsTemplate(e.target.checked)}
                                />
                                Lưu đề này vào kho đề của công ty cho riêng ngành <strong>{domainLabel}</strong>
                            </label>

                            <div className="jf-test-actions">
                                <button type="submit" className="jf-test-btn primary" disabled={savingTest || !domainCode}>
                                    {savingTest ? 'Đang lưu & giao bài...' : currentAssessment ? 'Cập nhật bài test đã giao' : 'Giao bài test cho ứng viên'}
                                </button>
                                {currentAssessment && !confirmWithdraw && (
                                    <button type="button" className="jf-test-btn danger" onClick={() => setConfirmWithdraw(true)} disabled={savingTest}>
                                        Thu hồi bài test
                                    </button>
                                )}
                            </div>

                            {confirmWithdraw && (
                                <div className="jf-confirm-box">
                                    Xác nhận thu hồi bài test chưa nộp này?
                                    <div className="jf-test-actions">
                                        <button type="button" className="jf-test-btn danger" onClick={handleWithdraw} disabled={savingTest}>
                                            Xác nhận thu hồi
                                        </button>
                                        <button type="button" className="jf-test-btn" onClick={() => setConfirmWithdraw(false)}>
                                            Hủy
                                        </button>
                                    </div>
                                </div>
                            )}
                        </form>
                    )}
                </>
            )}
        </div>
    );
}
