import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    ASSESSMENT_STATUS_META,
    CODE_LANGUAGE_LABELS,
    QUESTION_TYPE_LABELS,
    RECOMMENDATION_META,
    getMyAssessment,
    startMyAssessment,
    submitMyAssessment
} from '../../service/assessmentService';

const draftStorageKey = (applicationId) => `jf.assessment.draft.${applicationId}`;

const formatCountdown = (seconds) => {
    const safe = Math.max(0, Math.floor(Number(seconds || 0)));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const readDraft = (applicationId) => {
    try {
        const raw = window.sessionStorage.getItem(draftStorageKey(applicationId));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const writeDraft = (applicationId, answers) => {
    try {
        window.sessionStorage.setItem(draftStorageKey(applicationId), JSON.stringify(answers));
    } catch {
        // Bo qua neu trinh duyet chan sessionStorage
    }
};

const clearDraft = (applicationId) => {
    try {
        window.sessionStorage.removeItem(draftStorageKey(applicationId));
    } catch {
        // Bo qua
    }
};

const buildInitialAnswers = (questions = [], serverAnswers = null, savedDraft = null) => {
    const out = {};
    for (const q of questions) {
        const fromServer = serverAnswers?.[q.id];
        const fromDraft = savedDraft?.[q.id];
        const source = fromServer || fromDraft;
        if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
            out[q.id] = { selectedOptionIds: Array.isArray(source?.selectedOptionIds) ? source.selectedOptionIds : [] };
        } else if (q.type === 'code') {
            out[q.id] = { codeAnswer: typeof source?.codeAnswer === 'string' ? source.codeAnswer : (q.starterCode || '') };
        } else {
            out[q.id] = { textAnswer: typeof source?.textAnswer === 'string' ? source.textAnswer : '' };
        }
    }
    return out;
};

const isQuestionAnswered = (q, answer) => {
    if (!answer) return false;
    if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
        return Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.length > 0;
    }
    if (q.type === 'code') {
        const code = String(answer.codeAnswer || '').trim();
        return Boolean(code) && code !== String(q.starterCode || '').trim();
    }
    return Boolean(String(answer.textAnswer || '').trim());
};

function CodeAnswerEditor({ question, value, onChange, readOnly }) {
    const lineCount = Math.max(6, String(value || '').split('\n').length);
    const gutter = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');

    const handleKeyDown = (e) => {
        if (readOnly || e.key !== 'Tab') return;
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const nextVal = `${value.slice(0, start)}  ${value.slice(end)}`;
        onChange(nextVal);
        requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = start + 2;
        });
    };

    return (
        <div className="jf-code-wrap">
            <div className="jf-code-bar">
                <span>Trình soạn thảo {CODE_LANGUAGE_LABELS[question.language] || question.language || 'Code'}</span>
                {!readOnly && question.starterCode && (
                    <button
                        type="button"
                        className="jf-test-btn"
                        style={{ padding: '3px 10px', fontSize: 12 }}
                        onClick={() => onChange(question.starterCode || '')}
                    >
                        Khôi phục khung mẫu
                    </button>
                )}
            </div>
            {readOnly ? (
                <div className="jf-code-body">
                    <div className="jf-code-gutter" aria-hidden="true">{gutter}</div>
                    <pre className="jf-code-pre" style={{ flex: 1 }}>{value || '(Không có nội dung code)'}</pre>
                </div>
            ) : (
                <div className="jf-code-body">
                    <div className="jf-code-gutter" aria-hidden="true">{gutter}</div>
                    <textarea
                        className="jf-code-input"
                        aria-label={`Code editor cho ${question.id}`}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        spellCheck={false}
                        placeholder="// Nhập mã nguồn hoặc truy vấn của bạn tại đây..."
                    />
                </div>
            )}
        </div>
    );
}

export default function CandidateAssessmentRunner() {
    const { applicationId } = useParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [envelope, setEnvelope] = useState(null);
    const [answers, setAnswers] = useState({});
    const [secondsLeft, setSecondsLeft] = useState(null);
    const [busy, setBusy] = useState(false);
    const [confirmIncomplete, setConfirmIncomplete] = useState(false);

    const loadAssessment = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await getMyAssessment(applicationId);
            if (res?.errCode !== 0 || !res?.data) {
                setError(res?.errMessage || 'Không tìm thấy bài test cho hồ sơ này.');
                return;
            }
            setEnvelope(res.data);
            const assessment = res.data.assessment;
            if (assessment) {
                const draft = assessment.status === 'IN_PROGRESS' ? readDraft(applicationId) : null;
                setAnswers(buildInitialAnswers(assessment.questions || [], assessment.answers, draft));
                setSecondsLeft(
                    assessment.status === 'IN_PROGRESS' && assessment.timeLimitSeconds
                        ? assessment.remainingSeconds
                        : null
                );
            }
        } catch (err) {
            setError(err?.message || 'Chưa tải được bài test.');
        } finally {
            setLoading(false);
        }
    }, [applicationId]);

    useEffect(() => {
        loadAssessment();
    }, [loadAssessment]);

    const assessment = envelope?.assessment || null;

    const hasTimer = assessment?.status === 'IN_PROGRESS' && secondsLeft !== null;

    useEffect(() => {
        if (!hasTimer) return undefined;
        const timer = setInterval(() => {
            setSecondsLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [hasTimer]);

    useEffect(() => {
        if (assessment?.status === 'IN_PROGRESS') {
            writeDraft(applicationId, answers);
        }
    }, [answers, applicationId, assessment?.status]);

    const questions = useMemo(() => assessment?.questions || [], [assessment]);

    const handleStart = async () => {
        setBusy(true);
        try {
            const res = await startMyAssessment(applicationId);
            if (res?.errCode === 0 && res?.data) {
                setEnvelope(res.data);
                const started = res.data.assessment;
                setAnswers(buildInitialAnswers(started?.questions || [], started?.answers, readDraft(applicationId)));
                setSecondsLeft(started?.timeLimitSeconds ? started.remainingSeconds : null);
                toast.success('Đã bắt đầu tính giờ làm bài test!');
            } else {
                toast.error(res?.errMessage || 'Không khởi tạo được phiên làm bài');
            }
        } finally {
            setBusy(false);
        }
    };

    const updateAnswer = (questionId, patch) => {
        setConfirmIncomplete(false);
        setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...patch } }));
    };

    const toggleOption = (q, optId) => {
        if (q.type === 'mcq_single') {
            updateAnswer(q.id, { selectedOptionIds: [optId] });
            return;
        }
        const current = new Set(answers[q.id]?.selectedOptionIds || []);
        if (current.has(optId)) current.delete(optId);
        else current.add(optId);
        updateAnswer(q.id, { selectedOptionIds: Array.from(current) });
    };

    const submitFinal = async (force = false) => {
        const unanswered = questions.filter((q) => !isQuestionAnswered(q, answers[q.id]));
        if (!force && unanswered.length > 0 && !confirmIncomplete) {
            setConfirmIncomplete(true);
            return;
        }
        setBusy(true);
        try {
            const res = await submitMyAssessment(applicationId, questions, answers);
            if (res?.errCode === 0 && res?.data) {
                clearDraft(applicationId);
                setEnvelope(res.data);
                setConfirmIncomplete(false);
                toast.success(res.errMessage || 'Đã nộp bài test thành công!');
            } else {
                toast.error(res?.errMessage || 'Không nộp được bài test');
            }
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return <div className="jf-runner-page"><div className="jf-runner-hero">Đang tải bài kiểm tra chuyên sâu...</div></div>;
    }

    if (error) {
        return (
            <div className="jf-runner-page">
                <div className="jf-runner-hero">
                    <div className="jf-error-banner">{error}</div>
                    <Link className="jf-test-btn" to="/candidate/cv-post">Quay lại lịch sử ứng tuyển</Link>
                </div>
            </div>
        );
    }

    if (!assessment) {
        return (
            <div className="jf-runner-page">
                <div className="jf-runner-hero">
                    <h3>{envelope?.jobTitle || 'Bài test ứng viên'}</h3>
                    <p>Nhà tuyển dụng chưa tạo hoặc giao bài test cho hồ sơ này.</p>
                    <Link className="jf-test-btn" to="/candidate/cv-post">Quay lại lịch sử ứng tuyển</Link>
                </div>
            </div>
        );
    }

    const isInProgress = assessment.status === 'IN_PROGRESS';
    const isSubmitted = assessment.status === 'SUBMITTED';
    const isGraded = assessment.status === 'GRADED';
    const gradeFeedbackMap = new Map((assessment.gradingFeedback?.perQuestion || []).map((item) => [item.questionId, item]));
    const unansweredCount = questions.filter((q) => !isQuestionAnswered(q, answers[q.id])).length;

    return (
        <div className="jf-runner-page">
            <div className="jf-runner-hero">
                <div className="jf-test-header" style={{ marginBottom: 10 }}>
                    <div>
                        <div className="jf-test-title-row">
                            <span className="jf-test-pill">{assessment.domainLabel}</span>
                            <span className={`jf-test-pill ${ASSESSMENT_STATUS_META[assessment.status]?.tone || 'info'}`}>
                                {ASSESSMENT_STATUS_META[assessment.status]?.label || assessment.status}
                            </span>
                        </div>
                        <h2 style={{ margin: '8px 0 4px', fontSize: 20 }}>{assessment.title}</h2>
                        <div className="jf-test-sub">Vị trí ứng tuyển: <strong>{envelope?.jobTitle}</strong></div>
                    </div>

                    {isInProgress && secondsLeft !== null && (
                        <div className={`jf-timer ${secondsLeft <= 300 ? 'urgent' : ''}`}>
                            {secondsLeft === 0 ? 'Đã hết giờ quy định' : `Còn lại: ${formatCountdown(secondsLeft)}`}
                        </div>
                    )}
                </div>

                {assessment.description && <p style={{ fontSize: 14, color: '#334155', margin: '6px 0' }}>{assessment.description}</p>}
                {assessment.instructions && <p style={{ fontSize: 13.5, color: '#475569', margin: '4px 0' }}>{assessment.instructions}</p>}

                {assessment.status === 'ASSIGNED' && (
                    <div className="jf-test-actions" style={{ marginTop: 14 }}>
                        <div className="jf-test-pill info">
                            {questions.length} câu hỏi · {assessment.timeLimitMinutes ? `${assessment.timeLimitMinutes} phút` : 'Không giới hạn thời gian'} · Tổng {assessment.maxScore} điểm
                        </div>
                        <button type="button" className="jf-test-btn primary" onClick={handleStart} disabled={busy}>
                            {busy ? 'Đang mở đề...' : 'Bắt đầu làm bài test'}
                        </button>
                        <Link className="jf-test-btn" to="/candidate/cv-post">Quay lại</Link>
                    </div>
                )}

                {isSubmitted && (
                    <div className="jf-test-lock" style={{ marginTop: 12 }}>
                        Bạn đã hoàn tất nộp bài test. Nhà tuyển dụng hoặc hệ thống AI đang chấm điểm và sẽ cập nhật kết quả tại đây.
                        <div style={{ marginTop: 8 }}>
                            <Link className="jf-test-btn" to="/candidate/cv-post">Quay lại lịch sử ứng tuyển</Link>
                        </div>
                    </div>
                )}

                {isGraded && (
                    <div className="jf-grade-summary" style={{ marginTop: 12, marginBottom: 0 }}>
                        <div className="jf-test-title-row">
                            <strong style={{ fontSize: 18 }}>
                                Kết quả: {assessment.totalScore}/10 ({assessment.earnedPoints}/{assessment.maxScore}đ)
                            </strong>
                            <span className="jf-test-pill info">
                                {assessment.gradingMode === 'AI' ? 'Chấm bởi AI' : 'Chấm bởi Nhà tuyển dụng'}
                            </span>
                            {assessment.gradingFeedback?.recommendation && (
                                <span className={`jf-test-pill ${RECOMMENDATION_META[assessment.gradingFeedback.recommendation]?.tone || 'info'}`}>
                                    {RECOMMENDATION_META[assessment.gradingFeedback.recommendation]?.label}
                                </span>
                            )}
                        </div>
                        {assessment.gradingFeedback?.overallFeedback && (
                            <p style={{ margin: '8px 0 0', fontSize: 14 }}>{assessment.gradingFeedback.overallFeedback}</p>
                        )}
                        <div style={{ marginTop: 10 }}>
                            <Link className="jf-test-btn" to="/candidate/cv-post">Quay lại lịch sử ứng tuyển</Link>
                        </div>
                    </div>
                )}
            </div>

            {assessment.status !== 'ASSIGNED' && (
                <div>
                    {questions.map((q, idx) => {
                        const ans = answers[q.id] || {};
                        const feedback = gradeFeedbackMap.get(q.id);
                        return (
                            <div key={q.id} className="jf-q-card">
                                <div className="jf-q-card-head">
                                    <span className="jf-q-index">Câu {idx + 1} · {QUESTION_TYPE_LABELS[q.type]}</span>
                                    <div className="jf-test-title-row">
                                        {isGraded && feedback && (
                                            <span className={`jf-test-pill ${feedback.passed ? 'success' : 'warn'}`}>
                                                {feedback.earnedPoints}/{q.points}đ
                                            </span>
                                        )}
                                        {!isGraded && <span className="jf-test-pill">{q.points} điểm</span>}
                                    </div>
                                </div>

                                <div className="jf-q-prompt">{q.prompt}</div>

                                {(q.type === 'mcq_single' || q.type === 'mcq_multi') && (
                                    <div className="jf-option-list">
                                        {(q.options || []).map((opt) => {
                                            const selected = (ans.selectedOptionIds || []).includes(opt.id);
                                            const isRight = isGraded && (q.correctOptionIds || []).includes(opt.id);
                                            const cls = isGraded
                                                ? (isRight ? 'correct' : selected ? 'wrong' : '')
                                                : (selected ? 'selected' : '');
                                            return (
                                                <label key={opt.id} className={`jf-option-row ${!isInProgress ? 'is-readonly' : ''} ${cls}`.trim()}>
                                                    <div className="jf-option-main">
                                                        <input
                                                            type={q.type === 'mcq_single' ? 'radio' : 'checkbox'}
                                                            name={`cand-${q.id}`}
                                                            checked={selected}
                                                            disabled={!isInProgress}
                                                            onChange={() => toggleOption(q, opt.id)}
                                                        />
                                                        <span className="jf-option-letter">{opt.id}</span>
                                                        <span className="jf-option-text">{opt.text}</span>
                                                    </div>
                                                    {isGraded && (selected || isRight) && (
                                                        <div className="jf-option-badges">
                                                            {selected && (
                                                                <span className={`jf-test-pill ${isRight ? 'info' : 'danger'}`}>
                                                                    {isRight ? '✓ Bạn đã chọn' : '✗ Bạn chọn sai'}
                                                                </span>
                                                            )}
                                                            {isRight && <span className="jf-test-pill success">✓ Đáp án đúng</span>}
                                                        </div>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}

                                {q.type === 'code' && (
                                    <CodeAnswerEditor
                                        question={q}
                                        value={ans.codeAnswer ?? ''}
                                        readOnly={!isInProgress}
                                        onChange={(codeAnswer) => updateAnswer(q.id, { codeAnswer })}
                                    />
                                )}

                                {q.type === 'text' && (
                                    <div>
                                        <textarea
                                            className="jf-test-textarea"
                                            aria-label={`Câu trả lời tự luận câu ${idx + 1}`}
                                            value={ans.textAnswer ?? ''}
                                            readOnly={!isInProgress}
                                            maxLength={q.maxLength || 8000}
                                            placeholder={q.placeholder || 'Nhập câu trả lời chi tiết của bạn...'}
                                            onChange={(e) => updateAnswer(q.id, { textAnswer: e.target.value })}
                                            style={{ minHeight: 120 }}
                                        />
                                        <div style={{ textAlign: 'right', fontSize: 12, color: '#64748b', marginTop: 4 }}>
                                            {(ans.textAnswer || '').length}/{q.maxLength || 8000} ký tự
                                        </div>
                                    </div>
                                )}

                                {isGraded && (feedback?.comment || q.explanation) && (
                                    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#f8fafc', fontSize: 13 }}>
                                        {feedback?.comment && <div><strong>Nhận xét:</strong> {feedback.comment}</div>}
                                        {q.explanation && <div style={{ marginTop: 4 }}><strong>Giải thích đáp án:</strong> {q.explanation}</div>}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {isInProgress && (
                        <div className="jf-runner-hero">
                            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 13.5, color: '#334155' }}>
                                    Đã trả lời <strong>{questions.length - unansweredCount}/{questions.length}</strong> câu hỏi.
                                </span>
                                <button type="button" className="jf-test-btn primary" onClick={() => submitFinal(false)} disabled={busy}>
                                    {busy ? 'Đang nộp bài...' : 'Nộp bài test'}
                                </button>
                            </div>
                            {confirmIncomplete && (
                                <div className="jf-confirm-box">
                                    Còn <strong>{unansweredCount}</strong> câu chưa điền hoặc chưa thay đổi code mẫu. Bạn vẫn muốn nộp bài ngay?
                                    <div className="jf-test-actions">
                                        <button type="button" className="jf-test-btn primary" onClick={() => submitFinal(true)} disabled={busy}>
                                            Xác nhận nộp bài
                                        </button>
                                        <button type="button" className="jf-test-btn" onClick={() => setConfirmIncomplete(false)}>
                                            Kiểm tra lại
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
