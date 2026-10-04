import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { readJsonStorage } from '../../util/storage';
import { getInterviewCalendar } from '../../service/interviewCalendarService';
import CalendarDialog from './CalendarDialog';
import InterviewComposer from './InterviewComposer';
import { adjacentMonth, calendarDays, dateLabel, downloadInterviewIcs, safeMeetingUrl, vietnamDate, vietnamTime } from './calendarDates';
import './InterviewCalendar.css';

const statusLabels = { scheduled: 'Đã lên lịch', past: 'Đã qua', inactive: 'Không còn hiệu lực' };
const modeLabels = { online: 'Trực tuyến', onsite: 'Trực tiếp', phone: 'Điện thoại' };
const stageLabels = { moi_ung_tuyen: 'Mới ứng tuyển', dang_xem_xet: 'Đang xem xét', phong_van: 'Phỏng vấn', de_nghi: 'Đề nghị nhận việc', nhan_viec: 'Đã nhận việc', tu_choi: 'Từ chối' };
const token = () => { try { return localStorage.getItem('token_user') || ''; } catch { return ''; } };
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const timeRange = (event) => {
    const endDate = vietnamDate(event.endAt);
    const nextDay = endDate !== vietnamDate(event.startAt) ? ` (ngày ${endDate.slice(5).split('-').reverse().join('/')})` : '';
    return `${vietnamTime(event.startAt)} – ${vietnamTime(event.endAt)}${nextDay}`;
};

function Icon({ name, ...props }) {
    const paths = { calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" /></>, list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>, plus: <path d="M12 5v14M5 12h14" />, left: <path d="m15 6-6 6 6 6" />, right: <path d="m9 6 6 6-6 6" />, search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>, clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></> };
    return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.calendar}</svg>;
}
function Status({ value }) { return <span className={`ic-status ${value}`}>{statusLabels[value] || 'Đã lên lịch'}</span>; }
function InterviewRow({ event, candidate, onOpen, compact = false }) {
    return <button type="button" className={`ic-event-row ${compact ? 'compact' : ''}`} onClick={() => onOpen(event)}>
        <span className="ic-event-avatar" aria-hidden="true">{(candidate ? event.companyName : event.candidateName)?.trim().slice(0, 1) || 'P'}</span>
        <span className="ic-event-info"><strong>{candidate ? event.companyName || event.interview?.companyName : event.candidateName || 'Ứng viên'}</strong><span>{event.jobTitle}</span><small>{dateLabel(vietnamDate(event.startAt))} · {timeRange(event)}</small></span>
        <span className="ic-event-tail"><Status value={event.status} /><small>{modeLabels[event.interview?.interviewMode]}</small></span>
    </button>;
}

function InterviewDetail({ event, candidate, onClose, onEdit }) {
    const [error, setError] = useState('');
    const interview = event.interview || {};
    const meetingUrl = safeMeetingUrl(interview.meetingUrl);
    const email = candidate ? interview.contactEmail : event.candidateEmail;
    const safeEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/[\r\n]/.test(email) ? email : '';
    return <CalendarDialog title="Chi tiết lịch phỏng vấn" onClose={onClose}>
        <div className="ic-detail-hero"><Status value={event.status} /><h3>{event.jobTitle}</h3><p>{candidate ? event.companyName || interview.companyName : event.candidateName}</p></div>
        {event.status === 'inactive' && <p className="ic-notice">Hồ sơ đã chuyển sang bước khác. Lịch này không còn hiệu lực; hãy liên hệ nhà tuyển dụng nếu cần xác minh.</p>}
        <dl className="ic-details">
            <dt>Thời gian</dt><dd>{dateLabel(vietnamDate(event.startAt))}<br /><strong>{timeRange(event)}</strong> (giờ Việt Nam, UTC+7)</dd>
            <dt>Hình thức</dt><dd>{modeLabels[interview.interviewMode] || 'Chưa có thông tin'}</dd>
            {interview.interviewMode === 'onsite' && <><dt>Địa điểm</dt><dd>{interview.location}</dd></>}
            {interview.interviewMode === 'online' && <><dt>Phòng họp</dt><dd>{meetingUrl ? <a href={meetingUrl} target="_blank" rel="noopener noreferrer">Mở phòng họp trực tuyến ↗</a> : 'Link phòng họp không hợp lệ. Vui lòng liên hệ HR.'}</dd></>}
            <dt>Công ty</dt><dd>{event.companyName || interview.companyName}</dd>
            {!candidate && <><dt>Ứng viên</dt><dd>{event.candidateName}{safeEmail && <><br /><a href={`mailto:${safeEmail}`}>{safeEmail}</a></>}</dd></>}
            {interview.round && <><dt>Vòng phỏng vấn</dt><dd>{interview.round}</dd></>}
            {interview.interviewers && <><dt>Người phỏng vấn</dt><dd>{interview.interviewers}</dd></>}
            <dt>Liên hệ HR</dt><dd>{interview.contactName}{candidate && safeEmail && <><br /><a href={`mailto:${safeEmail}`}>{safeEmail}</a></>}{interview.contactPhone && <><br />{interview.contactPhone}</>}</dd>
            {interview.confirmBy && <><dt>Hạn xác nhận</dt><dd>{interview.confirmBy.slice(0, 10).split('-').reverse().join('/')} lúc {interview.confirmBy.slice(11, 16)} (UTC+7)</dd></>}
            {interview.preparation && <><dt>Cần chuẩn bị</dt><dd>{interview.preparation}</dd></>}
            {event.message && <><dt>Lời nhắn</dt><dd>{event.message}</dd></>}
            {!candidate && <><dt>Bước hồ sơ</dt><dd>{stageLabels[event.applicationStage] || event.applicationStage}</dd></>}
        </dl>
        {candidate && <p className="ic-notice">Để xác nhận tham gia hoặc đề xuất đổi lịch, vui lòng phản hồi email thư mời hoặc liên hệ HR. “Đã lên lịch” là trạng thái thư mời.</p>}
        {error && <p role="alert" className="ic-error">{error}</p>}
        <div className="ic-detail-actions">
            <button type="button" className="ic-button secondary" disabled={event.status === 'inactive'} onClick={() => { try { downloadInterviewIcs(event); } catch (problem) { setError(problem.message); } }}><Icon name="download" />Tải lịch .ics</button>
            {candidate && safeEmail && <a className="ic-button" href={`mailto:${safeEmail}?subject=${encodeURIComponent(`Phản hồi lịch phỏng vấn — ${event.jobTitle || ''}`)}`}>Liên hệ HR</a>}
            {!candidate && event.applicationStage !== 'nhan_viec' && <button type="button" className="ic-button" onClick={() => onEdit(event)}>Đổi lịch / gửi lại thư mời</button>}
        </div>
    </CalendarDialog>;
}

function CalendarView({ candidate, user, sessionToken }) {
    const [month, setMonth] = useState(() => vietnamDate().slice(0, 7));
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    const [view, setView] = useState('month');
    const [query, setQuery] = useState('');
    const [mode, setMode] = useState('');
    const [status, setStatus] = useState('');
    const [selectedDay, setSelectedDay] = useState('');
    const [detail, setDetail] = useState(null);
    const [composer, setComposer] = useState(null);
    const [success, setSuccess] = useState('');
    const alive = useRef(true);
    const requests = useRef(0);
    const days = useMemo(() => calendarDays(month), [month]);
    const sessionActive = useCallback(() => alive.current && token() === sessionToken, [sessionToken]);
    useEffect(() => { alive.current = true; return () => { alive.current = false; requests.current += 1; }; }, []);
    useEffect(() => {
        const request = ++requests.current;
        setLoading(true); setError(''); setEvents([]);
        getInterviewCalendar({ candidate, from: days[0], to: days[41] }).then((response) => {
            if (!sessionActive() || request !== requests.current) return;
            if (response?.errCode !== 0) throw new Error(response?.errMessage || 'Không tải được lịch phỏng vấn');
            setEvents((response.data || []).filter((event) => vietnamDate(event.startAt)).sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)));
        }).catch((problem) => {
            if (sessionActive() && request === requests.current) setError(problem.message || 'Không tải được lịch phỏng vấn. Vui lòng kiểm tra kết nối và thử lại.');
        }).finally(() => {
            if (sessionActive() && request === requests.current) setLoading(false);
        });
        return () => { requests.current += 1; };
    }, [candidate, days, refresh, sessionActive]);
    const filtered = useMemo(() => events.filter((event) => (!mode || event.interview?.interviewMode === mode) && (!status || event.status === status)
        && (!query.trim() || normalize([event.candidateName, event.candidateEmail, event.companyName, event.jobTitle, event.interview?.round].join(' ')).includes(normalize(query.trim())))), [events, mode, status, query]);
    const monthlyEvents = filtered.filter((event) => vietnamDate(event.startAt).startsWith(month));
    const byDay = filtered.reduce((result, event) => { const day = vietnamDate(event.startAt); (result[day] ||= []).push(event); return result; }, {});
    const agenda = selectedDay ? byDay[selectedDay] || [] : monthlyEvents.filter((event) => event.status === 'scheduled').slice(0, 5);
    const totals = events.filter((event) => vietnamDate(event.startAt).startsWith(month));
    const changeMonth = (value) => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) { setMonth(value); setSelectedDay(''); } };
    const sent = (interview) => { setComposer(null); setSuccess('Đã xếp hàng gửi thư mời phỏng vấn. Lịch đang được cập nhật.'); setMonth(interview.interviewDate.slice(0, 7)); setSelectedDay(interview.interviewDate); setRefresh((value) => value + 1); };

    return <main className={`interview-calendar ${candidate ? 'ic-candidate' : ''}`}>
        <header className="ic-page-head"><div><span className="ic-eyebrow">{candidate ? 'HÀNH TRÌNH ỨNG TUYỂN' : 'QUẢN LÝ TUYỂN DỤNG'}</span><h1>Lịch phỏng vấn</h1><p>{candidate ? 'Theo dõi lời mời, chuẩn bị và kết nối với nhà tuyển dụng.' : 'Sắp xếp lịch hẹn và theo dõi các buổi phỏng vấn của đội ngũ.'}</p></div>{!candidate && <button type="button" className="ic-button" onClick={() => { setSuccess(''); setComposer({ event: null }); }}><Icon name="plus" />Tạo lịch phỏng vấn</button>}</header>
        {success && <div role="status" className="ic-success">{success}<button type="button" aria-label="Ẩn thông báo" onClick={() => setSuccess('')}>×</button></div>}
        <div className="ic-statistics"><div><span className="ic-stat-icon"><Icon name="calendar" /></span><div><strong>{loading ? '—' : totals.length}</strong><span>Lịch hẹn trong tháng</span></div></div><div><span className="ic-stat-icon upcoming"><Icon name="clock" /></span><div><strong>{loading ? '—' : totals.filter((event) => event.status === 'scheduled').length}</strong><span>Đang được lên lịch</span></div></div><div><span className="ic-stat-icon past"><Icon name="list" /></span><div><strong>{loading ? '—' : totals.filter((event) => event.status === 'past').length}</strong><span>Lịch hẹn đã qua</span></div></div></div>
        <section className="ic-workspace" aria-label="Lịch và danh sách phỏng vấn">
            <div className="ic-calendar-panel">
                <div className="ic-toolbar">
                    <div className="ic-month-nav">
                        <button type="button" className="ic-icon-button" aria-label="Tháng trước" onClick={() => changeMonth(adjacentMonth(month, -1))}><Icon name="left" /></button>
                        <label><span className="ic-sr-only">Chọn tháng</span><input type="month" value={month} onChange={(change) => changeMonth(change.target.value)} /></label>
                        <button type="button" className="ic-icon-button" aria-label="Tháng sau" onClick={() => changeMonth(adjacentMonth(month, 1))}><Icon name="right" /></button>
                        <button type="button" className="ic-today" onClick={() => { changeMonth(vietnamDate().slice(0, 7)); setSelectedDay(vietnamDate()); }}>Hôm nay</button>
                    </div>
                    <button type="button" className="ic-today" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Làm mới lịch</button>
                    <div className="ic-view-toggle" aria-label="Chế độ xem">
                        <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}><Icon name="calendar" />Tháng</button>
                        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" />Danh sách</button>
                    </div>
                </div>
                <div className="ic-filters"><label className="ic-search"><Icon name="search" /><span className="ic-sr-only">Tìm lịch phỏng vấn</span><input value={query} onChange={(change) => setQuery(change.target.value)} placeholder={candidate ? 'Tìm công ty, vị trí…' : 'Tìm ứng viên, vị trí…'} /></label><label><span className="ic-sr-only">Lọc hình thức</span><select value={mode} onChange={(change) => setMode(change.target.value)}><option value="">Tất cả hình thức</option>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="ic-sr-only">Lọc trạng thái</span><select value={status} onChange={(change) => setStatus(change.target.value)}><option value="">Tất cả trạng thái</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                <div className="ic-calendar-content" aria-busy={loading}>
                    {error ? <div className="ic-load-error" role="alert"><Icon name="calendar" /><h2>Chưa tải được lịch phỏng vấn</h2><p>{error}</p><button type="button" className="ic-button" onClick={() => setRefresh((value) => value + 1)}>Thử lại</button></div> : loading ? <div className="ic-loading" role="status"><span className="ic-spinner" />Đang tải lịch phỏng vấn…</div> : view === 'month' ? <>
                        <div className="ic-grid" role="table" aria-label={`Lịch phỏng vấn tháng ${month.split('-').reverse().join('/')}`}><div role="row" className="ic-weekdays">{['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'].map((label) => <span role="columnheader" key={label}>{label}</span>)}</div>{Array.from({ length: 6 }, (_, week) => <div className="ic-week" role="row" key={week}>{days.slice(week * 7, week * 7 + 7).map((day) => <div role="cell" key={day} className={`ic-day ${!day.startsWith(month) ? 'adjacent' : ''} ${day === vietnamDate() ? 'today' : ''} ${day === selectedDay ? 'selected' : ''}`}>
                            <button type="button" className="ic-day-number" aria-label={`Xem lịch ngày ${dateLabel(day)}`} aria-pressed={day === selectedDay} onClick={() => setSelectedDay(day)}>{Number(day.slice(-2))}</button>
                            {(byDay[day] || []).slice(0, 2).map((event) => <button type="button" key={event.id} className={`ic-grid-event ${event.status} ${event.interview?.interviewMode}`} onClick={() => setDetail(event)} aria-label={`${candidate ? event.companyName : event.candidateName} · ${event.jobTitle} · ${vietnamTime(event.startAt)}`}><span>{vietnamTime(event.startAt)} · {modeLabels[event.interview?.interviewMode]}</span><strong>{candidate ? event.companyName || event.interview?.companyName : event.candidateName}</strong><small>{event.jobTitle}</small></button>)}
                            {(byDay[day]?.length || 0) > 2 && <button type="button" className="ic-more" onClick={() => setSelectedDay(day)}>+{byDay[day].length - 2} lịch hẹn</button>}
                        </div>)}</div>)}</div>
                        {!monthlyEvents.length && <p className="ic-month-empty">{query || mode || status ? 'Không có lịch phù hợp với bộ lọc trong tháng này.' : 'Chưa có lịch phỏng vấn trong tháng này.'}</p>}
                    </> : <div className="ic-list"><div className="ic-list-heading"><h2>Lịch phỏng vấn trong tháng</h2><span>{monthlyEvents.length} lịch hẹn</span></div>{monthlyEvents.length ? monthlyEvents.map((event) => <InterviewRow key={event.id} event={event} candidate={candidate} onOpen={setDetail} />) : <p className="ic-empty">{query || mode || status ? 'Không có lịch phù hợp với bộ lọc.' : 'Chưa có lịch phỏng vấn trong tháng này.'}</p>}</div>}
                </div>
                <footer className="ic-calendar-footer"><span className="ic-zone"><Icon name="clock" />Giờ Việt Nam · UTC+7</span><span className="ic-legend"><i className="online" />Trực tuyến<i className="onsite" />Trực tiếp<i className="phone" />Điện thoại</span></footer>
            </div>
            <aside className="ic-agenda"><div className="ic-agenda-title"><h2>{selectedDay ? 'Lịch trong ngày' : 'Lịch sắp tới'}</h2>{selectedDay && <button type="button" className="ic-text-button" onClick={() => setSelectedDay('')}>Bỏ chọn</button>}</div><p className="ic-agenda-sub">{selectedDay ? dateLabel(selectedDay) : 'Các lời mời đang có hiệu lực trong tháng'}</p>{!loading && !error && (agenda.length ? agenda.map((event) => <InterviewRow key={event.id} event={event} candidate={candidate} onOpen={setDetail} compact />) : <div className="ic-agenda-empty"><Icon name="calendar" /><p>{selectedDay ? 'Không có lịch hẹn trong ngày này.' : 'Chưa có lịch phỏng vấn sắp tới.'}</p></div>)}<div className="ic-agenda-tip"><strong>Chuẩn bị cho buổi phỏng vấn</strong><p>{candidate ? 'Xem yêu cầu chuẩn bị trong thư mời và liên hệ HR để xác nhận thời gian tham gia.' : 'Kiểm tra thời gian, người phỏng vấn và địa điểm trước khi gửi thư mời.'}</p></div></aside>
        </section>
        {detail && <InterviewDetail event={detail} candidate={candidate} onClose={() => setDetail(null)} onEdit={(event) => { setDetail(null); setComposer({ event }); }} />}
        {composer && !candidate && <InterviewComposer user={user} event={composer.event} sessionActive={sessionActive} onClose={() => setComposer(null)} onSent={sent} />}
    </main>;
}

export default function InterviewCalendar({ candidate = false, user: suppliedUser }) {
    const contextualUser = useContext(SessionContext);
    const [revision, setRevision] = useState(0);
    const [ended, setEnded] = useState(false);
    const user = suppliedUser !== undefined ? suppliedUser : contextualUser !== undefined ? contextualUser : readJsonStorage('userData', null);
    useEffect(() => {
        const endSession = () => { setEnded(true); setRevision((value) => value + 1); };
        const storageChanged = (event) => {
            if (event.key && !['token_user', 'userData'].includes(event.key)) return;
            setEnded(true); setRevision((value) => value + 1);
        };
        window.addEventListener(SESSION_ENDED_EVENT, endSession);
        window.addEventListener('storage', storageChanged);
        return () => { window.removeEventListener(SESSION_ENDED_EVENT, endSession); window.removeEventListener('storage', storageChanged); };
    }, []);
    const sessionToken = token();
    if (ended || !user || !sessionToken) return <div className="interview-calendar ic-empty" role="status">Vui lòng đăng nhập để xem lịch phỏng vấn của bạn.</div>;
    return <CalendarView key={`${user.id || user.userId}:${user.roleCode}:${user.companyId}:${sessionToken}:${revision}:${candidate}`} candidate={candidate} user={user} sessionToken={sessionToken} />;
}
