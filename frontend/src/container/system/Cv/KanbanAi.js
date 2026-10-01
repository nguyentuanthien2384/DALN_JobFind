import React, { useCallback, useEffect, useRef, useState } from "react";
import { getJobScreenings, screenApplicationAi, candidateMessageAi } from "../../../service/aiSearchService";
import { submitAiTask, requestAiDraft, validateScreening, verdictInfo, aiErrorMessage } from "../../../service/aiAssist";

// AI trong bang Kanban: cham CV da nop so voi tin tuyen dung va soan loi nhan
// email. Ket qua chi de nha tuyen dung tham khao; khong tu chuyen buoc hay gui thu.

const POLL_MS = 4000;
const STALE_MS = 10 * 60 * 1000;
const MAX_JOBS = 30;
const pendingFresh = (item) => item?.status === "pending" && Date.now() - new Date(item.createdAt).getTime() < STALE_MS;
const validId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
// No result yet, a failed attempt, or a request that never finished.
export const needsScreening = (item) => !item || item.status === "failed" || (item.status === "pending" && !pendingFresh(item));

const normalize = (row, jobId) => {
    if (!validId(row?.cvId) || !["pending", "done", "failed"].includes(row.status)) return null;
    let result = null;
    if (row.status === "done") {
        try { result = validateScreening({ matchedSkills: [], missingSkills: [], strengths: [], concerns: [], ...row }); }
        catch { return { cvId: Number(row.cvId), jobId, status: "failed", createdAt: row.createdAt, error: "Kết quả AI không hợp lệ", result: null }; }
    }
    return { cvId: Number(row.cvId), jobId, status: row.status, createdAt: row.createdAt, error: row.error || null, result };
};

// Ket qua AI moi nhat theo legacy_cv_id cho cac tin dang hien tren bang.
export function useScreenings() {
    const [byCv, setByCv] = useState({});
    const mounted = useRef(true);
    // StrictMode mounts twice in development: re-arm on every mount.
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const refresh = useCallback(async (jobIds) => {
        const ids = [...new Set(jobIds.filter(validId).map(Number))].slice(0, MAX_JOBS);
        if (!ids.length) return;
        const responses = await Promise.allSettled(ids.map((jobId) => getJobScreenings(jobId)));
        if (!mounted.current) return;
        setByCv((previous) => {
            const next = { ...previous };
            responses.forEach((outcome, index) => {
                const response = outcome.status === "fulfilled" ? outcome.value : null;
                if (response?.errCode !== 0 || !Array.isArray(response.data)) return;
                for (const row of response.data) {
                    const item = normalize(row, ids[index]);
                    // Keep a just-submitted local pending entry until the server lists it.
                    if (item) next[item.cvId] = item;
                }
            });
            return next;
        });
    }, []);

    const markPending = useCallback((cvId, jobId) => setByCv((previous) => ({
        ...previous, [cvId]: { cvId: Number(cvId), jobId: Number(jobId), status: "pending", createdAt: new Date().toISOString(), error: null, result: null }
    })), []);
    const markFailed = useCallback((cvId, jobId, error) => setByCv((previous) => ({
        ...previous, [cvId]: { cvId: Number(cvId), jobId: Number(jobId), status: "failed", createdAt: new Date().toISOString(), error, result: null }
    })), []);

    // One list request per job with pending work, instead of one poll per CV.
    useEffect(() => {
        const pendingJobs = [...new Set(Object.values(byCv).filter(pendingFresh).map((item) => item.jobId))];
        if (!pendingJobs.length) return undefined;
        const timer = setTimeout(() => { refresh(pendingJobs).catch(() => {}); }, POLL_MS);
        return () => clearTimeout(timer);
    }, [byCv, refresh]);

    const screen = useCallback(async (cvId, jobId) => {
        await submitAiTask((options) => screenApplicationAi(cvId, options));
        markPending(cvId, jobId);
    }, [markPending]);

    return { byCv, refresh, screen, markFailed };
}

export function ScreeningBadge({ item }) {
    if (!item) return null;
    if (item.status === "pending") return <span className={`kb-ai-badge pending`} title="AI đang chấm hồ sơ">{pendingFresh(item) ? "AI đang chấm…" : "AI chưa có kết quả"}</span>;
    if (item.status === "failed" || !item.result) return <span className="kb-ai-badge failed" title={item.error || "AI chưa chấm được"}>AI lỗi</span>;
    const [label, tone] = verdictInfo(item.result);
    return <span className={`kb-ai-badge ${tone}`} title={`AI: ${label}`}>AI {item.result.score}</span>;
}

const groups = { matchedSkills: "Kỹ năng phù hợp", missingSkills: "Chưa thấy bằng chứng trong CV", strengths: "Điểm mạnh", concerns: "Cần trao đổi thêm" };

export function ScreeningPanel({ detail, item, onScreen }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState("");
    const cvId = detail.legacy_cv_id;
    useEffect(() => { setBusy(false); setError(""); }, [cvId]);
    const run = async () => {
        if (busy || !cvId) return;
        if (item?.status === "done" && !window.confirm("Chấm lại hồ sơ này bằng AI? Mỗi lần chấm là một lượt gọi AI.")) return;
        setBusy(true); setError("");
        try { await onScreen(cvId, detail.job_id); }
        catch (failure) { setError(aiErrorMessage(failure)); }
        finally { setBusy(false); }
    };
    const pending = pendingFresh(item);
    const result = item?.status === "done" ? item.result : null;
    const [verdictLabel, tone] = result ? verdictInfo(result) : [];
    return <div className="kb-section kb-ai-panel">
        <h5><span className="kb-ai-tag">AI</span> Đánh giá CV so với tin tuyển dụng</h5>
        <p className="kb-hint">AI đọc file CV ứng viên đã nộp và đối chiếu với yêu cầu của tin. Kết quả chỉ để tham khảo, không tự loại ứng viên.</p>
        {!cvId ? <p className="kb-hint">Hồ sơ này không gắn file CV đã nộp nên AI chưa chấm được.</p> : <>
            {result && <div className="kb-ai-result">
                <div className={`kb-ai-score ${tone}`}><strong>{result.score}</strong><span>/100 · {verdictLabel}</span></div>
                {result.summary && <p>{result.summary}</p>}
                <div className="kb-ai-groups">{Object.entries(groups).map(([field, label]) => result[field].length > 0 && <div key={field}>
                    <h6>{label}</h6><ul>{result[field].map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}</div>
            </div>}
            {item?.status === "failed" && <p role="alert" className="kb-ai-error">AI chưa chấm được: {item.error || "lỗi không xác định"}</p>}
            {pending && <p role="status" className="kb-hint">AI đang đọc CV và chấm điểm… kết quả tự cập nhật.</p>}
            {item?.status === "pending" && !pending && <p className="kb-hint">Yêu cầu trước chưa có kết quả sau 10 phút. Bạn có thể chấm lại.</p>}
            {error && <p role="alert" className="kb-ai-error">{error}</p>}
            {!pending && <button type="button" className="kb-btn ai" disabled={busy} onClick={run}>
                {busy ? "Đang gửi…" : result ? "Chấm lại bằng AI" : "Phân tích CV bằng AI"}</button>}
        </>}
    </div>;
}

const EMAIL_TYPES = [["interview", "Mời phỏng vấn"], ["offer", "Trúng tuyển / mời nhận việc"], ["rejection", "Không trúng tuyển"]];

// Soan loi nhan them cho email; noi dung nha tuyen dung dang go duoc dung lam y chinh.
export function AiMessageDraft({ detail, composer, notes, interviewed, disabled, onUse }) {
    const [emailType, setEmailType] = useState(composer === "offer" ? "offer" : composer === "interview" ? "interview" : "rejection");
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [draft, setDraft] = useState("");
    const operation = useRef(null);
    useEffect(() => { if (composer) setEmailType(composer === "offer" ? "offer" : "interview"); }, [composer]);
    useEffect(() => () => operation.current?.abort(), []);
    const run = async () => {
        if (busy || !validId(detail.job_id)) return;
        const controller = new AbortController();
        operation.current = controller;
        setBusy(true); setError(""); setDraft("");
        try {
            const [text] = await requestAiDraft((options) => candidateMessageAi({
                jobId: detail.job_id, emailType, candidateName: detail.candidate_name,
                recruiterNotes: notes.trim().slice(0, 2000) || undefined, interviewed
            }, options), 3000, { signal: controller.signal });
            if (!controller.signal.aborted) setDraft(text);
        } catch (failure) { if (!controller.signal.aborted) setError(aiErrorMessage(failure)); }
        finally { if (operation.current === controller) { operation.current = null; setBusy(false); } }
    };
    return <div className="kb-ai-draft">
        <div className="kb-ai-draft-row">
            <span className="kb-ai-tag">AI</span>
            <select aria-label="Loại thư cần soạn" value={emailType} disabled={busy || disabled} onChange={(event) => setEmailType(event.target.value)}>
                {EMAIL_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="kb-btn ai" disabled={busy || disabled || !validId(detail.job_id)} onClick={run}>
                {busy ? "AI đang soạn…" : "AI soạn lời nhắn"}</button>
            {busy && <button type="button" className="kb-btn ghost" onClick={() => { operation.current?.abort(); operation.current = null; setBusy(false); }}>Dừng</button>}
        </div>
        <p className="kb-hint">Gõ vài ý chính vào ô lời nhắn (không bắt buộc), AI sẽ viết thành đoạn hoàn chỉnh. Bạn xem lại trước khi gửi.</p>
        {error && <p role="alert" className="kb-ai-error">{error}</p>}
        {draft && <div className="kb-ai-suggestion" aria-label="Lời nhắn AI gợi ý">
            <p>{draft}</p>
            <div><button type="button" className="kb-btn success" disabled={disabled} onClick={() => { onUse(draft); setDraft(""); }}>Dùng nội dung này</button>
                <button type="button" className="kb-btn ghost" onClick={() => setDraft("")}>Bỏ qua</button></div>
        </div>}
    </div>;
}
