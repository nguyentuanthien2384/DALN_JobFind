import React, { useContext, useEffect, useRef, useState } from 'react';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { readJsonStorage } from '../../util/storage';
import { parseResumeAi, matchCvAi, coverLetterAi, getAiTask, listMyCvs, createMyCv, updateMyCv, deleteMyCv } from '../../service/aiSearchService';
import { pollAiTask } from '../../service/aiTaskPolling';
import { candidateAiEnabled, readIntent, saveIntent, clearIntent, prepareIntent, acceptTask, validateTaskResponse,
    readPdf, emptyCv, cvPayload, validateCvList, validateAiResult, cvText, mutationStorageKey } from '../../service/candidateWorkspace';
import './CandidateAi.css';

const labels = { title:'Tên CV', fullName:'Họ và tên', email:'Email', phone:'Điện thoại', address:'Địa chỉ', summary:'Giới thiệu',
    company:'Công ty', position:'Vị trí', from:'Từ', to:'Đến', description:'Mô tả', school:'Trường', major:'Chuyên ngành', degree:'Bằng cấp', year:'Năm' };
const modes = { parse_resume:'Đọc CV từ PDF', match_cv:'Đánh giá độ phù hợp', cover_letter:'Soạn thư ứng tuyển' };
const message = error => error?.message || 'Không thực hiện được thao tác. Vui lòng thử lại.';

function Workspace({ userId, token }) {
    const [enabled] = useState(candidateAiEnabled);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [intent, setIntent] = useState(null);
    const [storageError, setStorageError] = useState(false);
    const [mode, setMode] = useState('parse_resume');
    const [file, setFile] = useState(null);
    const [resumeText, setResumeText] = useState('');
    const [jobId, setJobId] = useState(() => new URLSearchParams(window.location.search).get('jobId') || '');
    const [language, setLanguage] = useState('vi');
    const [result, setResult] = useState(null);
    const [terminal, setTerminal] = useState(false);
    const [busy, setBusy] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [cvs, setCvs] = useState([]);
    const [cvLoading, setCvLoading] = useState(false);
    const [cvLoaded, setCvLoaded] = useState(false);
    const [draft, setDraft] = useState(emptyCv);
    const [cvId, setCvId] = useState(null);
    const [cvBusy, setCvBusy] = useState(false);
    const [uncertain, setUncertain] = useState(false);
    const [reconciled, setReconciled] = useState(false);
    const mounted = useRef(false), sending = useRef(false), cvSending = useRef(false), poll = useRef(null), listVersion = useRef(0);
    const current = () => mounted.current && localStorage.getItem('token_user') === token;
    const mutationKey = mutationStorageKey(userId);
    useEffect(() => {
        mounted.current = true;
        try {
            const saved = readIntent(userId); setIntent(saved);
            if (saved) setMode(saved.type);
            setUncertain(Boolean(sessionStorage.getItem(mutationStorageKey(userId))));
        } catch (failure) { setStorageError(true); setError(message(failure)); }
        return () => { mounted.current = false; poll.current?.abort(); };
    }, [userId]);

    const loadCvs = async () => {
        const version = ++listVersion.current; setCvLoading(true); setCvLoaded(false); setError('');
        try {
            const data = validateCvList(await listMyCvs());
            if (current() && version === listVersion.current) { setCvs(data); setCvLoaded(true); setReconciled(true); }
        } catch (failure) { if (current() && version === listVersion.current) { setCvs([]); setError(message(failure)); } }
        finally { if (current() && version === listVersion.current) setCvLoading(false); }
    };
    const watch = async saved => {
        if (!current() || !saved?.taskId || poll.current) return;
        const controller = new AbortController(); poll.current = controller;
        setWaiting(true); setResult(null); setError(''); setNotice('Đang chờ kết quả AI…');
        try {
            const data = await pollAiTask(async (id, options) => validateTaskResponse(await getAiTask(id, options), saved), saved.taskId,
                { signal: controller.signal });
            if (!current()) return;
            // Completion is known even if the result cannot be displayed safely.
            setTerminal(true);
            const output = validateAiResult(saved.type, data);
            setResult(output); setNotice('Đã có kết quả. Hãy kiểm tra nội dung trước khi sử dụng.');
        } catch (failure) {
            if (!current()) return;
            setNotice('');
            if (failure.code === 'AI_TASK_FAILED') setTerminal(true);
            if (failure.code === 'AI_POLL_CANCELLED') setNotice('Đã dừng chờ. Tác vụ vẫn có thể tiếp tục trên máy chủ.');
            else setError(message(failure));
        } finally { if (poll.current === controller) { poll.current = null; if (current()) setWaiting(false); } }
    };
    const submit = async () => {
        if (!current() || sending.current || storageError || intent?.taskId) return;
        // Rollback permits explicit replay of the same saved intent only.
        if (!enabled && !intent) return;
        sending.current = true; setBusy(true); setError(''); setNotice('');
        try {
            let payload;
            if (mode === 'parse_resume') payload = await readPdf(file);
            else {
                if (!resumeText.trim() || resumeText.length > 10000) throw new Error('Nhập nội dung CV, tối đa 10.000 ký tự.');
                if (!/^[1-9][0-9]*$/.test(jobId) || !Number.isSafeInteger(Number(jobId))) throw new Error('Mã công việc không hợp lệ.');
                payload = { resumeText, jobId: Number(jobId), ...(mode === 'cover_letter' && { language }) };
            }
            const saved = await prepareIntent(userId, mode, payload, enabled);
            if (!current()) return;
            saveIntent(userId, saved); setIntent(saved);
            const options = { idempotencyKey: saved.key };
            const response = mode === 'parse_resume' ? await parseResumeAi(payload.fileBase64, payload.fileName, options)
                : mode === 'match_cv' ? await matchCvAi(payload.resumeText, payload.jobId, options)
                    : await coverLetterAi(payload.resumeText, payload.jobId, payload.language, options);
            if (!current()) return;
            if ([400,404,413,415,422].includes(response?.httpStatus || response?.errCode)) {
                const rejected = { ...saved, rejected: true };
                saveIntent(userId, rejected); setIntent(rejected);
            }
            const accepted = acceptTask(response, saved);
            // Keep the received ID visible even if storage becomes unavailable.
            setIntent(accepted);
            try { saveIntent(userId, accepted); } catch { setStorageError(true); setError('Không lưu được mã tác vụ. Hãy giữ trang này để xem kết quả.'); }
            await watch(accepted);
        } catch (failure) { if (current()) setError(message(failure)); }
        finally { sending.current = false; if (current()) setBusy(false); }
    };
    const newTask = () => {
        if (!current() || !terminal || busy || waiting || !enabled) return;
        try { clearIntent(userId, intent.key); setIntent(null); setResult(null); setTerminal(false); setNotice(''); setFile(null); setError(''); }
        catch (failure) { setError(message(failure)); }
    };
    const changeDraft = (field, value) => setDraft(old => ({ ...old, [field]: value }));
    const mutateCv = async action => {
        if (!current() || !enabled || cvSending.current || uncertain || storageError || !cvLoaded) return;
        if (action === 'delete' && !window.confirm('Xóa CV đang chọn khỏi danh sách CV của bạn?')) return;
        cvSending.current = true; setCvBusy(true); setError(''); setNotice('');
        try {
            const payload = cvPayload(draft);
            if (action !== 'delete' && !payload.title.trim()) throw new Error('Hãy đặt tên cho CV.');
            // Never auto-replay non-idempotent CV writes, including after refresh.
            sessionStorage.setItem(mutationKey, JSON.stringify({ action, cvId }));
            setUncertain(true); setReconciled(false);
            const response = action === 'delete' ? await deleteMyCv(cvId)
                : cvId ? await updateMyCv(cvId, payload) : await createMyCv(payload);
            if (!current()) return;
            if (response?.errCode !== 0 || response.httpStatus >= 400) throw new Error('Chưa xác nhận được thay đổi CV. Hãy tải và đối chiếu danh sách trước khi thao tác tiếp.');
            if (action !== 'delete') {
                const [saved] = validateCvList({ errCode: 0, data: [response.data] });
                if (cvId && saved._id !== cvId) throw new Error('Phản hồi thuộc CV khác. Hãy đối chiếu danh sách.');
                if (JSON.stringify(cvPayload(saved)) !== JSON.stringify(payload)) throw new Error('Nội dung phản hồi chưa khớp CV đã gửi. Hãy đối chiếu danh sách.');
                setCvId(saved._id); setDraft(cvPayload(saved));
            } else { setCvId(null); setDraft(emptyCv()); }
            sessionStorage.removeItem(mutationKey); setUncertain(false);
            setNotice(action === 'delete' ? 'Đã xóa CV.' : 'Đã lưu CV.');
            await loadCvs();
        } catch (failure) { if (current()) setError(message(failure)); }
        finally { cvSending.current = false; if (current()) setCvBusy(false); }
    };
    const acknowledge = () => {
        if (!current() || !reconciled || cvBusy) return;
        try { sessionStorage.removeItem(mutationKey); setUncertain(false); setCvId(null); setDraft(emptyCv()); setNotice('Đã kết thúc đối chiếu. Chọn CV trong danh sách để sửa tiếp.'); }
        catch (failure) { setError(message(failure)); }
    };
    const repeatFields = (field, keys, title) => <fieldset className="candidate-ai-repeat"><legend>{title}</legend>
        {draft[field].map((row,index) => <div className="candidate-ai-repeat-row" key={index}>
            {keys.map(key => <label key={key}>{labels[key]} {index + 1}<input value={row[key]} maxLength={key === 'description' ? 10000 : ['from','to','year'].includes(key) ? 100 : 255}
                onChange={event => changeDraft(field, draft[field].map((entry,i) => i === index ? { ...entry, [key]:event.target.value } : entry))} /></label>)}
            <button type="button" onClick={() => changeDraft(field, draft[field].filter((_,i) => i !== index))}>Bỏ mục {index + 1}</button>
        </div>)}
        <button type="button" disabled={draft[field].length >= 100} onClick={() => changeDraft(field, [...draft[field], Object.fromEntries(keys.map(key => [key,'']))])}>Thêm {title.toLowerCase()}</button>
    </fieldset>;

    return <main className="candidate-ai">
        <h1>CV và trợ lý AI</h1>
        <p>Chuẩn bị hồ sơ, xem mức độ phù hợp và soạn thư cho công việc bạn chọn. Bạn kiểm tra và quyết định nội dung sử dụng.</p>
        {!enabled && <p role="status">Tính năng mới chưa mở. Bạn vẫn có thể xem kết quả hoặc đối chiếu yêu cầu đã gửi trước đây.</p>}
        {error && <p role="alert" className="candidate-ai-error">{error}</p>}
        {storageError && <p role="alert">Bộ nhớ tác vụ không khả dụng. Giữ mã tác vụ đang hiển thị; chức năng tạo mới đang khóa.</p>}
        {notice && <p role="status">{notice}</p>}
        <section className="candidate-ai-panel" aria-labelledby="ai-title">
            <h2 id="ai-title">Trợ lý AI</h2>
            <label>Chức năng<select value={mode} disabled={Boolean(intent) || busy || waiting} onChange={event => { setMode(event.target.value); setResult(null); }}>
                {Object.entries(modes).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {!intent?.taskId && <fieldset disabled={busy || waiting || storageError || (!enabled && !intent)}>
                {mode === 'parse_resume' ? <label>Tệp CV PDF (tối đa 5 MiB)<input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
                    : <>
                        <label>Nội dung CV<textarea rows="8" maxLength={10000} value={resumeText} onChange={event => setResumeText(event.target.value)} /></label>
                        <label>Mã công việc<input inputMode="numeric" value={jobId} onChange={event => setJobId(event.target.value)} /></label>
                        {mode === 'cover_letter' && <label>Ngôn ngữ<select value={language} onChange={event => setLanguage(event.target.value)}><option value="vi">Tiếng Việt</option><option value="en">Tiếng Anh</option></select></label>}
                    </>}
                <p>Tệp hoặc nội dung CV sẽ được gửi tới dịch vụ AI khi bạn bấm gửi. Nội dung không được lưu trong bộ nhớ trình duyệt.</p>
                <button type="button" onClick={submit}>{intent?.rejected ? 'Gửi lại cùng mã' : intent ? 'Đối chiếu yêu cầu đã gửi' : 'Gửi yêu cầu AI'}</button>
            </fieldset>}
            {intent && <div className="candidate-ai-task">
                {intent.taskId ? <>
                    <p>Mã tác vụ: <code>{intent.taskId}</code></p>
                    <button type="button" disabled={waiting || busy} onClick={() => watch(intent)}>Xem / tiếp tục chờ kết quả</button>
                </> : <p>{intent.rejected ? 'Yêu cầu bị từ chối trước khi nhận việc. Bạn có thể sửa dữ liệu và gửi lại với cùng mã.' : 'Đang giữ mã yêu cầu. Nếu mất phản hồi hoặc tải lại trang, chọn lại đúng dữ liệu đã gửi rồi bấm đối chiếu.'}</p>}
                {waiting && <button type="button" onClick={() => poll.current?.abort()}>Dừng chờ</button>}
                {terminal && enabled && <button type="button" disabled={busy || waiting || storageError} onClick={newTask}>Tác vụ mới</button>}
            </div>}
            {result && <div className="candidate-ai-result">
                <h3>Kết quả</h3>
                {mode === 'parse_resume' ? <>
                    <p>{result.fullName || 'Chưa xác định họ tên'} — {result.title}</p><p>{result.summary}</p>
                    <p>Kỹ năng: {result.skills.join(', ') || 'Chưa xác định'}</p>
                    <button type="button" disabled={!enabled || cvBusy || uncertain} onClick={() => { if (draft.title && !window.confirm('Thay bản nháp CV đang mở bằng kết quả AI?')) return; setDraft(result); setCvId(null); setNotice('Đã điền vào bản nháp bên dưới. Kiểm tra toàn bộ thông tin rồi bấm Lưu CV.'); }}>Xem và chỉnh sửa toàn bộ CV</button>
                </> : mode === 'cover_letter' ? <label>Thư ứng tuyển (có thể chỉnh sửa)<textarea rows="12" value={result.letter} onChange={event => setResult({ letter:event.target.value })} /></label>
                    : <><p className="candidate-ai-score">{result.score}/100</p><p>{result.summary}</p>
                        {[['matchedSkills','Kỹ năng phù hợp'],['missingSkills','Kỹ năng chưa thể hiện'],['strengths','Điểm mạnh'],['concerns','Điểm cần xem lại']].map(([field,title]) => <div key={field}><h4>{title}</h4><ul>{result[field].map((item,i) => <li key={i}>{item}</li>)}</ul></div>)}
                    </>}
            </div>}
        </section>
        <section className="candidate-ai-panel" aria-labelledby="cv-title">
            <h2 id="cv-title">CV của tôi</h2>
            <p>CV tại đây dùng cho trợ lý AI. Hồ sơ đã nộp và tệp đính kèm khi ứng tuyển vẫn được quản lý ở mục Công việc đã nộp.</p>
            <button type="button" disabled={cvLoading || cvBusy} onClick={loadCvs}>{cvLoading ? 'Đang tải…' : 'Tải danh sách CV'}</button>
            {cvLoaded && cvs.length === 0 && <p>Bạn chưa có CV trong danh sách này.</p>}
            {uncertain && <div role="alert"><p>Có thay đổi CV chưa xác nhận. Tải danh sách và kiểm tra nội dung trước khi tiếp tục. Việc tải lại không chứng minh lần lưu trước đã thành công.</p>
                <button type="button" disabled={!reconciled || cvBusy || cvLoading} onClick={acknowledge}>Đã đối chiếu danh sách CV</button></div>}
            <ul>{cvs.map(cv => <li key={cv._id}><button type="button" disabled={cvBusy} onClick={() => { if (draft.title && !window.confirm('Bỏ bản nháp đang mở để xem CV này?')) return; setCvId(cv._id); setDraft(cvPayload(cv)); }}>{cv.title || 'CV chưa đặt tên'}</button>
                <button type="button" disabled={!enabled || busy || waiting || Boolean(intent)} onClick={() => { const text = cvText(cv); if (text.length > 10000) { setError('CV dài hơn 10.000 ký tự. Rút gọn nội dung trước khi gửi AI.'); } setResumeText(text); setMode('match_cv'); }}>Dùng để đánh giá</button></li>)}</ul>
            <fieldset disabled={!enabled || cvBusy || uncertain || storageError}>
                <button type="button" onClick={() => { if (draft.title && !window.confirm('Bỏ bản nháp đang mở để tạo CV mới?')) return; setCvId(null); setDraft(emptyCv()); }}>Soạn CV mới</button>
                <h3>{cvId ? 'Chỉnh sửa CV' : 'Bản nháp CV mới'}</h3>
                <div className="candidate-ai-fields">{['title','fullName','email','phone','address'].map(field => <label key={field}>{labels[field]}<input value={draft[field]} maxLength={field === 'address' ? 1000 : field === 'email' ? 320 : field === 'phone' ? 100 : 255} onChange={event => changeDraft(field,event.target.value)} /></label>)}</div>
                <label>Giới thiệu<textarea rows="4" maxLength={20000} value={draft.summary} onChange={event => changeDraft('summary',event.target.value)} /></label>
                <label>Kỹ năng (mỗi dòng một mục)<textarea value={draft.skills.join('\n')} onChange={event => changeDraft('skills',event.target.value.split('\n'))} /></label>
                <label>Ngôn ngữ (mỗi dòng một mục)<textarea value={draft.languages.join('\n')} onChange={event => changeDraft('languages',event.target.value.split('\n'))} /></label>
                {repeatFields('experiences',['company','position','from','to','description'],'Kinh nghiệm')}
                {repeatFields('educations',['school','major','degree','year'],'Học vấn')}
                <p>Bản nháp chưa lưu sẽ mất khi rời hoặc tải lại trang. Tải danh sách trước khi lưu CV.</p>
                <button type="button" disabled={!cvLoaded} onClick={() => mutateCv('save')}>Lưu CV</button>
                {cvId && <button type="button" disabled={!cvLoaded} onClick={() => mutateCv('delete')}>Xóa CV</button>}
            </fieldset>
        </section>
    </main>;
}

export default function CandidateAi() {
    const context = useContext(SessionContext);
    const user = context === undefined ? readJsonStorage('userData') : context;
    const [ended, setEnded] = useState(false);
    useEffect(() => {
        const end = () => setEnded(true);
        const storage = event => { if (event.key === null || ['token_user','userData'].includes(event.key)) end(); };
        window.addEventListener(SESSION_ENDED_EVENT, end); window.addEventListener('storage', storage);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, end); window.removeEventListener('storage', storage); };
    }, []);
    const token = localStorage.getItem('token_user');
    if (ended || !token || !Number.isSafeInteger(Number(user?.id)) || Number(user?.id) <= 0 || user.roleCode !== 'CANDIDATE') {
        return <p role="alert">Bạn cần đăng nhập bằng tài khoản ứng viên để quản lý CV và sử dụng AI.</p>;
    }
    return <Workspace key={`${user.id}:${token}`} userId={Number(user.id)} token={token} />;
}
