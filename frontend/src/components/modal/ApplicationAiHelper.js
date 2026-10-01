import React, { useEffect, useRef, useState } from 'react';
import { applicationIntroAi, matchCvPdfAi } from '../../service/aiSearchService';
import { requestAiDraft, submitAiTask, waitAiTask, validateScreening, verdictInfo, aiErrorMessage } from '../../service/aiAssist';

// Tro ly AI trong form nop ho so: viet loi gioi thieu tu CV dang chon va cho ung
// vien xem muc do phu hop truoc khi gui. Khong tu dien hay tu nop ho so.
export default function ApplicationAiHelper({ source, postId, disabled, onUseIntro }) {
    const [busy, setBusy] = useState(''), [error, setError] = useState('');
    const [intros, setIntros] = useState([]), [match, setMatch] = useState(null);
    const operation = useRef(null), mounted = useRef(true);
    const fileBase64 = typeof source === 'string' && source.startsWith('data:application/pdf;base64,') ? source.split(',')[1] : '';

    // StrictMode mounts twice in development: re-arm on every mount.
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
    // A different CV makes earlier drafts and scores misleading.
    useEffect(() => {
        operation.current?.abort();
        setIntros([]); setMatch(null); setError(''); setBusy('');
    }, [fileBase64]);

    const run = async (kind, work) => {
        if (operation.current || !fileBase64) return;
        const controller = new AbortController();
        operation.current = controller;
        setBusy(kind); setError('');
        try { await work(controller.signal); }
        catch (failure) { if (mounted.current && !controller.signal.aborted) setError(aiErrorMessage(failure)); }
        finally {
            if (operation.current === controller) operation.current = null;
            if (mounted.current && !controller.signal.aborted) setBusy('');
        }
    };
    const writeIntro = () => run('intro', async signal => {
        const suggestions = await requestAiDraft(options => applicationIntroAi(fileBase64, postId, 'vi', options), 255, { signal });
        if (mounted.current && !signal.aborted) setIntros(suggestions);
    });
    const checkFit = () => run('match', async signal => {
        const taskId = await submitAiTask(options => matchCvPdfAi(fileBase64, Number(postId), options), { signal });
        const result = validateScreening(await waitAiTask(taskId, 'match_cv', { signal }));
        if (mounted.current && !signal.aborted) setMatch(result);
    });
    const stop = () => { operation.current?.abort(); operation.current = null; setBusy(''); };

    return <section className="apply-ai" aria-label="Trợ lý AI ứng tuyển">
        <div className="apply-ai-head"><span className="apply-ai-badge">AI</span><div>
            <strong>Trợ lý AI ứng tuyển</strong>
            <p>Khi bạn bấm, CV đang chọn được gửi tới dịch vụ AI để gợi ý. Bạn tự kiểm tra và quyết định nội dung gửi nhà tuyển dụng.</p>
        </div></div>
        {!fileBase64 && <p className="apply-ai-hint">Chọn CV ở bên dưới để dùng trợ lý AI.</p>}
        <div className="apply-ai-actions">
            <button type="button" onClick={writeIntro} disabled={disabled || !fileBase64 || Boolean(busy)}>
                {busy === 'intro' ? 'AI đang viết…' : 'Viết lời giới thiệu bằng AI'}</button>
            <button type="button" onClick={checkFit} disabled={disabled || !fileBase64 || Boolean(busy)}>
                {busy === 'match' ? 'AI đang đánh giá…' : 'Kiểm tra độ phù hợp'}</button>
            {busy && <button type="button" className="apply-ai-stop" onClick={stop}>Dừng chờ</button>}
        </div>
        {error && <p role="alert" className="apply-ai-error">{error}</p>}
        {intros.length > 0 && <div className="apply-ai-options" aria-label="Lời giới thiệu AI gợi ý">
            {intros.map((text, index) => <div className="apply-ai-option" key={index}>
                <p>{text}</p>
                <button type="button" disabled={disabled} onClick={() => onUseIntro(text)}>Dùng lời giới thiệu này</button>
            </div>)}
        </div>}
        {match && <div className="apply-ai-match" aria-label="Đánh giá độ phù hợp">
            <div className="apply-ai-score"><strong>{match.score}/100</strong><span>{verdictInfo(match)[0]}</span></div>
            {match.summary && <p>{match.summary}</p>}
            {match.matchedSkills.length > 0 && <p><b>Điểm khớp:</b> {match.matchedSkills.join(', ')}</p>}
            {match.missingSkills.length > 0 && <p><b>Chưa thấy trong CV:</b> {match.missingSkills.join(', ')}</p>}
            <small>Điểm AI chỉ để tham khảo; nhà tuyển dụng đánh giá hồ sơ theo cách riêng.</small>
        </div>}
    </section>;
}
