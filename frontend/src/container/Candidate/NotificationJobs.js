import React, { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactPaginate from 'react-paginate';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { readJsonStorage } from '../../util/storage';
import useListQuery, { clampListPage } from '../../util/useListQuery';
import { jobLabel } from '../../util/jobLocale';
import StableList from '../../components/common/StableList';
import { getNotificationJobs } from '../../service/notificationJobsService';
import './NotificationJobs.css';

const PAGE_SIZE = 10;
const CONTENT = {
    followed: {
        title: 'Việc làm từ công ty bạn theo dõi',
        description: 'Các vị trí đang nhận hồ sơ tại những công ty bạn theo dõi. Danh sách được cập nhật theo tình trạng tuyển dụng hiện tại.',
        emptyTitle: 'Chưa có việc làm đang tuyển từ công ty bạn theo dõi',
        emptyDescription: 'Theo dõi công ty bạn quan tâm để tìm lại các cơ hội tuyển dụng tại đây. Tin đã đóng hoặc hết hạn sẽ không xuất hiện trong danh sách.',
        action: 'Khám phá công ty',
        actionPath: '/company',
    },
    recommended: {
        title: 'Việc làm phù hợp với bạn',
        description: 'Các vị trí đang nhận hồ sơ phù hợp với kỹ năng và thiết lập tìm việc hiện tại của bạn. Kết quả có thể thay đổi khi bạn cập nhật hồ sơ hoặc nhà tuyển dụng đóng tin.',
        emptyTitle: 'Chưa tìm thấy việc làm phù hợp',
        emptyDescription: 'Cập nhật kỹ năng và mong muốn tìm việc để nhận các gợi ý phù hợp hơn với bạn.',
        action: 'Cập nhật thiết lập tìm việc',
        actionPath: '/candidate/usersetting',
    },
};

function closingDate(value) {
    if (value === undefined || value === null || value === '') return '';
    const date = new Date(/^\d+$/.test(String(value)) ? Number(value) : value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN');
}

// Last result per collection/page of this browser session's account: switching tabs
// paints the remembered list at once and refreshes it quietly instead of blanking it.
const CACHE_TTL = 5 * 60 * 1000;
// A list fetched this recently (e.g. just prefetched, or the tab was left a moment ago) is not re-requested.
const REUSE_FOR = 15 * 1000;
const CACHE_LIMIT = 20;
const listCache = new Map();
const pendingLists = new Map();
let cacheToken;
export const clearNotificationJobsCache = () => { listCache.clear(); pendingLists.clear(); };

function cacheFor(token) {
    if (token !== cacheToken) {
        clearNotificationJobsCache();
        cacheToken = token;
    }
    return listCache;
}

function readCachedList(token, key) {
    const entry = cacheFor(token).get(key);
    return entry && Date.now() - entry.savedAt < CACHE_TTL ? entry : null;
}

function loadJobs(token, source, page) {
    const key = JSON.stringify([source, page]);
    const cached = readCachedList(token, key);
    if (cached && Date.now() - cached.savedAt < REUSE_FOR) return Promise.resolve(cached);
    if (!pendingLists.has(key)) {
        const request = getNotificationJobs({ source, limit: PAGE_SIZE, offset: page * PAGE_SIZE }).then(response => {
            if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)
                || !Number.isSafeInteger(response.count) || response.count < 0
                || response.data.some(row => !row || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0)) {
                throw new Error('Invalid job list');
            }
            const result = { rows: response.data, count: response.count, savedAt: Date.now() };
            if (localStorage.getItem('token_user') === token) {
                const cache = cacheFor(token);
                cache.delete(key);
                cache.set(key, result);
                if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
            }
            return result;
        }).finally(() => { if (pendingLists.get(key) === request) pendingLists.delete(key); });
        pendingLists.set(key, request);
    }
    return pendingLists.get(key);
}

// Hovering or focusing the other tab starts its first page early, so the click usually finds it ready.
const prefetchJobs = (token, source) => { loadJobs(token, source, 0).catch(() => {}); };

function JobsList({ source, userId, token }) {
    const copy = CONTENT[source];
    const [{ page }, setQuery] = useListQuery({ page: 0 });
    const [refresh, setRefresh] = useState(0);
    const [result, setResult] = useState(null);
    const listKey = JSON.stringify([source, page]);
    const requestKey = JSON.stringify([listKey, refresh]);
    const fresh = result?.requestKey === requestKey;
    const cached = fresh ? null : readCachedList(token, listKey);
    // A tab seen before shows its remembered list; a first visit keeps the previous cards
    // (dimmed by StableList) until its own response arrives, so the page never collapses.
    const view = fresh ? result : cached || result || { rows: [], count: 0, error: '' };
    const { rows, count, error = '' } = view;
    const busy = !fresh && !cached;

    useEffect(() => {
        let active = true;
        const current = () => active && localStorage.getItem('token_user') === token;
        loadJobs(token, source, page).then(response => {
            if (!current()) return;
            const validPage = clampListPage(page, response.count, PAGE_SIZE);
            if (validPage !== page) {
                listCache.delete(listKey);
                setQuery({ page: validPage }, { replace: true });
                return;
            }
            setResult({ requestKey, rows: response.rows, count: response.count, error: '' });
        }, () => {
            if (!current()) return;
            const stale = readCachedList(token, listKey);
            setResult(stale ? { requestKey, rows: stale.rows, count: stale.count, error: '' }
                : { requestKey, rows: [], count: 0, error: 'Không tải được danh sách việc làm. Vui lòng thử lại.' });
        });
        return () => { active = false; };
    }, [source, token, page, listKey, requestKey, setQuery]);

    return <main className="notification-jobs" aria-labelledby="notification-jobs-title">
        <header className="notification-jobs__header">
            <span className="notification-jobs__eyebrow">CƠ HỘI DÀNH CHO BẠN</span>
            {/* Both tabs' copy share one grid cell, so the taller one sets the height and the tabs never move. */}
            <div className="notification-jobs__intro">
                {Object.entries(CONTENT).map(([key, text]) => key === source
                    ? <div key={key}><h1 id="notification-jobs-title">{text.title}</h1><p>{text.description}</p></div>
                    : <div key={key} aria-hidden="true"><h1>{text.title}</h1><p>{text.description}</p></div>)}
            </div>
            <nav className="notification-jobs__tabs" aria-label="Nhóm việc làm cá nhân">
                {[['followed', '/candidate/followed-jobs', 'Công ty đang theo dõi'], ['recommended', '/candidate/recommended-jobs', 'Phù hợp với bạn']]
                    .map(([key, path, label]) => {
                        const warm = key === source ? undefined : () => prefetchJobs(token, key);
                        return <Link key={key} to={path} aria-current={key === source ? 'page' : undefined}
                            onMouseEnter={warm} onFocus={warm} onTouchStart={warm}>{label}</Link>;
                    })}
            </nav>
        </header>
        <div className="notification-jobs__toolbar">
            <p aria-live="polite">{busy ? 'Đang cập nhật danh sách…' : error ? 'Danh sách chưa tải được' : `${count} việc làm đang tuyển`}</p>
            <Link to="/job">Xem tất cả việc làm <span aria-hidden="true">→</span></Link>
        </div>
        <StableList busy={busy} resetKey={`${userId}:${source}`} label="Đang tải việc làm…" className="notification-jobs__list">
            {error ? <div className="notification-jobs__empty">
                <p role="alert">{error}</p>
                <button type="button" className="notification-jobs__action" onClick={() => setRefresh(value => value + 1)}>Thử lại</button>
            </div> : rows.length > 0 ? rows.map(post => {
                const detail = post.postDetailData || {};
                const company = post.userPostData?.userCompanyData || {};
                const deadline = closingDate(post.timeEnd);
                return <Link className="notification-jobs__card" to={`/detail-job/${post.id}`} key={post.id}>
                    <div className="notification-jobs__logo" aria-hidden="true">
                        {company.thumbnail ? <img src={company.thumbnail} alt="" loading="lazy" /> : <span>{company.name?.charAt(0) || 'J'}</span>}
                    </div>
                    <div className="notification-jobs__details">
                        <h2>{detail.name || 'Tin tuyển dụng'}</h2>
                        <p className="notification-jobs__company">{company.name || 'Nhà tuyển dụng'}</p>
                        <div className="notification-jobs__meta">
                            <span>{jobLabel(detail.provincePostData)}</span>
                            <span className="notification-jobs__salary">{jobLabel(detail.salaryTypePostData)}</span>
                            {detail.workTypePostData && <span>{jobLabel(detail.workTypePostData)}</span>}
                        </div>
                        {deadline && <p className="notification-jobs__deadline">Hạn ứng tuyển: {deadline}</p>}
                    </div>
                    <span className="notification-jobs__detail-link">Xem chi tiết <span aria-hidden="true">→</span></span>
                </Link>;
            }) : !busy ? <div className="notification-jobs__empty">
                <span className="notification-jobs__empty-icon" aria-hidden="true"><i className={source === 'followed' ? 'far fa-building' : 'fas fa-search'} /></span>
                <h2>{copy.emptyTitle}</h2>
                <p>{copy.emptyDescription}</p>
                <Link className="notification-jobs__action" to={copy.actionPath}>{copy.action}</Link>
            </div> : null}
        </StableList>
        {!error && count > PAGE_SIZE && <nav className="notification-jobs__pagination" aria-label="Phân trang việc làm" aria-busy={busy}>
            <ReactPaginate forcePage={page} pageCount={Math.max(page + 1, Math.ceil(count / PAGE_SIZE))}
                previousLabel="Trước" nextLabel="Tiếp" breakLabel="…" pageRangeDisplayed={3} marginPagesDisplayed={1}
                containerClassName="pagination justify-content-center" pageClassName="page-item" pageLinkClassName="page-link"
                previousClassName="page-item" previousLinkClassName="page-link" nextClassName="page-item" nextLinkClassName="page-link"
                breakClassName="page-item" breakLinkClassName="page-link" activeClassName="active" disabledClassName="disabled"
                ariaLabelBuilder={number => `Trang ${number}`} onPageChange={({ selected }) => setQuery({ page: selected })} />
        </nav>}
    </main>;
}

export default function NotificationJobs({ source = 'recommended' }) {
    const context = useContext(SessionContext);
    const user = context === undefined ? readJsonStorage('userData') : context;
    const token = localStorage.getItem('token_user');
    const [ended, setEnded] = useState(false);
    useEffect(() => {
        const end = () => setEnded(true);
        const storage = event => {
            if (event.key !== null && !['token_user', 'userData'].includes(event.key)) return;
            const stored = readJsonStorage('userData');
            if (localStorage.getItem('token_user') !== token || stored?.id !== user?.id || stored?.roleCode !== 'CANDIDATE') end();
        };
        window.addEventListener(SESSION_ENDED_EVENT, end);
        window.addEventListener('storage', storage);
        return () => {
            window.removeEventListener(SESSION_ENDED_EVENT, end);
            window.removeEventListener('storage', storage);
        };
    }, [token, user?.id]);
    if (ended || !token || !user?.id || user.roleCode !== 'CANDIDATE') {
        return <p role="alert" className="notification-jobs">Đăng nhập bằng tài khoản ứng viên để xem việc làm dành cho bạn.</p>;
    }
    // Not keyed by source: switching tabs keeps the list mounted so its old cards hold the space.
    return <JobsList key={`${user.id}:${token}`} source={source} userId={user.id} token={token} />;
}
