import React, { useContext, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ReactPaginate from 'react-paginate';
import SessionContext from '../../auth/SessionContext';
import { SESSION_ENDED_EVENT, safeReturnPath } from '../../auth/sessionExpiry';
import { getNotificationByUserService, markReadNotificationService } from '../../service/userService';
import { getSocket } from '../../socket';
import { readJsonStorage } from '../../util/storage';
import useListQuery, { clampListPage } from '../../util/useListQuery';
import { NOTIFICATIONS_UPDATED_EVENT, notifyNotificationsUpdated } from '../../util/notificationEvents';
import StableList from '../../components/common/StableList';
import './NotificationJobs.css';
import './CandidateNotifications.css';

const PAGE_SIZE = 10;

function notificationDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN');
}

function NotificationsList({ userId, token }) {
    const navigate = useNavigate();
    const [{ page }, setQuery] = useListQuery({ page: 0 });
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [unreadCount, setUnreadCount] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    const [settledPage, setSettledPage] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [readError, setReadError] = useState('');
    const [saving, setSaving] = useState(false);
    const requestVersion = useRef(0);
    const readPending = useRef(false);
    const mounted = useRef(false);
    const busy = loading || settledPage !== page;

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        let active = true;
        const current = () => active && localStorage.getItem('token_user') === token;
        const load = async (background = false) => {
            if (background && (document.visibilityState === 'hidden' || navigator.onLine === false)) return;
            const version = ++requestVersion.current;
            if (!background) { setLoading(true); setLoadError(''); }
            try {
                const response = await getNotificationByUserService({ userId, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
                if (!current() || version !== requestVersion.current) return;
                if (response?.errCode !== 0 || response.httpStatus >= 400 || !Array.isArray(response.data)
                    || !Number.isSafeInteger(response.count) || response.count < 0
                    || !Number.isSafeInteger(response.unreadCount) || response.unreadCount < 0
                    || response.data.some(row => !row || !Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0)) {
                    throw new Error('Invalid notification list');
                }
                const validPage = clampListPage(page, response.count, PAGE_SIZE);
                if (validPage !== page) { setQuery({ page: validPage }, { replace: true }); return; }
                setRows(response.data);
                setCount(response.count);
                setUnreadCount(response.unreadCount);
                setLoadError('');
            } catch {
                if (current() && version === requestVersion.current && !background) {
                    setRows([]);
                    setCount(0);
                    setLoadError('Không tải được thông báo. Vui lòng thử lại.');
                }
            } finally {
                if (current() && version === requestVersion.current) {
                    setLoading(false);
                    setSettledPage(page);
                }
            }
        };
        load();
        const refreshList = () => load(true);
        const refreshFromOtherView = event => {
            if (event.detail?.source !== 'account') refreshList();
        };
        const interval = window.setInterval(refreshList, 30000);
        const socket = getSocket();
        const events = ['notification:new', 'notification:read', 'connect'];
        if (socket) events.forEach(event => socket.on(event, refreshList));
        document.addEventListener('visibilitychange', refreshList);
        window.addEventListener('online', refreshList);
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshFromOtherView);
        return () => {
            active = false;
            window.clearInterval(interval);
            if (socket) events.forEach(event => socket.off(event, refreshList));
            document.removeEventListener('visibilitychange', refreshList);
            window.removeEventListener('online', refreshList);
            window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshFromOtherView);
        };
    }, [userId, token, page, refresh, setQuery]);

    const markRead = async (notification) => {
        if (notification && +notification.isChecked !== 0) return true;
        if (readPending.current) return false;
        readPending.current = true;
        setSaving(true);
        setReadError('');
        try {
            const response = await markReadNotificationService({ userId, ...(notification ? { id: notification.id } : {}) });
            if (!mounted.current || localStorage.getItem('token_user') !== token) return false;
            if (response?.errCode !== 0 || response.httpStatus >= 400) throw new Error('Read failed');
            ++requestVersion.current;
            setRows(current => current.map(row => !notification || row.id === notification.id ? { ...row, isChecked: 1 } : row));
            setUnreadCount(current => notification ? Math.max(0, current - 1) : 0);
            notifyNotificationsUpdated('account');
            return true;
        } catch {
            if (mounted.current && localStorage.getItem('token_user') === token) {
                setReadError('Chưa đánh dấu được thông báo đã đọc. Vui lòng thử lại.');
            }
            return false;
        } finally {
            readPending.current = false;
            if (mounted.current) setSaving(false);
        }
    };

    const openNotification = async (event, notification, link) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (await markRead(notification)) navigate(link);
    };

    return <main className="notification-jobs candidate-notifications" aria-labelledby="candidate-notifications-title">
        <header className="notification-jobs__header">
            <span className="notification-jobs__eyebrow">TÀI KHOẢN ỨNG VIÊN</span>
            <h1 id="candidate-notifications-title">Thông báo</h1>
            <p>Tin tuyển dụng mới được duyệt từ công ty bạn theo dõi và các cập nhật dành cho tài khoản của bạn.</p>
            <nav className="notification-jobs__tabs" aria-label="Thông báo và việc làm cá nhân">
                <Link to="/candidate/notifications" aria-current="page">Thông báo</Link>
                <Link to="/candidate/followed-jobs">Việc làm từ công ty theo dõi</Link>
            </nav>
        </header>
        <div className="notification-jobs__toolbar">
            <p aria-live="polite">{busy ? 'Đang tải thông báo…' : loadError ? 'Thông báo chưa tải được' : `${count} thông báo · ${unreadCount} chưa đọc`}</p>
            <button type="button" className="candidate-notifications__read-all" disabled={busy || saving || unreadCount === 0 || !!loadError} onClick={() => markRead()}>
                {saving ? 'Đang cập nhật…' : 'Đọc tất cả'}
            </button>
        </div>
        {readError && <p className="candidate-notifications__error" role="alert">{readError}</p>}
        <StableList busy={busy} resetKey={userId} label="Đang tải thông báo…">
            {loadError ? <div className="notification-jobs__empty">
                <p role="alert">{loadError}</p>
                <button type="button" className="notification-jobs__action" onClick={() => setRefresh(value => value + 1)}>Thử lại</button>
            </div> : rows.length ? <ul className="candidate-notifications__list" aria-label="Danh sách thông báo">
                {rows.map(notification => {
                    const unread = +notification.isChecked === 0;
                    const link = safeReturnPath(notification.link, window.location.origin);
                    const date = notificationDate(notification.createdAt);
                    return <li key={notification.id} className={`candidate-notifications__item${unread ? ' is-unread' : ''}`}>
                        <span className="candidate-notifications__icon" aria-hidden="true"><i className={notification.typeCode === 'NEW_POST' ? 'fas fa-briefcase' : 'far fa-bell'} /></span>
                        <div className="candidate-notifications__details">
                            <div className="candidate-notifications__meta"><span>{unread ? 'Chưa đọc' : 'Đã đọc'}</span>{date && <time dateTime={notification.createdAt}>{date}</time>}</div>
                            {link ? <Link to={link} aria-disabled={saving || undefined} onClick={event => openNotification(event, notification, link)}>{notification.content}</Link>
                                : <p>{notification.content}</p>}
                            {!link && unread && <button type="button" disabled={saving} onClick={() => markRead(notification)}>Đánh dấu đã đọc</button>}
                        </div>
                        {link && <span className="candidate-notifications__arrow" aria-hidden="true">→</span>}
                    </li>;
                })}
            </ul> : !busy ? <div className="notification-jobs__empty">
                <span className="notification-jobs__empty-icon" aria-hidden="true"><i className="far fa-bell" /></span>
                <h2>Chưa có thông báo nào</h2>
                <p>Theo dõi công ty bạn quan tâm để nhận thông báo khi tin tuyển dụng mới của công ty được duyệt.</p>
                <Link className="notification-jobs__action" to="/company">Khám phá công ty</Link>
            </div> : null}
        </StableList>
        {!loadError && count > PAGE_SIZE && <nav className="notification-jobs__pagination" aria-label="Phân trang thông báo" aria-busy={busy}>
            <ReactPaginate forcePage={page} pageCount={Math.max(page + 1, Math.ceil(count / PAGE_SIZE))}
                previousLabel="Trước" nextLabel="Tiếp" breakLabel="…" pageRangeDisplayed={3} marginPagesDisplayed={1}
                containerClassName="pagination justify-content-center" pageClassName="page-item" pageLinkClassName="page-link"
                previousClassName="page-item" previousLinkClassName="page-link" nextClassName="page-item" nextLinkClassName="page-link"
                breakClassName="page-item" breakLinkClassName="page-link" activeClassName="active" disabledClassName="disabled"
                ariaLabelBuilder={number => `Trang ${number}`} onPageChange={({ selected }) => setQuery({ page: selected })} />
        </nav>}
    </main>;
}

export default function CandidateNotifications() {
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
        return <p role="alert" className="notification-jobs">Đăng nhập bằng tài khoản ứng viên để xem thông báo.</p>;
    }
    return <NotificationsList key={`${user.id}:${token}`} userId={user.id} token={token} />;
}
