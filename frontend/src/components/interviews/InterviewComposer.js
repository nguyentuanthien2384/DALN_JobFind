import React, { useCallback, useEffect, useRef, useState } from 'react';
import InterviewInvitationForm from '../../container/system/Cv/InterviewInvitationForm';
import { getApplications, getApplicationDetail, sendInterviewInvitation } from '../../service/applicationService';
import { getDetailCompanyById } from '../../service/userService';
import CalendarDialog from './CalendarDialog';
import '../../container/system/Cv/KanbanBoard.scss';

const PAGE_SIZE = 20;

export default function InterviewComposer({ user, event, sessionActive, onClose, onSent }) {
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [offset, setOffset] = useState(0);
    const [applications, setApplications] = useState([]);
    const [count, setCount] = useState(0);
    const [loading, setLoading] = useState(!event);
    const [detail, setDetail] = useState(null);
    const [company, setCompany] = useState(null);
    const [message, setMessage] = useState(event?.message || '');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [retry, setRetry] = useState(0);
    const alive = useRef(true);
    const requestId = useRef(0);
    const sending = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; requestId.current += 1; }; }, []);
    const current = useCallback(() => alive.current && sessionActive(), [sessionActive]);

    const selectApplication = useCallback(async (id) => {
        const request = ++requestId.current;
        setLoading(true); setError('');
        try {
            const response = await getApplicationDetail(id);
            if (!current() || request !== requestId.current) return;
            if (response?.errCode !== 0 || !response.data) throw new Error(response?.errMessage || 'Không tải được hồ sơ ứng tuyển');
            if (response.data.stage === 'nhan_viec') throw new Error('Ứng viên đã nhận việc nên không gửi thư mời phỏng vấn');
            const selected = response.data;
            let companyData = null;
            if (selected.company_id || user.companyId) {
                try {
                    const companyResponse = await getDetailCompanyById(selected.company_id || user.companyId);
                    if (companyResponse?.errCode === 0) companyData = companyResponse.data;
                } catch { /* Company details are optional: the recruiter can enter them in the form. */ }
            }
            if (!current() || request !== requestId.current) return;
            setCompany(companyData); setDetail(selected);
        } catch (problem) {
            if (current() && request === requestId.current) setError(problem.message || 'Không tải được hồ sơ ứng tuyển');
        } finally {
            if (current() && request === requestId.current) setLoading(false);
        }
    }, [current, user.companyId]);

    useEffect(() => {
        if (event) { selectApplication(event.applicationId); return; }
        const request = ++requestId.current;
        setLoading(true); setError(''); setApplications([]);
        getApplications({ q: search, limit: PAGE_SIZE, offset }).then((response) => {
            if (!current() || request !== requestId.current) return;
            if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Không tải được danh sách hồ sơ ứng tuyển');
            setApplications(response.data || []); setCount(response.count || 0);
        }).catch((problem) => {
            if (current() && request === requestId.current) setError(problem.message || 'Không tải được danh sách hồ sơ ứng tuyển');
        }).finally(() => {
            if (current() && request === requestId.current) setLoading(false);
        });
    }, [event, search, offset, retry, current, selectApplication]);

    const send = async (interview) => {
        if (sending.current || !current()) return;
        sending.current = true; setBusy(true); setError('');
        try {
            const response = await sendInterviewInvitation(detail.id, message.trim(), interview);
            if (!current()) return;
            if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Chưa gửi được thư mời. Vui lòng thử lại.');
            onSent(interview);
        } catch (problem) {
            if (current()) setError(problem.message || 'Chưa gửi được thư mời. Vui lòng thử lại.');
        } finally {
            sending.current = false;
            if (current()) setBusy(false);
        }
    };

    return <CalendarDialog title={event ? 'Đổi lịch phỏng vấn' : 'Tạo lịch phỏng vấn'} onClose={onClose} busy={busy}>
        {error && <div className="ic-error" role="alert">{error}{!detail && <button type="button" onClick={() => setRetry((value) => value + 1)}>Thử lại</button>}</div>}
        {loading ? <p className="ic-empty" role="status">Đang tải hồ sơ ứng tuyển…</p> : detail ? <div className="ic-compose kanban-board">
            <div className="ic-selected-app"><strong>{detail.candidate_name}</strong><span>{detail.job_title} · {detail.candidate_email}</span></div>
            <label className="ic-message">Lời nhắn thêm cho ứng viên<textarea rows={3} maxLength={3000} value={message} disabled={busy} onChange={(change) => setMessage(change.target.value)} placeholder="Ví dụ: Vui lòng tham gia trước giờ hẹn 5 phút." /></label>
            <InterviewInvitationForm key={detail.id} detail={detail} user={user} company={company} message={message} busy={busy} onSend={send} onCancel={onClose} />
        </div> : !event && <div className="ic-app-picker">
            <p>Chọn hồ sơ ứng tuyển để soạn và xem trước thư mời. Sau khi gửi, lịch sẽ xuất hiện cho nhà tuyển dụng và ứng viên.</p>
            <form className="ic-picker-search" onSubmit={(submit) => { submit.preventDefault(); setOffset(0); setSearch(query.trim()); }}>
                <label htmlFor="ic-app-search" className="ic-sr-only">Tìm ứng viên theo tên hoặc email</label>
                <input id="ic-app-search" value={query} onChange={(change) => setQuery(change.target.value)} placeholder="Tên hoặc email ứng viên" />
                <button type="submit" className="ic-button">Tìm kiếm</button>
            </form>
            {!applications.length && !error && <p className="ic-empty">Không tìm thấy hồ sơ ứng tuyển. Hồ sơ cần được nộp vào công ty trước khi tạo lịch.</p>}
            <div className="ic-app-list">{applications.map((application) => <button type="button" key={application.id} disabled={application.stage === 'nhan_viec'} onClick={() => selectApplication(application.id)}>
                <span><strong>{application.candidate_name || 'Ứng viên'}</strong><small>{application.candidate_email}</small></span>
                <span><strong>{application.job_title}</strong><small>{application.stage === 'nhan_viec' ? 'Đã nhận việc' : 'Chọn hồ sơ →'}</small></span>
            </button>)}</div>
            {count > PAGE_SIZE && <div className="ic-picker-pagination"><button type="button" disabled={!offset} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Trang trước</button><span>{Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(count / PAGE_SIZE)}</span><button type="button" disabled={offset + PAGE_SIZE >= count} onClick={() => setOffset((value) => value + PAGE_SIZE)}>Trang sau</button></div>}
        </div>}
    </CalendarDialog>;
}
