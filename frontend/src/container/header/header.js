import { logoutServer } from '../../auth/authClient';
import { clearPushOnLogout } from '../../push/webPush';
import { candidateAiEnabled } from '../../service/candidateWorkspace';
import React from 'react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, matchPath, useLocation } from 'react-router-dom'
import './header.scss';
import { getNotificationByUserService, markReadNotificationService, getListChatConversationService } from '../../service/userService';
import {
    clearRewardOverviewCache,
    getCachedCandidateRewardOverview,
    getCandidateRewardOverviewService,
    REWARD_WALLET_UPDATED_EVENT,
    setCachedCandidateRewardOverview,
} from '../../service/rewardPaymentService';
import PointTopupModal from '../../components/payment/PointTopupModal';
import { getSocket, disconnectSocket } from '../../socket';
import { readJsonStorage } from '../../util/storage';
import { hasPermission, PERMISSIONS } from '../../auth/accessControl';
import SessionContext from '../../auth/SessionContext';
import ChatAvatar from '../Chat/ChatAvatar';
import { NOTIFICATIONS_UPDATED_EVENT, notifyNotificationsUpdated } from '../../util/notificationEvents';
import { prefetchJobLanding } from '../JobPage/jobPageResource';
import { prefetchCompanies } from '../Company/companyResource';

const navigationItems = [
    { to: '/', label: 'Trang chủ', paths: ['/'] },
    { to: '/job', label: 'Việc làm', paths: ['/job', '/detail-job/:id', '/external-job/:id'] },
    { to: '/company', label: 'Công ty', paths: ['/company', '/detail-company/:id'] },
    { to: '/about', label: 'Giới thiệu', paths: ['/about'] },
    { to: '/contact', label: 'Liên hệ', paths: ['/contact'] },
]

const prefetchPublicRoute = (to) => {
    if (to === '/job') prefetchJobLanding()
    else if (to === '/company') prefetchCompanies()
}

const NavigationLinks = React.memo(({ onNavigate }) => {
    const { pathname } = useLocation()
    return navigationItems.map(({ to, label, paths }) => {
        const isActive = paths.some(path => matchPath({ path, end: path === '/' }, pathname))
        const warmRoute = () => prefetchPublicRoute(to)
        return (
            <li key={to}>
                <Link
                    to={to}
                    className="public-nav-link"
                    aria-current={isActive ? 'page' : undefined}
                    onMouseEnter={warmRoute}
                    onTouchStart={warmRoute}
                    onClick={onNavigate}
                >
                    {label}
                </Link>
            </li>
        )
    })
})

let cachedPublicHeaderState = {
    userId: null,
    listNotification: [],
    unreadCount: 0,
    unreadChat: 0,
    fetchedAt: 0,
};

const Header = () => {
    const sessionUser = useContext(SessionContext)
    const user = useMemo(
        () => sessionUser || readJsonStorage('userData'),
        [sessionUser]
    )
    const userId = user?.id || null
    const warmHeader =
        process.env.NODE_ENV !== 'test' && userId && cachedPublicHeaderState.userId === userId
            ? cachedPublicHeaderState
            : null
    const [listNotification, setListNotification] = useState(() => warmHeader?.listNotification || [])
    const [unreadCount, setUnreadCount] = useState(() => warmHeader?.unreadCount || 0)
    const [unreadChat, setUnreadChat] = useState(() => warmHeader?.unreadChat || 0)
    const [showNotification, setShowNotification] = useState(false)
    const [showProfileMenu, setShowProfileMenu] = useState(false)
    const [showMobileMenu, setShowMobileMenu] = useState(false)
    const [showMobileNotifications, setShowMobileNotifications] = useState(false)
    const [rewardOverview, setRewardOverview] = useState(() => getCachedCandidateRewardOverview())
    const [showTopupModal, setShowTopupModal] = useState(false)
    const notificationRef = useRef(null)
    const profileRef = useRef(null)
    const mobileMenuRef = useRef(null)
    const refreshVersion = useRef(0)
    const isCandidate = user?.roleCode === 'CANDIDATE'
    const canUseChat = hasPermission(user, PERMISSIONS.USE_CHAT)
    const profilePath = isCandidate ? '/candidate/info' : '/admin/user-info/'
    const passwordPath = isCandidate ? '/candidate/changepassword/' : '/admin/changepassword/'

    useEffect(() => {
        if (!userId || !isCandidate) {
            setRewardOverview(null)
            return undefined
        }
        let active = true
        const loadRewardWallet = async () => {
            try {
                const res = await getCandidateRewardOverviewService()
                if (active && res && res.errCode === 0 && res.data) {
                    setCachedCandidateRewardOverview(res.data)
                    setRewardOverview(res.data)
                }
            } catch (_err) {
                // Ignore if unmocked in tests or offline
            }
        }
        loadRewardWallet()
        window.addEventListener(REWARD_WALLET_UPDATED_EVENT, loadRewardWallet)
        return () => {
            active = false
            window.removeEventListener(REWARD_WALLET_UPDATED_EVENT, loadRewardWallet)
        }
    }, [userId, isCandidate])

    useEffect(() => {
        if (!userId) return
        let active = true
        const loadHeaderData = async () => {
            if (document.visibilityState === 'hidden' || navigator.onLine === false) return
            const version = ++refreshVersion.current
            const [notificationResult, chatResult] = await Promise.allSettled([
                getNotificationByUserService({ userId, limit: 10, offset: 0 }),
                canUseChat ? getListChatConversationService() : Promise.resolve(null)
            ])
            if (!active || version !== refreshVersion.current) return
            const notificationRes = notificationResult.status === 'fulfilled' ? notificationResult.value : null
            const chatRes = chatResult.status === 'fulfilled' ? chatResult.value : null
            let nextList = cachedPublicHeaderState.listNotification
            let nextUnread = cachedPublicHeaderState.unreadCount
            let nextChat = cachedPublicHeaderState.unreadChat
            if (notificationRes && notificationRes.errCode === 0) {
                nextList = notificationRes.data || []
                nextUnread = notificationRes.unreadCount || 0
                setListNotification(nextList)
                setUnreadCount(nextUnread)
            }
            if (chatRes && chatRes.errCode === 0) {
                nextChat = chatRes.totalUnread || 0
                setUnreadChat(nextChat)
            }
            if (process.env.NODE_ENV !== 'test') {
                cachedPublicHeaderState = {
                    userId,
                    listNotification: nextList,
                    unreadCount: nextUnread,
                    unreadChat: nextChat,
                    fetchedAt: Date.now(),
                }
            }
        }

        // Tranh goi lai API ngay lap tuc khi Header remount giua cac route cong khai va route guard trong cung 10s.
        const recentlyFetched =
            process.env.NODE_ENV !== 'test' &&
            cachedPublicHeaderState.userId === userId &&
            Date.now() - cachedPublicHeaderState.fetchedAt < 10000
        if (!recentlyFetched) {
            loadHeaderData()
        }
        const intervalId = window.setInterval(loadHeaderData, 30000)

        // Co tin nhan / thong bao moi thi cap nhat so badge ngay, khong doi
        // het 30 giay. Van giu interval lam phuong an du phong khi socket hong.
        const socket = getSocket()
        const refresh = () => loadHeaderData()
        const refreshFromOtherView = event => {
            if (event.detail?.source !== 'header') refresh()
        }
        if (socket) {
            if (canUseChat) { socket.on('chat:new-message', refresh); socket.on('chat:read', refresh) }
            socket.on('notification:new', refresh)
            socket.on('notification:read', refresh)
            socket.on('connect', refresh)
        }
        document.addEventListener('visibilitychange', refresh)
        window.addEventListener('online', refresh)
        window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshFromOtherView)

        return () => {
            active = false
            window.clearInterval(intervalId)
            document.removeEventListener('visibilitychange', refresh)
            window.removeEventListener('online', refresh)
            window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, refreshFromOtherView)
            if (socket) {
                if (canUseChat) { socket.off('chat:new-message', refresh); socket.off('chat:read', refresh) }
                socket.off('notification:new', refresh)
                socket.off('notification:read', refresh)
                socket.off('connect', refresh)
            }
        }
    }, [userId, canUseChat])

    let handleLogout = async () => {
        const cleanup=clearPushOnLogout();
        if(cleanup)await cleanup;
        try { await logoutServer(); } catch { window.alert('Chưa xác nhận được đăng xuất trên máy chủ. Vui lòng kiểm tra kết nối và thử lại.'); return; }
        disconnectSocket()
        clearRewardOverviewCache()
        localStorage.removeItem("userData");
        localStorage.removeItem("token_user")
        window.location.href = "/login"
    }

    const closeHeaderMenus = useCallback(() => {
        setShowNotification(false)
        setShowProfileMenu(false)
        setShowMobileMenu(false)
        setShowMobileNotifications(false)
    }, [])

    const handleScrollTop = useCallback(() => {
        window.scrollTo(0, 0)
    }, [])

    const openTopupModal = useCallback(() => {
        setShowNotification(false)
        setShowProfileMenu(false)
        setShowMobileMenu(false)
        setShowMobileNotifications(false)
        setShowTopupModal(true)
    }, [])

    const closeTopupModal = useCallback(() => {
        setShowTopupModal(false)
    }, [])

    // Các menu do React điều khiển để không phụ thuộc vào script Bootstrap chạy
    // trước khi giao diện được render. Bấm ra ngoài hoặc nhấn Esc đều đóng menu.
    useEffect(() => {
        if (!showNotification && !showProfileMenu && !showMobileMenu) return

        const closeMenusWhenClickOutside = (event) => {
            const clickedInsideHeaderMenu = [notificationRef, profileRef, mobileMenuRef]
                .some(ref => ref.current && ref.current.contains(event.target))
            if (!clickedInsideHeaderMenu) closeHeaderMenus()
        }
        const closeMenusWithEscape = (event) => {
            if (event.key === 'Escape') closeHeaderMenus()
        }

        document.addEventListener('mousedown', closeMenusWhenClickOutside)
        document.addEventListener('keydown', closeMenusWithEscape)
        return () => {
            document.removeEventListener('mousedown', closeMenusWhenClickOutside)
            document.removeEventListener('keydown', closeMenusWithEscape)
        }
    }, [showNotification, showProfileMenu, showMobileMenu, closeHeaderMenus])

    const toggleNotificationMenu = () => {
        setShowNotification(current => !current)
        setShowProfileMenu(false)
    }

    const toggleProfileMenu = () => {
        setShowProfileMenu(current => !current)
        setShowNotification(false)
    }

    const toggleMobileMenu = () => {
        setShowMobileMenu(current => !current)
        setShowMobileNotifications(false)
        setShowNotification(false)
        setShowProfileMenu(false)
    }

    const handleReadAll = async () => {
        const res = await markReadNotificationService({ userId: user.id })
        if (res && res.errCode === 0) {
            ++refreshVersion.current
            setListNotification(current => current.map(item => ({ ...item, isChecked: 1 })))
            setUnreadCount(0)
            notifyNotificationsUpdated('header')
        }
    }

    const handleClickNotification = async (notification) => {
        if (+notification.isChecked === 0) {
            const result = await markReadNotificationService({ userId: user.id, id: notification.id })
            if (result?.errCode === 0) {
                ++refreshVersion.current
                setListNotification(current => current.map(item => item.id === notification.id ? { ...item, isChecked: 1 } : item))
                setUnreadCount(current => Math.max(0, current - 1))
                notifyNotificationsUpdated('header')
            }
        }
        setShowNotification(false)
        setShowMobileNotifications(false)
        setShowMobileMenu(false)
        if (notification.link) window.location.href = notification.link
    }

    return (
        <>
            <header className="public-header-shell" data-testid="public-header-shell">
                {/* <!-- Header Start --> */}
                <div className="header-area header-transparrent" data-testid="public-header-area">
                    <div className="headder-top header-sticky">
                        <div className="container public-header-container">
                            <div className="row align-items-center public-header-row">
                                <div className="col-lg-auto col-md-3 public-header-logo-col">
                                    {/* <!-- Logo --> */}
                                    <div className="logo" style={{ zIndex: 1 }}>
                                        <NavLink to="/">
                                            <img
                                                src="/assets/img/logo/logo.svg"
                                                alt="Job Finder"
                                                width="204"
                                                height="64"
                                                decoding="async"
                                            />
                                        </NavLink>
                                    </div>
                                </div>
                                <div className="col-lg col-md-9 public-header-menu-col">
                                    <div className="menu-wrapper">
                                        {/* <!-- Main-menu --> */}
                                        <div className="main-menu">
                                            <nav className="d-none d-lg-block" aria-label="Điều hướng chính">
                                                <ul id="navigation">
                                                    <NavigationLinks onNavigate={handleScrollTop} />
                                                </ul>
                                            </nav>
                                        </div>
                                        {/* <!-- Header-btn --> */}
                                        <div className="header-btn d-none f-right d-lg-block">
                                            {user ?
                                                <ul className="navbar-nav navbar-nav-right public-header-actions">
                                                    {isCandidate && (
                                                        <li className="nav-item public-header-action-item">
                                                            <button
                                                                type="button"
                                                                className="public-header-wallet-btn"
                                                                onClick={openTopupModal}
                                                            >
                                                                <i className="fas fa-coins public-header-wallet-btn__icon" aria-hidden="true" />
                                                                <span className="public-header-wallet-btn__balance">
                                                                    {rewardOverview?.wallet
                                                                        ? `${Number(rewardOverview.wallet.balancePoints || 0).toLocaleString('vi-VN')} điểm`
                                                                        : 'Ví điểm'}
                                                                </span>
                                                                <span className="public-header-wallet-btn__cta">
                                                                    + Nạp
                                                                </span>
                                                            </button>
                                                        </li>
                                                    )}
                                                    {canUseChat && (
                                                        <li className="nav-item public-header-action-item">
                                                            <Link aria-label="Tin nhắn" to="/chat" className="public-header-icon-btn">
                                                                <i className="far fa-comment-dots" aria-hidden="true"></i>
                                                                {unreadChat > 0 && (
                                                                    <span className="public-header-badge">{unreadChat}</span>
                                                                )}
                                                            </Link>
                                                        </li>
                                                    )}
                                                    <li ref={notificationRef} className="nav-item public-header-action-item">
                                                        <button
                                                            type="button"
                                                            aria-label="Thông báo"
                                                            aria-expanded={showNotification}
                                                            aria-controls="public-notification-menu"
                                                            className="public-header-icon-btn"
                                                            onClick={toggleNotificationMenu}
                                                        >
                                                            <i className="far fa-bell" aria-hidden="true"></i>
                                                            {unreadCount > 0 && (
                                                                <span className="public-header-badge">{unreadCount}</span>
                                                            )}
                                                        </button>
                                                        {showNotification && (
                                                            <div id="public-notification-menu" className="public-notification-dropdown">
                                                                <div className="public-notification-dropdown__head">
                                                                    <b>Thông báo</b>
                                                                    <button type="button" onClick={() => handleReadAll()}>Đọc tất cả</button>
                                                                </div>
                                                                {listNotification && listNotification.length > 0 ? listNotification.map((item, index) => (
                                                                    <div
                                                                        key={index}
                                                                        onClick={() => handleClickNotification(item)}
                                                                        className={`public-notification-dropdown__item${+item.isChecked === 0 ? ' is-unread' : ''}`}
                                                                    >
                                                                        <div>{item.content}</div>
                                                                    </div>
                                                                )) : (
                                                                    <div className="public-notification-dropdown__empty">Chưa có thông báo nào</div>
                                                                )}
                                                                {isCandidate && (
                                                                    <Link to="/candidate/notifications" onClick={closeHeaderMenus} className="public-notification-dropdown__footer">
                                                                        Xem tất cả thông báo
                                                                    </Link>
                                                                )}
                                                            </div>
                                                        )}
                                                    </li>
                                                    <li ref={profileRef} className="nav-item nav-profile dropdown public-header-action-item">
                                                        <button
                                                            type="button"
                                                            className="nav-link dropdown-toggle box-header-profile"
                                                            id="profileDropdown"
                                                            aria-haspopup="menu"
                                                            aria-expanded={showProfileMenu}
                                                            aria-controls="public-profile-menu"
                                                            onClick={toggleProfileMenu}
                                                        >
                                                            <ChatAvatar
                                                                style={{ objectFit: 'cover', width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0 }}
                                                                src={user.image}
                                                                name={user.firstName}
                                                                alt=""
                                                            />
                                                            <span className="header-name-user">{[user.firstName, user.lastName].filter(Boolean).join(' ')}</span>
                                                        </button>
                                                        <div
                                                            id="public-profile-menu"
                                                            className={`dropdown-menu dropdown-menu-right navbar-dropdown${showProfileMenu ? ' show' : ''}`}
                                                            aria-labelledby="profileDropdown"
                                                            style={{ position: 'absolute', top: '100%', right: 0, left: 'auto' }}
                                                        >
                                                            <Link to={profilePath} className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-user text-primary" />
                                                                Thông tin
                                                            </Link>
                                                            {isCandidate && (
                                                                <button
                                                                    type="button"
                                                                    className="dropdown-item"
                                                                    onClick={openTopupModal}
                                                                >
                                                                    <i className="fas fa-coins text-primary" />
                                                                    Nạp điểm tài khoản
                                                                </button>
                                                            )}
                                                            {isCandidate && <Link to="/candidate/notifications" className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-bell text-primary" />
                                                                Thông báo tài khoản
                                                            </Link>}
                                                            {isCandidate && <Link to='/candidate/usersetting' className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-solid fa-bars text-primary" />
                                                                Cài đặt nâng cao
                                                            </Link>}
                                                            {isCandidate && candidateAiEnabled() && <Link to="/candidate/ai-cv" className="dropdown-item" onClick={closeHeaderMenus}>CV và trợ lý AI</Link>}
                                                            {isCandidate && <Link to="/candidate/cv-post/" className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-file-word text-primary"></i>
                                                                Công việc đã nộp
                                                            </Link>}
                                                            {isCandidate && <Link to="/candidate/interviews" className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-calendar-alt text-primary" aria-hidden="true" />
                                                                Lịch phỏng vấn
                                                            </Link>}
                                                            {canUseChat && <Link to="/chat" className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-comment-dots text-primary"></i>
                                                                Tin nhắn
                                                            </Link>}
                                                            {isCandidate && <Link to="/candidate/saved-jobs/" className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-heart text-primary"></i>
                                                                Việc làm đã lưu
                                                            </Link>}
                                                            <Link to={passwordPath} className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="ti-settings text-primary" />
                                                                Đổi mật khẩu
                                                            </Link>
                                                            <Link className="dropdown-item" to="/account/security">Bảo mật và đăng nhập</Link>
                                                            <button type="button" onClick={() => handleLogout()} className="dropdown-item">
                                                                <i className="ti-power-off text-primary" />
                                                                Đăng xuất
                                                            </button>
                                                        </div>
                                                    </li>
                                                </ul>
                                                :
                                                <div className="public-auth-links">
                                                    <NavLink to="/register" className="public-auth-link">Đăng kí</NavLink>
                                                    <NavLink to="/login" className="public-auth-link">Đăng nhập</NavLink>
                                                </div>
                                            }


                                        </div>
                                    </div>
                                </div>
                                {/* <!-- Mobile Menu --> */}
                                <div className="col-12 d-block d-lg-none public-mobile-nav" ref={mobileMenuRef}>
                                    <button
                                        type="button"
                                        className="public-mobile-menu-toggle"
                                        aria-expanded={showMobileMenu}
                                        aria-controls="public-mobile-menu"
                                        onClick={toggleMobileMenu}
                                    >
                                        <span>Menu</span>
                                        <i className={showMobileMenu ? "fas fa-times" : "fas fa-bars"} />
                                    </button>
                                    {showMobileMenu && (
                                        <nav id="public-mobile-menu" className="public-mobile-menu-panel" aria-label="Điều hướng di động">
                                            <ul>
                                                <NavigationLinks onNavigate={closeHeaderMenus} />
                                                {user ? (
                                                    <>
                                                        <li className="public-mobile-menu-divider" />
                                                        <li>
                                                            <button
                                                                type="button"
                                                                className="public-mobile-menu-link"
                                                                aria-expanded={showMobileNotifications}
                                                                onClick={() => setShowMobileNotifications(current => !current)}
                                                            >
                                                                Thông báo{unreadCount > 0 ? ` (${unreadCount})` : ''}
                                                            </button>
                                                            {showMobileNotifications && (
                                                                <div className="public-mobile-notifications">
                                                                    <div className="public-mobile-notifications__header">
                                                                        <strong>Thông báo</strong>
                                                                        {unreadCount > 0 && <button type="button" onClick={handleReadAll}>Đọc tất cả</button>}
                                                                    </div>
                                                                    {listNotification.length > 0 ? listNotification.map(item => (
                                                                        <button key={item.id} type="button" className={+item.isChecked === 0 ? 'is-unread' : ''} onClick={() => handleClickNotification(item)}>
                                                                            {item.content}
                                                                        </button>
                                                                    )) : <span>Chưa có thông báo nào</span>}
                                                                    {isCandidate && <Link to="/candidate/notifications" onClick={closeHeaderMenus}>Xem tất cả thông báo</Link>}
                                                                </div>
                                                            )}
                                                        </li>
                                                        <li><Link to={profilePath} onClick={closeHeaderMenus}>Thông tin tài khoản</Link></li>
                                                        {isCandidate && (
                                                            <li>
                                                                <button
                                                                    type="button"
                                                                    className="public-mobile-menu-link"
                                                                    onClick={openTopupModal}
                                                                >
                                                                    Nạp điểm tài khoản
                                                                </button>
                                                            </li>
                                                        )}
                                                        {isCandidate && <li><Link to="/candidate/notifications" onClick={closeHeaderMenus}>Thông báo tài khoản</Link></li>}
                                                        {isCandidate && <li><Link to="/candidate/usersetting" onClick={closeHeaderMenus}>Cài đặt nâng cao</Link></li>}
                                                        {isCandidate && candidateAiEnabled() && <li><Link to="/candidate/ai-cv" onClick={closeHeaderMenus}>CV và trợ lý AI</Link></li>}
                                                        {isCandidate && <li><Link to="/candidate/cv-post/" onClick={closeHeaderMenus}>Công việc đã nộp</Link></li>}
                                                        {isCandidate && <li><Link to="/candidate/interviews" onClick={closeHeaderMenus}>Lịch phỏng vấn</Link></li>}
                                                        {canUseChat && <li><Link to="/chat" onClick={closeHeaderMenus}>Tin nhắn{unreadChat > 0 ? ` (${unreadChat})` : ''}</Link></li>}
                                                        {isCandidate && <li><Link to="/candidate/saved-jobs/" onClick={closeHeaderMenus}>Việc làm đã lưu</Link></li>}
                                                        <li><Link to={passwordPath} onClick={closeHeaderMenus}>Đổi mật khẩu</Link></li>
                                                        <li><button type="button" className="public-mobile-menu-link public-mobile-menu-logout" onClick={handleLogout}>Đăng xuất</button></li>
                                                    </>
                                                ) : (
                                                    <>
                                                        <li className="public-mobile-menu-divider" />
                                                        <li><NavLink to="/register" className="public-auth-mobile-link" onClick={closeHeaderMenus}>Đăng kí</NavLink></li>
                                                        <li><NavLink to="/login" className="public-auth-mobile-link" onClick={closeHeaderMenus}>Đăng nhập</NavLink></li>
                                                    </>
                                                )}
                                            </ul>
                                        </nav>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* <!-- Header End --> */}
            </header >
            {isCandidate && showTopupModal && (
                <PointTopupModal
                    isOpen
                    onClose={closeTopupModal}
                    walletData={rewardOverview}
                />
            )}
        </>
    )
}

export default Header
