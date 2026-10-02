import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react';
import { getListChatConversationService } from '../../service/userService';
import { getSocket } from '../../socket';
import { hasPermission, PERMISSIONS } from '../../auth/accessControl';
import { readJsonStorage } from '../../util/storage';
import { getAdminNavigation, normalizePath, resolveAdminPage } from './adminNavigation';
import { useAdminAttention } from './adminAttention';

// Keep compact-menu flyouts inside the viewport while the navigation itself
// scrolls. Fixed positioning also lets them extend beyond the 70px scrollport.
const positionCollapsedFlyout = (item) => {
    if (!item || !document.body.classList.contains('sidebar-icon-only') || window.innerWidth < 992) return;
    const bounds = item.getBoundingClientRect();
    const submenuHeight = item.querySelector('.jf-submenu')?.scrollHeight || 0;
    const top = Math.max(60, Math.min(bounds.top, window.innerHeight - bounds.height - submenuHeight - 8));
    item.style.setProperty('--admin-flyout-top', `${top}px`);
    item.style.setProperty('--admin-flyout-header-height', `${bounds.height}px`);
};
const anchorFlyout = (event) => positionCollapsedFlyout(event.currentTarget);
const refreshCollapsedFlyouts = (navigation) => {
    if (!navigation) return;
    positionCollapsedFlyout(navigation.querySelector(':scope > .nav > .nav-item:hover'));
    positionCollapsedFlyout(navigation.querySelector(':scope > .nav > .nav-item:focus-within'));
};

/**
 * Menu khu quan tri.
 *
 * Truoc day menu dung co che collapse cua Bootstrap (data-toggle="collapse" +
 * href="#id"). Cach do gay 2 loi:
 *
 *   1. Nhieu nhom dung TRUNG id (#post dung 4 lan, #company dung 3 lan). Bootstrap
 *      tim phan tu theo id nen bam mot nhom lam nhieu nhom cung bung ra/dong lai.
 *   2. Khong co data-parent nen cac nhom da mo khong tu dong dong lai, bam mai
 *      thi ca menu bung het, khong biet dang o muc nao.
 *
 * Nay chuyen sang React tu quan ly: chi MOT nhom duoc mo tai mot thoi diem, va
 * muc dang xem duoc to sang dua theo duong dan hien tai. Hien/an bang inline
 * style chu khong dua vao class .collapse/.show, vi bo CSS cua theme khong dinh
 * nghia san hai class do.
 */

// Cau truc menu (section, nhom, muc, quyen) nam trong adminNavigation.js, dung
// chung voi breadcrumb va tieu de trang.

const formatBadge = (value) => (value > 99 ? '99+' : String(value));

const MenuBadge = ({ value, label }) => (value > 0
    ? <span className="jf-nav-badge" title={`${value} ${label}`}>{formatBadge(value)}</span>
    : null);

const BADGE_LABELS = {
    unreadChat: 'tin nhắn chưa đọc',
    pendingPosts: 'tin chờ duyệt',
    pendingCompanies: 'công ty chờ duyệt',
    waitingSupport: 'yêu cầu chờ tiếp nhận',
};

const Menu = ({ user: suppliedUser }) => {
    const location = useLocation()
    const navigationRef = useRef(null)
    const user = useMemo(
        () => suppliedUser || readJsonStorage('userData'),
        [suppliedUser]
    )
    const [unreadChat, setUnreadChat] = useState(0)
    const [openKey, setOpenKey] = useState(null)
    const canUseChat = hasPermission(user, PERMISSIONS.USE_CHAT)

    useEffect(() => {
        const reposition = () => refreshCollapsedFlyouts(navigationRef.current);
        window.addEventListener('resize', reposition);
        return () => window.removeEventListener('resize', reposition);
    }, []);

    // Dem tin nhan chua doc cho muc "Tin nhan".
    useEffect(() => {
        if (!user || !user.id || !canUseChat) return
        let active = true, version = 0
        const loadUnread = async () => {
            if (document.visibilityState === 'hidden' || navigator.onLine === false) return
            const current = ++version
            try {
                const res = await getListChatConversationService()
                if (active && current === version && res && res.errCode === 0) setUnreadChat(res.totalUnread || 0)
            } catch { /* Keep the last known badge until the next refresh. */ }
        }
        loadUnread()
        const intervalId = window.setInterval(loadUnread, 30000)
        const socket = getSocket()
        const events = ['chat:new-message', 'chat:read', 'connect']
        if (socket) events.forEach(event => socket.on(event, loadUnread))
        document.addEventListener('visibilitychange', loadUnread)
        window.addEventListener('online', loadUnread)
        return () => {
            active = false
            ++version
            window.clearInterval(intervalId)
            if (socket) events.forEach(event => socket.off(event, loadUnread))
            document.removeEventListener('visibilitychange', loadUnread)
            window.removeEventListener('online', loadUnread)
        }
    }, [user, canUseChat])

    const navigation = useMemo(() => getAdminNavigation(user), [user])
    // Trang con khong co trong menu (vd: /admin/add-user) van to sang muc cha.
    const activePath = useMemo(
        () => resolveAdminPage(user, location.pathname)?.navPath || null,
        [user, location.pathname]
    )
    const isActive = (to) => normalizePath(to) === activePath
    const attention = useAdminAttention(user?.roleCode === 'ADMIN')
    const badges = { ...attention, unreadChat }

    // Vao thang mot trang con thi tu mo nhom chua trang do ra.
    useEffect(() => {
        const nhomChuaTrang = navigation.flatMap(section => section.items)
            .find(item => item.children && item.children.some(child => normalizePath(child.to) === activePath))
        if (nhomChuaTrang) setOpenKey(nhomChuaTrang.key)
    }, [navigation, activePath])

    // Bam vao nhom nao thi mo nhom do va dong tat ca nhom con lai.
    const toggleNhom = (key) => setOpenKey(prev => (prev === key ? null : key))

    const renderLink = (item) => (
        <li key={item.key} className={'nav-item relative' + (isActive(item.to) ? ' active' : '')} onMouseEnter={anchorFlyout} onFocus={anchorFlyout}>
            <Link className="nav-link" to={item.to} onClick={() => setOpenKey(null)}
                aria-current={isActive(item.to) ? 'page' : undefined}>
                <i className={`${item.icon} menu-icon`} aria-hidden="true" />
                <span className="menu-title">{item.label}</span>
                {item.badge && <MenuBadge value={badges[item.badge]} label={BADGE_LABELS[item.badge]} />}
            </Link>
        </li>
    )

    const renderGroup = (group) => {
        const dangMo = openKey === group.key
        const dangXemTrongNhom = group.children.some(child => isActive(child.to))
        return (
            <li
                key={group.key}
                className={'nav-item relative' + (dangXemTrongNhom ? ' active' : '')}
                onMouseEnter={anchorFlyout}
                onFocus={anchorFlyout}
            >
                <a
                    className="nav-link"
                    href={`#${group.key}`}
                    aria-expanded={dangMo}
                    onClick={(e) => { e.preventDefault(); toggleNhom(group.key) }}
                >
                    <i className={`${group.icon} menu-icon`} aria-hidden="true" />
                    <span className="menu-title">{group.title}</span>
                    <i className="menu-arrow" />
                </a>
                {/* Dung class rieng (khong dung .collapse cua Bootstrap vi bo CSS cua
                    theme khong dinh nghia san class do). Phai la CLASS chu khong phai
                    inline style: che do thu gon sidebar (sidebar-icon-only) can ghi de
                    cach hien thi de bien menu con thanh flyout — inline style se chan
                    moi ghi de tu CSS. */}
                <div className={'jf-submenu' + (dangMo ? ' jf-submenu--mo' : '')}>
                    <ul className="nav flex-column sub-menu">
                        {group.children.map(child => (
                            <li className="nav-item relative" key={child.to + child.label}>
                                <Link
                                    className={'nav-link' + (isActive(child.to) ? ' active' : '')}
                                    to={child.to}
                                    aria-current={isActive(child.to) ? 'page' : undefined}
                                >
                                    {child.label}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </div>
            </li>
        )
    }

    return (
        <nav className="sidebar sidebar-offcanvas" id="sidebar" ref={navigationRef} aria-label="Điều hướng quản trị"
            onScroll={(event) => refreshCollapsedFlyouts(event.currentTarget)}>
            <ul className="nav">
                {navigation.map(section => (
                    <React.Fragment key={section.key}>
                        {section.title && (
                            <li className="nav-item jf-nav-section"><span>{section.title}</span></li>
                        )}
                        {section.items.map(item => (item.children ? renderGroup(item) : renderLink(item)))}
                    </React.Fragment>
                ))}
            </ul>
        </nav>
    )
}

export default Menu
