import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import SendCvModal from '../../components/modal/SendCvModal';
import { toggleFavoritePostService } from '../../service/userService';
import { candidateAiEnabled } from '../../service/candidateWorkspace';
import { hasPermission, PERMISSIONS } from '../../auth/accessControl';
import SessionContext from '../../auth/SessionContext';
import { readJsonStorage } from '../../util/storage';
import { getCachedJobDetail, invalidateJobDetail, loadFavoriteState, loadJobDetail, loadRelatedJobs, prefetchJobDetail } from './jobDetailResource';
import { getJobSections, jobTimestamp } from './jobDescription';
import './JobDetail.css';

const paths = {
    pin: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    briefcase: 'M9 6V3h6v3 M3 7h18v14H3Z M3 12c6 4 12 4 18 0 M10 12h4',
    money: 'M3 6h18v13H3Z M7 3h13 M8 10h.01 M16 15h.01 M15 12.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    calendar: 'M4 5h16v16H4Z M8 2v6 M16 2v6 M4 10h16 M8 14h3 M8 17h6',
    send: 'm3 3 19 9-19 9 4-9-4-9Z M7 12h15',
    bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
    level: 'M4 3h16v18H4Z M8 15v2 M12 11v6 M16 7v10',
    experience: 'M3 5h18v14H3Z M8 5V2h8v3 M3 10l9 4 9-4 M12 11v5',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M17 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87',
    shield: 'm12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z M12 8v8 M8 12h8',
    laptop: 'M4 3h16v14H4Z M2 21h20 M8 17v4 M16 17v4',
    graduate: 'm2 9 10-6 10 6-10 6-10-6Z M6 12v6l6 3 6-3v-6 M22 9v8',
    check: 'M22 11.1V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
    chat: 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z',
};
const Icon = ({ name }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.briefcase} /></svg>;
const CompanyLogo = ({ company, small = false }) => {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [company.thumbnail]);
    return <div className={`jd-logo${small ? ' jd-logo--small' : ''}`}>
        {company.thumbnail && !failed ? <img src={company.thumbnail} alt="" width={small ? 48 : 76} height={small ? 48 : 76} onError={() => setFailed(true)} />
            : <span aria-label={company.name}>{(company.name || 'CT').split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span>}
    </div>;
};
const JobDetailSkeleton = () => <div className="jd-shell" role="status" aria-label="Đang tải chi tiết công việc">
    <div className="jd-hero jd-skeleton"><div className="jd-skeleton-line" /><div className="jd-skeleton-line" /></div>
    <div className="jd-layout" aria-hidden="true"><div className="job-detail-skeleton__content-card jd-skeleton">{[1, 2, 3, 4, 5].map(key => <div className="jd-skeleton-line" key={key} />)}</div><div className="jd-card jd-skeleton"><div className="jd-skeleton-line" /></div></div>
    <span className="jd-sr-only">Đang tải thông tin công việc…</span>
</div>;
const benefitIcon = html => /bảo hiểm|sức khỏe|khám/i.test(html) ? 'shield' : /hybrid|remote|từ xa|thiết bị|laptop/i.test(html) ? 'laptop' : /đào tạo|học|phát triển/i.test(html) ? 'graduate' : /lương|thưởng|thu nhập/i.test(html) ? 'money' : 'check';
const label = data => data?.value || 'Chưa cập nhật';
const EMPTY_DETAIL = {};

export default function JobDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const session = useContext(SessionContext);
    const user = session === undefined ? readJsonStorage('userData') : session;
    const userId = user?.id;
    const token = localStorage.getItem('token_user');
    const canApply = !user || (user.roleCode === 'CANDIDATE' && hasPermission(user, PERMISSIONS.APPLY_TO_JOB));
    const canSave = !user || hasPermission(user, PERMISSIONS.SOCIAL_INTERACT);
    const canChat = !user || (hasPermission(user, PERMISSIONS.USE_CHAT) && hasPermission(user, PERMISSIONS.SOCIAL_INTERACT));
    const checkFavorite = Boolean(userId && canSave);
    const [detailState, setDetailState] = useState(() => ({ data: getCachedJobDetail(id), error: false }));
    const [related, setRelated] = useState([]);
    const [favorite, setFavorite] = useState(false);
    const [saving, setSaving] = useState(false);
    const [favoriteLoading, setFavoriteLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [retry, setRetry] = useState(0);
    const [now, setNow] = useState(Date.now);
    const savingRef = useRef(false);
    const currentRoute = useRef(`${id}:${token}`);
    const scrolled = useRef(null);
    const activeIdentity = useRef({ id, userId, token });
    const mounted = useRef(false);
    activeIdentity.current = { id, userId, token };
    const data = detailState.data;
    const detail = data?.postDetailData || EMPTY_DETAIL;
    const sections = useMemo(() => getJobSections(detail), [detail]);

    useLayoutEffect(() => {
        if (currentRoute.current !== `${id}:${token}`) {
            currentRoute.current = `${id}:${token}`;
            setDetailState({ data: getCachedJobDetail(id), error: false });
            setRelated([]); setIsOpen(false); setSubmitted(false);
        }
        if (scrolled.current !== id) { window.scrollTo(0, 0); scrolled.current = id; }
    }, [id, token]);

    useEffect(() => {
        let active = true;
        loadJobDetail(id).then(response => {
            if (response?.stale) return;
            if (active) setDetailState(response?.errCode === 0 && response.data?.companyData && response.data?.postDetailData
                ? { data: response.data, error: false } : { data: null, error: true });
        }).catch(() => { if (active) setDetailState({ data: null, error: true }); });
        loadRelatedJobs(id).then(response => {
            if (active && response?.errCode === 0) setRelated(response.data || []);
        }).catch(() => { if (active) setRelated([]); });
        return () => { active = false; };
    }, [id, retry, token]);

    useEffect(() => {
        let active = true;
        setFavorite(false); setSaving(false); setSubmitted(false); setIsOpen(false); savingRef.current = false;
        setFavoriteLoading(checkFavorite);
        if (checkFavorite) loadFavoriteState(id, userId).then(response => {
            if (active && response?.errCode === 0) setFavorite(Boolean(response.isFavorite));
        }).catch(() => {}).finally(() => { if (active) setFavoriteLoading(false); });
        return () => { active = false; };
    }, [id, userId, checkFavorite, token]);

    useEffect(() => {
        mounted.current = true;
        const timer = window.setInterval(() => setNow(Date.now()), 30000);
        return () => { mounted.current = false; window.clearInterval(timer); };
    }, []);

    const end = jobTimestamp(data?.timeEnd);
    const start = jobTimestamp(data?.timePost || data?.createdAt);
    const closed = !end || end <= now || Boolean(data?.statusCode && data.statusCode !== 'PS1');
    const elapsed = start && end && end > start ? Math.max(0, Math.min(100, Math.round((now - start) / (end - start) * 100))) : null;
    const deadline = end ? new Intl.DateTimeFormat('vi-VN').format(end) : 'Chưa cập nhật';
    const login = message => {
        toast.error(message);
        localStorage.setItem('lastUrl', window.location.href);
        navigate('/login');
    };
    const openApplication = () => {
        if (!end || end <= Date.now() || closed) { toast.error('Hạn ứng tuyển đã hết'); return; }
        if (!user) { login('Xin hãy đăng nhập để có thể thực hiện nộp CV'); return; }
        if (canApply) setIsOpen(true);
    };
    const toggleFavorite = async () => {
        if (!user) { login('Xin hãy đăng nhập để có thể lưu tin tuyển dụng'); return; }
        if (!canSave || savingRef.current) return;
        const identity = activeIdentity.current;
        const isCurrent = () => mounted.current && identity.id === activeIdentity.current.id && identity.userId === activeIdentity.current.userId && identity.token === activeIdentity.current.token;
        savingRef.current = true; setSaving(true);
        try {
            const response = await toggleFavoritePostService({ userId, postId: id });
            if (!isCurrent()) return;
            if (response?.errCode === 0) { setFavorite(Boolean(response.isFavorite)); toast.success(response.errMessage || 'Đã cập nhật việc làm đã lưu'); }
            else toast.error(response?.errMessage || 'Có lỗi xảy ra');
        } catch { if (isCurrent()) toast.error('Không thể lưu việc làm. Vui lòng thử lại.'); }
        finally { if (isCurrent()) { savingRef.current = false; setSaving(false); } }
    };
    const afterSubmit = () => {
        setSubmitted(true); setIsOpen(false); invalidateJobDetail(id);
        loadJobDetail(id).then(response => {
            if (mounted.current && activeIdentity.current.id === id && response?.errCode === 0 && response.data?.companyData) setDetailState({ data: response.data, error: false });
        }).catch(() => {});
    };
    const chat = () => {
        if (!user) { login('Xin hãy đăng nhập để nhắn tin với nhà tuyển dụng'); return; }
        if (Number(user.id) === Number(data.userId)) { toast.error('Đây là tin đăng của bạn'); return; }
        navigate(`/chat/${data.userId}`);
    };
    const applyButton = () => canApply && <button type="button" className="jd-button jd-button--primary" onClick={openApplication} disabled={closed || submitted}>
        <Icon name={submitted ? 'check' : 'send'} />{submitted ? 'Đã nộp CV' : closed ? 'Đã hết hạn ứng tuyển' : 'Nộp CV ngay'}
    </button>;

    if (!data?.companyData || !data?.postDetailData) return <main className="job-detail-page jd-page" aria-busy={!detailState.error}>
        {detailState.error ? <div className="jd-error" role="alert"><Icon name="briefcase" /><h1>Không thể tải thông tin công việc</h1><p>Tin tuyển dụng không còn hiển thị hoặc kết nối bị gián đoạn.</p><button className="jd-button jd-button--primary" onClick={() => { invalidateJobDetail(id); setDetailState({ data: null, error: false }); setRetry(value => value + 1); }}>Thử lại</button><Link to="/job">Tìm việc làm khác</Link></div> : <JobDetailSkeleton />}
    </main>;

    const company = data.companyData;
    const applicationCount = typeof data.applicationCount === 'number' && Number.isFinite(data.applicationCount) && data.applicationCount >= 0 ? data.applicationCount : null;
    return <main className="job-detail-page jd-page" aria-busy="false">
        <div className="jd-shell">
            <header className="jd-hero">
                <CompanyLogo company={company} />
                <div className="jd-heading"><h1>{detail.name}</h1><Link className="jd-company-link" to={`/detail-company/${company.id}`}>{company.name}</Link>
                    <div className="jd-tags"><span><Icon name="pin" />{label(detail.provincePostData)}</span><span><Icon name="briefcase" />{label(detail.workTypePostData)}</span><span className="jd-tag--salary"><Icon name="money" />{label(detail.salaryTypePostData)}</span><span className={closed ? 'jd-tag--closed' : ''}><Icon name="calendar" />Hạn nộp: {deadline}</span></div>
                </div>
                <div className="jd-hero-actions">{applyButton()}{canSave && <button type="button" className={`jd-button jd-button--save${favorite ? ' is-active' : ''}`} aria-pressed={favorite} disabled={saving || favoriteLoading} onClick={toggleFavorite}><Icon name="bookmark" />{saving ? 'Đang lưu…' : favorite ? 'Đã lưu việc làm' : 'Lưu việc làm'}</button>}</div>
            </header>
            <div className="jd-layout">
                <article className="jd-content">
                    <section className="jd-section"><h2>Mô tả công việc</h2>{sections.description.trim() ? <div className="jd-richtext" dangerouslySetInnerHTML={{ __html: sections.description }} /> : <p className="jd-muted">Nhà tuyển dụng chưa cập nhật mô tả công việc.</p>}</section>
                    {sections.requirements.trim() && <section className="jd-section jd-requirements"><h2>Yêu cầu ứng viên</h2><div className="jd-richtext" dangerouslySetInnerHTML={{ __html: sections.requirements }} /></section>}
                    {sections.benefits.length > 0 && <section className="jd-section"><h2>Quyền lợi</h2><div className="jd-benefits">{sections.benefits.map((html, index) => <div className="jd-benefit" key={index}><span className={`jd-benefit-icon jd-benefit-icon--${benefitIcon(html)}`}><Icon name={benefitIcon(html)} /></span><div className="jd-richtext" dangerouslySetInnerHTML={{ __html: html }} /></div>)}</div></section>}
                    {related.length > 0 && <section className="jd-section jd-related"><h2>Việc làm tương tự</h2>{related.map(item => <Link key={item.id} to={`/detail-job/${item.id}`} onMouseEnter={() => prefetchJobDetail(item.id)} onFocus={() => prefetchJobDetail(item.id)} onTouchStart={() => prefetchJobDetail(item.id)} className="jd-related-job"><CompanyLogo company={item.userPostData?.userCompanyData || {}} small /><div><h3>{item.postDetailData?.name}</h3><p>{item.userPostData?.userCompanyData?.name}</p><span>{item.postDetailData?.provincePostData?.value} · {item.postDetailData?.salaryTypePostData?.value}</span></div></Link>)}</section>}
                </article>
                <aside className="jd-sidebar" aria-label="Thông tin tuyển dụng">
                    <section className="jd-card jd-company-card" aria-label="Thông tin công ty">
                        <div className="jd-company-heading"><CompanyLogo company={company} small /><div><h2>{company.name}</h2><Link to={`/detail-company/${company.id}`}>Xem trang công ty</Link></div></div>
                        <dl className="jd-company-facts"><div><dt>Quy mô:</dt><dd>{Number(company.amountEmployer) > 0 ? `${Number(company.amountEmployer).toLocaleString('vi-VN')} nhân viên` : 'Chưa cập nhật'}</dd></div><div><dt>Lĩnh vực công việc:</dt><dd>{label(detail.jobTypePostData)}</dd></div><div><dt>Địa điểm:</dt><dd>{company.address || 'Chưa cập nhật'}</dd></div></dl>
                        {(company.website || company.phonenumber || company.taxnumber) && <details className="jd-company-more"><summary>Thông tin liên hệ</summary><dl className="jd-company-facts">{company.website && <div><dt>Website:</dt><dd>{company.website}</dd></div>}{company.phonenumber && <div><dt>Điện thoại:</dt><dd>{company.phonenumber}</dd></div>}{company.taxnumber && <div><dt>Mã số thuế:</dt><dd>{company.taxnumber}</dd></div>}</dl></details>}
                    </section>
                    <section className="jd-card"><h2>Thông tin chung</h2><dl className="jd-job-facts">{[['level', 'Cấp bậc', label(detail.jobLevelPostData)], ['experience', 'Kinh nghiệm', label(detail.expTypePostData)], ['people', 'Số lượng tuyển', Number(detail.amount) > 0 ? `${String(detail.amount).padStart(2, '0')} người` : 'Chưa cập nhật']].map(([icon, title, value]) => <div key={title}><Icon name={icon} /><div><dt>{title}</dt><dd>{value}</dd></div></div>)}</dl>
                        <div className="jd-progress"><div className="jd-progress-heading"><span>Tiến độ ứng tuyển</span><strong>{applicationCount === null ? 'Chưa có số liệu' : `${applicationCount.toLocaleString('vi-VN')} lượt ứng tuyển`}</strong></div>{elapsed !== null && <progress max="100" value={elapsed} aria-label="Thời gian tuyển dụng đã qua" />}<p>{closed ? 'Tin tuyển dụng đã đóng nhận hồ sơ.' : `Nhận hồ sơ đến ${deadline}.`}</p></div>
                    </section>
                    {(canApply || canChat) && <section className="jd-card jd-contact-card">{canApply && <><p>{submitted ? 'Hồ sơ của bạn đã được gửi.' : 'Bạn quan tâm đến vị trí này?'}</p>{applyButton()}</>}{user?.roleCode === 'CANDIDATE' && candidateAiEnabled() && <Link className="jd-button jd-button--outline" to={`/candidate/ai-cv?jobId=${id}`}>Chuẩn bị CV / thư với AI</Link>}{canChat && <button className="jd-button jd-button--text" type="button" onClick={chat}><Icon name="chat" />Nhắn tin cho nhà tuyển dụng</button>}</section>}
                </aside>
            </div>
        </div>
        <SendCvModal isOpen={isOpen} onHide={() => setIsOpen(false)} onSubmitted={afterSubmit} postId={id} jobTitle={detail.name} />
    </main>;
}
