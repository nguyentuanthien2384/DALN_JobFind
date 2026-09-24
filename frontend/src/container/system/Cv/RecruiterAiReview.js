import React, { useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import { getCandidateSearchJobs } from '../../../service/cvService';
import { SESSION_ENDED_EVENT } from '../../../auth/sessionExpiry';
import { recruiterIntentKey, readRecruiterIntent, saveRecruiterIntent, clearRecruiterIntent,
    prepareRecruiterReview, submitRecruiterReview, acceptRecruiterReview, waitRecruiterReview } from '../../../service/recruiterAi';
import './RecruiterAiReview.css';

const groups = { matchedSkills: 'Kỹ năng phù hợp', missingSkills: 'Chưa thấy bằng chứng trong CV', strengths: 'Điểm mạnh', concerns: 'Nội dung cần trao đổi thêm' };
const message = error => error?.message || 'Không thể phân tích CV. Vui lòng thử lại.';

// Mount only after profile access has been granted. A new source/session gets a new workspace.
export default function RecruiterAiReview({ source, candidateId, token, sessionUser }) {
    const [user] = useState(() => { try { return JSON.parse(sessionUser) || {}; } catch { return {}; } });
    const storageKey = recruiterIntentKey(user.id, candidateId);
    const [jobId, setJobId] = useState(() => {
        const value = new URLSearchParams(window.location.search).get('jobId');
        return /^[1-9][0-9]*$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
    });
    const [jobs, setJobs] = useState([]), [search, setSearch] = useState('');
    const [jobLoading, setJobLoading] = useState(false), [jobError, setJobError] = useState('');
    const [jobRetry, setJobRetry] = useState(0);
    const [intent, setIntent] = useState(null), [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false), [terminal, setTerminal] = useState(false);
    const [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [storageError, setStorageError] = useState(false), [ended, setEnded] = useState(false);
    const mounted = useRef(false), sessionEnded = useRef(false), operation = useRef(null);
    const current = () => mounted.current && !sessionEnded.current && localStorage.getItem('token_user') === token
        && localStorage.getItem('userData') === sessionUser;

    useEffect(() => {
        mounted.current = true;
        if (window.location.hash === '#ai-review') document.getElementById('ai-review')?.scrollIntoView?.({ block: 'start' });
        try {
            const saved = readRecruiterIntent(storageKey);
            setIntent(saved);
            if (saved) { setJobId(saved.jobId); setNotice('Có yêu cầu đã gửi cho ứng viên này. Kiểm tra lại để nhận kết quả, không tạo thêm lượt phân tích.'); }
        } catch (failure) { setStorageError(true); setError(message(failure)); }
        const end = () => { sessionEnded.current = true; operation.current?.abort(); setEnded(true); setResult(null); };
        const storage = event => { if (event.key === null || ['token_user', 'userData'].includes(event.key)) end(); };
        window.addEventListener(SESSION_ENDED_EVENT, end);
        window.addEventListener('storage', storage);
        return () => {
            mounted.current = false; operation.current?.abort();
            window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', storage);
        };
    }, [storageKey]);

    useEffect(() => {
        if (!user.companyId || ended) return undefined;
        let active = true;
        setJobLoading(true); setJobError('');
        const timer = setTimeout(async () => {
            try {
                const response = await getCandidateSearchJobs({ search });
                if (response?.errCode !== 0 || !Array.isArray(response.data)) throw new Error();
                if (active) setJobs(response.data);
            } catch { if (active) setJobError('Chưa tải được tin tuyển dụng của công ty.'); }
            finally { if (active) setJobLoading(false); }
        }, 250);
        return () => { active = false; clearTimeout(timer); };
    }, [search, user.companyId, ended, jobRetry]);

    const run = async () => {
        if (!current() || operation.current || (storageError && !intent?.taskId) || terminal || !user.id || !user.companyId) return;
        const controller = new AbortController(); operation.current = controller;
        setBusy(true); setError(''); setResult(null);
        try {
            let accepted = intent;
            if (!accepted?.taskId) {
                setNotice('Đang đọc tệp CV hiện tại…');
                const prepared = await prepareRecruiterReview(source, jobId, storageKey, controller.signal);
                if (!current()) return;
                if (controller.signal.aborted) { setNotice('Đã dừng đọc CV. Chưa gửi yêu cầu phân tích.'); return; }
                saveRecruiterIntent(storageKey, prepared.intent); setIntent(prepared.intent);
                setNotice('Đang gửi yêu cầu phân tích…');
                const response = await submitRecruiterReview(prepared.payload, prepared.intent, controller.signal);
                if (!current()) return;
                if ([400, 404, 413, 415, 422].includes(response?.httpStatus || response?.errCode)) setTerminal(true);
                accepted = acceptRecruiterReview(response, prepared.intent); setIntent(accepted);
                try { saveRecruiterIntent(storageKey, accepted); }
                catch { setStorageError(true); setError('Không lưu được mã phân tích. Giữ trang này để xem kết quả.'); }
            }
            if (controller.signal.aborted) { setNotice('Đã dừng chờ. Bạn có thể kiểm tra lại yêu cầu hiện tại.'); return; }
            setNotice('AI đang đối chiếu nội dung PDF với tin tuyển dụng…');
            const output = await waitRecruiterReview(accepted, controller.signal, () => { if (current()) setTerminal(true); });
            if (current()) { setResult(output); setNotice('Phân tích hoàn tất. Nhà tuyển dụng cần kiểm tra CV và xác minh nhận xét.'); }
        } catch (failure) {
            if (!current()) return;
            if (failure.code === 'AI_TASK_FAILED') setTerminal(true);
            if (controller.signal.aborted || failure.code === 'AI_POLL_CANCELLED') {
                setNotice('Đã dừng chờ. Tác vụ đã gửi vẫn có thể tiếp tục; kiểm tra lại sẽ dùng cùng yêu cầu.');
            } else { setNotice(''); setError(message(failure)); }
        } finally {
            if (operation.current === controller) operation.current = null;
            if (current()) setBusy(false);
        }
    };
    const reset = () => {
        if (!current() || busy || !terminal || storageError) return;
        try {
            clearRecruiterIntent(storageKey, intent.key);
            setIntent(null); setResult(null); setTerminal(false); setNotice(''); setError('');
        } catch (failure) { setError(message(failure)); }
    };

    if (ended) return null;
    const options = [...new Map([...(jobId ? [{ id: jobId, name: `Tin tuyển dụng #${jobId}` }] : []), ...jobs].map(job => [job.id, job])).values()]
        .map(job => ({ value: job.id, label: `#${job.id} · ${job.name}` }));
    return <section className="recruiter-ai" id="ai-review" aria-label="Phân tích CV bằng AI">
        <div className="recruiter-ai-heading"><span className="recruiter-ai-badge">AI</span><div><h2>Đối chiếu nội dung CV</h2>
            <p>Phân tích PDF hiện tại với yêu cầu trong tin tuyển dụng của công ty.</p></div></div>
        <p className="recruiter-ai-context">AI đưa ra thông tin tham khảo dựa trên bằng chứng trong CV. Người tuyển dụng kiểm tra và quyết định; hệ thống không tự loại ứng viên.</p>
        {!user.companyId ? <p>Bạn cần tài khoản thuộc công ty để chọn tin và phân tích CV.</p> : <>
            <label htmlFor="recruiter-ai-job">Tin tuyển dụng để đối chiếu</label>
            <Select id="recruiter-ai-job" aria-label="Tin tuyển dụng để đối chiếu" showSearch filterOption={false}
                placeholder="Tìm và chọn tin tuyển dụng của công ty" loading={jobLoading} value={jobId} options={options}
                onSearch={setSearch} onChange={setJobId} disabled={busy || Boolean(intent)}
                notFoundContent={jobLoading ? 'Đang tải tin…' : 'Không có tin phù hợp'} />
            {jobError && <p role="status">{jobError} <button type="button" onClick={() => setJobRetry(value => value + 1)}>Tải lại danh sách tin</button></p>}
            {!source && <p>Ứng viên chưa có CV PDF để phân tích.</p>}
            <div className="recruiter-ai-actions">
                {!terminal && <button type="button" className="recruiter-ai-primary" onClick={run}
                    disabled={busy || (storageError && !intent?.taskId) || !jobId || (!source && !intent?.taskId) || !user.id}>
                    {busy ? 'Đang phân tích…' : intent?.taskId ? 'Kiểm tra kết quả AI' : intent ? 'Đối chiếu yêu cầu đã gửi' : 'Phân tích CV bằng AI'}
                </button>}
                {busy && <button type="button" onClick={() => operation.current?.abort()}>Dừng chờ</button>}
                {terminal && <button type="button" disabled={busy || storageError} onClick={reset}>Phân tích mới</button>}
            </div>
            {notice && <p role="status" className="recruiter-ai-notice">{notice}</p>}
            {error && <p role="alert" className="recruiter-ai-error">{error}</p>}
            {intent?.taskId && <small>Mã phân tích: {intent.taskId}</small>}
            {result && <div className="recruiter-ai-result">
                <p>Kết quả dựa trên CV và tin tuyển dụng tại thời điểm gửi. Nếu nội dung đã cập nhật, hãy tạo phân tích mới.</p>
                <div className="recruiter-ai-summary"><strong>{result.score}/100</strong><div><h3>Mức phù hợp AI tham khảo</h3><p>{result.summary}</p></div></div>
                <div className="recruiter-ai-grid">{Object.entries(groups).map(([field, label]) => <div key={field}><h3>{label}</h3>
                    {result[field].length ? <ul>{result[field].map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Chưa có nhận xét.</p>}</div>)}</div>
            </div>}
        </>}
    </section>;
}
