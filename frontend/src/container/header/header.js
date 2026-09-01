import React from 'react'
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom'
import './header.scss';
import { getNotificationByUserService, markReadNotificationService, getListChatConversationService } from '../../service/userService';
import { getSocket, disconnectSocket } from '../../socket';
import { readJsonStorage } from '../../util/storage';
import { hasPermission, PERMISSIONS } from '../../auth/accessControl';
import SessionContext from '../../auth/SessionContext';

const Header = () => {
    const sessionUser = useContext(SessionContext)
    const user = useMemo(
        () => sessionUser || readJsonStorage('userData'),
        [sessionUser]
    )
    const [listNotification, setListNotification] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [unreadChat, setUnreadChat] = useState(0)
    const [showNotification, setShowNotification] = useState(false)
    const [showProfileMenu, setShowProfileMenu] = useState(false)
    const [showMobileMenu, setShowMobileMenu] = useState(false)
    const [showMobileNotifications, setShowMobileNotifications] = useState(false)
    const notificationRef = useRef(null)
    const profileRef = useRef(null)
    const mobileMenuRef = useRef(null)
    const isCandidate = user?.roleCode === 'CANDIDATE'
    const canUseChat = hasPermission(user, PERMISSIONS.USE_CHAT)
    const profilePath = isCandidate ? '/candidate/info' : '/admin/user-info/'
    const passwordPath = isCandidate ? '/candidate/changepassword/' : '/admin/changepassword/'

    useEffect(() => {
        if (!user || !user.id) return

        const loadHeaderData = async () => {
            const [notificationResult, chatResult] = await Promise.allSettled([
                getNotificationByUserService({ userId: user.id, limit: 10, offset: 0 }),
                canUseChat ? getListChatConversationService() : Promise.resolve(null)
            ])
            const notificationRes = notificationResult.status === 'fulfilled' ? notificationResult.value : null
            const chatRes = chatResult.status === 'fulfilled' ? chatResult.value : null
            if (notificationRes && notificationRes.errCode === 0) {
                setListNotification(notificationRes.data || [])
                setUnreadCount(notificationRes.unreadCount || 0)
            }
            if (chatRes && chatRes.errCode === 0) {
                setUnreadChat(chatRes.totalUnread || 0)
            }
        }

        loadHeaderData()
        const intervalId = window.setInterval(loadHeaderData, 30000)

        // Co tin nhan / thong bao moi thi cap nhat so badge ngay, khong doi
        // het 30 giay. Van giu interval lam phuong an du phong khi socket hong.
        const socket = getSocket()
        const refresh = () => loadHeaderData()
        if (socket) {
            if (canUseChat) socket.on('chat:new-message', refresh)
            socket.on('notification:new', refresh)
        }

        return () => {
            window.clearInterval(intervalId)
            if (socket) {
                if (canUseChat) socket.off('chat:new-message', refresh)
                socket.off('notification:new', refresh)
            }
        }
    }, [user, canUseChat])

    let handleLogout = () => {
        disconnectSocket()
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
            setListNotification(current => current.map(item => ({ ...item, isChecked: 1 })))
            setUnreadCount(0)
        }
    }

    const handleClickNotification = async (notification) => {
        if (+notification.isChecked === 0) {
            await markReadNotificationService({ userId: user.id, id: notification.id })
            setListNotification(current => current.map(item => item.id === notification.id ? { ...item, isChecked: 1 } : item))
            setUnreadCount(current => Math.max(0, current - 1))
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
                        <div className="container">
                            <div className="row align-items-center">
                                <div className="col-lg-3 col-md-2">
                                    {/* <!-- Logo --> */}
                                    <div className="logo" style={{ zIndex: 1 }}>
                                        <NavLink to="/"><img src="/assets/img/logo/logo.png" alt="" /></NavLink>
                                    </div>
                                </div>
                                <div className="col-lg-9 col-md-9">
                                    <div className="menu-wrapper">
                                        {/* <!-- Main-menu --> */}
                                        <div className="main-menu">
                                            <nav className="d-none d-lg-block">
                                                <ul id="navigation">
                                                    <li ><NavLink to="/" onClick={() => window.scrollTo(0, 0)}>Trang chủ</NavLink></li>
                                                    <li ><NavLink to="/job" onClick={() => window.scrollTo(0, 0)}>Việc làm </NavLink></li>
                                                    <li ><NavLink to="/company" onClick={() => window.scrollTo(0, 0)}>Công ty </NavLink></li>
                                                    <li ><NavLink to="/about" onClick={() => window.scrollTo(0, 0)}>Giới thiệu</NavLink></li>
                                                    <li><NavLink to="/contact" onClick={() => window.scrollTo(0, 0)}>Liên hệ</NavLink></li>
                                                </ul>
                                            </nav>
                                        </div>
                                        {/* <!-- Header-btn --> */}
                                        {/* Bootstrap dat .navbar-nav { flex-direction: column } nen o ul ben duoi
                                            phai chi dinh flexDirection: 'row', neu khong 3 muc (chat / thong bao /
                                            ten user) se xep chong len nhau theo chieu doc. */}
                                        <div className="header-btn d-none f-right d-lg-block">
                                            {user ?
                                                <ul className="navbar-nav navbar-nav-right" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 0 }}>
                                                    {canUseChat && <li className="nav-item" style={{ position: 'relative', marginRight: '18px' }}>
                                                        <Link aria-label="Tin nhắn" to="/chat" style={{ color: '#252b60', fontSize: '18px', position: 'relative' }}>
                                                            <i className="far fa-comment-dots"></i>
                                                            {unreadChat > 0 &&
                                                                <span style={{ position: 'absolute', top: '-8px', right: '-10px', background: '#fb246a', color: '#fff', borderRadius: '50%', fontSize: '10px', padding: '1px 5px' }}>{unreadChat}</span>
                                                            }
                                                        </Link>
                                                    </li>}
                                                    <li ref={notificationRef} className="nav-item" style={{ position: 'relative', marginRight: '10px' }}>
                                                        <button type="button" aria-label="Thông báo" aria-expanded={showNotification} aria-controls="public-notification-menu" style={{ color: '#252b60', fontSize: '18px', position: 'relative', cursor: 'pointer', border: 0, background: 'none', padding: 0 }} onClick={toggleNotificationMenu}>
                                                            <i className="far fa-bell"></i>
                                                            {unreadCount > 0 &&
                                                                <span style={{ position: 'absolute', top: '-8px', right: '-10px', background: '#fb246a', color: '#fff', borderRadius: '50%', fontSize: '10px', padding: '1px 5px' }}>{unreadCount}</span>
                                                            }
                                                        </button>
                                                        {showNotification &&
                                                            <div id="public-notification-menu" style={{ position: 'absolute', top: '35px', right: '-50px', width: '330px', background: '#fff', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 999, maxHeight: '400px', overflowY: 'auto' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }}>
                                                                    <b style={{ color: '#333' }}>Thông báo</b>
                                                                    <button type="button" style={{ fontSize: '12px', color: '#fb246a', cursor: 'pointer', border: 0, background: 'none', padding: 0 }} onClick={() => handleReadAll()}>Đọc tất cả</button>
                                                                </div>
                                                                {listNotification && listNotification.length > 0 ? listNotification.map((item, index) => (
                                                                    <div key={index} onClick={() => handleClickNotification(item)}
                                                                        style={{ padding: '10px 14px', borderBottom: '1px solid #f7f7f7', cursor: 'pointer', background: +item.isChecked === 0 ? '#fff5f8' : '#fff' }}>
                                                                        <div style={{ fontSize: '13px', color: '#333' }}>{item.content}</div>
                                                                    </div>
                                                                )) :
                                                                    <div style={{ padding: '18px', textAlign: 'center', color: '#999', fontSize: '13px' }}>Chưa có thông báo nào</div>
                                                                }
                                                            </div>
                                                        }
                                                    </li>
                                                    <li ref={profileRef} className="nav-item nav-profile dropdown">
                                                        <button type="button" className="nav-link dropdown-toggle box-header-profile" id="profileDropdown" aria-haspopup="menu" aria-expanded={showProfileMenu} aria-controls="public-profile-menu" onClick={toggleProfileMenu} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
                                                            <img style={{ objectFit: 'cover', width: '30px', height: '30px', borderRadius: '50%', marginLeft: '15px' }} src={user.image} alt="profile" />
                                                            <span className='header-name-user'>{user.firstName + " " + user.lastName}</span>
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
                                                            {isCandidate && <Link to='/candidate/usersetting' className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-solid fa-bars text-primary" />
                                                                Cài đặt nâng cao
                                                            </Link>}
                                                            {isCandidate && <Link to="/candidate/cv-post/" className="dropdown-item" onClick={closeHeaderMenus}>
                                                                <i className="far fa-file-word text-primary"></i>
                                                                Công việc đã nộp
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
                                                            <button type="button" onClick={() => handleLogout()} className="dropdown-item">
                                                                <i className="ti-power-off text-primary" />
                                                                Đăng xuất
                                                            </button>
                                                        </div>
                                                    </li>
                                                </ul>
                                                :
                                                <>
                                                    <Link to={'/register'} className="btn head-btn1">Đăng kí</Link>
                                                    <Link to={'/login'} className="btn head-btn2">Đăng nhập</Link>
                                                </>
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
                                                <li><NavLink to="/" onClick={closeHeaderMenus}>Trang chủ</NavLink></li>
                                                <li><NavLink to="/job" onClick={closeHeaderMenus}>Việc làm</NavLink></li>
                                                <li><NavLink to="/company" onClick={closeHeaderMenus}>Công ty</NavLink></li>
                                                <li><NavLink to="/about" onClick={closeHeaderMenus}>Giới thiệu</NavLink></li>
                                                <li><NavLink to="/contact" onClick={closeHeaderMenus}>Liên hệ</NavLink></li>
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
                                                                </div>
                                                            )}
                                                        </li>
                                                        <li><Link to={profilePath} onClick={closeHeaderMenus}>Thông tin tài khoản</Link></li>
                                                        {isCandidate && <li><Link to="/candidate/usersetting" onClick={closeHeaderMenus}>Cài đặt nâng cao</Link></li>}
                                                        {isCandidate && <li><Link to="/candidate/cv-post/" onClick={closeHeaderMenus}>Công việc đã nộp</Link></li>}
                                                        {canUseChat && <li><Link to="/chat" onClick={closeHeaderMenus}>Tin nhắn{unreadChat > 0 ? ` (${unreadChat})` : ''}</Link></li>}
                                                        {isCandidate && <li><Link to="/candidate/saved-jobs/" onClick={closeHeaderMenus}>Việc làm đã lưu</Link></li>}
                                                        <li><Link to={passwordPath} onClick={closeHeaderMenus}>Đổi mật khẩu</Link></li>
                                                        <li><button type="button" className="public-mobile-menu-link public-mobile-menu-logout" onClick={handleLogout}>Đăng xuất</button></li>
                                                    </>
                                                ) : (
                                                    <>
                                                        <li className="public-mobile-menu-divider" />
                                                        <li><Link to="/register" onClick={closeHeaderMenus}>Đăng kí</Link></li>
                                                        <li><Link to="/login" onClick={closeHeaderMenus}>Đăng nhập</Link></li>
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

        </>
    )
}

export default Header
