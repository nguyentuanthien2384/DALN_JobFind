import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react';
import { getListChatConversationService } from '../../service/userService';
import { getSocket } from '../../socket';
import { hasCompanyMembership, hasPermission, PERMISSIONS } from '../../auth/accessControl';
import { readJsonStorage } from '../../util/storage';

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

// Dinh nghia menu theo du lieu cho de doc va de them bot, thay vi lap JSX.
const MENU_ADMIN = [
    {
        key: 'report', permission: PERMISSIONS.VIEW_PLATFORM_REPORTS, title: 'Báo cáo & Thống kê', icon: 'fas fa-chart-line menu-icon', children: [
            { to: '/admin/reports/', label: 'Bảng báo cáo' },
        ]
    },
    {
        key: 'chart', permission: PERMISSIONS.VIEW_PLATFORM_REPORTS, title: 'Đồ thị', icon: 'icon-head menu-icon', children: [
            { to: '/admin/sum-by-year-post/', label: 'Đồ thị doanh thu gói bài viết' },
            { to: '/admin/sum-by-year-cv/', label: 'Đồ thị doanh thu gói xem ứng viên' },
        ]
    },
    {
        key: 'user', permission: PERMISSIONS.MANAGE_USERS, title: 'Quản lý người dùng', icon: 'icon-head menu-icon', children: [
            { to: '/admin/list-user/', label: 'Danh sách người dùng' },
            { to: '/admin/add-user/', label: 'Thêm người dùng' },
        ]
    },
    {
        key: 'jobtype', permission: PERMISSIONS.MANAGE_REFERENCE_DATA, title: 'Quản lý loại công việc', icon: 'far fa-building menu-icon', children: [
            { to: '/admin/list-job-type/', label: 'Danh sách loại công việc' },
            { to: '/admin/add-job-type/', label: 'Thêm loại công việc' },
        ]
    },
    {
        key: 'jobskill', permission: PERMISSIONS.MANAGE_REFERENCE_DATA, title: 'Quản lý kĩ năng', icon: 'fas fa-lightbulb menu-icon', children: [
            { to: '/admin/list-job-skill/', label: 'Danh sách kĩ năng' },
            { to: '/admin/add-job-skill/', label: 'Thêm kĩ năng' },
        ]
    },
    {
        key: 'joblevel', permission: PERMISSIONS.MANAGE_REFERENCE_DATA, title: 'Quản lý cấp bậc', icon: 'fas fa-level-up-alt menu-icon', children: [
            { to: '/admin/list-job-level/', label: 'Danh sách cấp bậc' },
            { to: '/admin/add-job-level/', label: 'Thêm cấp bậc' },
        ]
    },
    {
        key: 'worktype', permission: PERMISSIONS.MANAGE_REFERENCE_DATA, title: 'Quản lý hình thức làm việc', icon: 'fas fa-briefcase menu-icon', children: [
            { to: '/admin/list-work-type/', label: 'Danh sách hình thức làm việc' },
            { to: '/admin/add-work-type/', label: 'Thêm hình thức làm việc' },
        ]
    },
    {
        key: 'salarytype', permission: PERMISSIONS.MANAGE_REFERENCE_DATA, title: 'Quản lý khoảng lương', icon: 'fas fa-money-check-alt menu-icon', children: [
            { to: '/admin/list-salary-type/', label: 'Danh sách khoảng lương' },
            { to: '/admin/add-salary-type/', label: 'Thêm khoảng lương' },
        ]
    },
    {
        key: 'exptype', permission: PERMISSIONS.MANAGE_REFERENCE_DATA, title: 'Quản lý kinh nghiệm làm việc', icon: 'far fa-clock menu-icon', children: [
            { to: '/admin/list-exp-type/', label: 'Danh sách kinh nghiệm' },
            { to: '/admin/add-exp-type/', label: 'Thêm kinh nghiệm' },
        ]
    },
    {
        key: 'packagepost', permission: PERMISSIONS.MANAGE_PACKAGES, title: 'Quản lý gói bài đăng', icon: 'fas fa-cube menu-icon', children: [
            { to: '/admin/list-package-post/', label: 'Danh sách gói bài đăng' },
            { to: '/admin/add-package-post/', label: 'Thêm gói bài đăng' },
        ]
    },
    {
        key: 'packagecv', permission: PERMISSIONS.MANAGE_PACKAGES, title: 'Quản lý gói xem ứng viên', icon: 'fas fa-cube menu-icon', children: [
            { to: '/admin/list-package-cv/', label: 'Danh sách gói xem ứng viên' },
            { to: '/admin/add-package-cv/', label: 'Thêm gói xem ứng viên' },
        ]
    },
    {
        key: 'admin-company', permission: PERMISSIONS.MODERATE_COMPANIES, title: 'Quản lý công ty', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/list-company-admin/', label: 'Danh sách công ty' },
        ]
    },
    {
        key: 'admin-post', permission: PERMISSIONS.MODERATE_POSTS, title: 'Quản lý bài đăng', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/list-post-admin/', label: 'Danh sách bài đăng' },
        ]
    },
];

const MENU_COMPANY = [
    {
        key: 'company-info', permission: PERMISSIONS.MANAGE_COMPANY, title: 'Quản lý công ty', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/edit-company/', label: 'Thông tin công ty' },
            { to: '/admin/recruitment/', label: 'Tuyển dụng vào công ty' },
            { to: '/admin/list-employer/', label: 'Danh sách nhân viên' },
            { to: '/admin/add-user/', label: 'Thêm nhân viên' },
        ]
    },
    {
        key: 'company-post', permission: PERMISSIONS.MANAGE_POSTS, title: 'Quản lý bài đăng', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/add-post/', label: 'Tạo mới bài đăng' },
            { to: '/admin/list-post/', label: 'Danh sách bài đăng' },
            { to: '/admin/buy-post/', label: 'Mua thêm lượt đăng bài' },
        ]
    },
    {
        key: 'company-candidate', permission: PERMISSIONS.MANAGE_CANDIDATES, title: 'Quản lý ứng viên', icon: 'icon-head menu-icon', children: [
            { to: '/admin/pipeline/', label: 'Quy trình tuyển dụng' },
            { to: '/admin/list-candiate/', label: 'Tìm kiếm ứng viên' },
            { to: '/admin/buy-cv/', label: 'Mua thêm lượt xem ứng viên' },
        ]
    },
    {
        key: 'company-history', permission: PERMISSIONS.VIEW_TRANSACTIONS, title: 'Lịch sử giao dịch', icon: 'fas fa-money-check-alt menu-icon', children: [
            { to: '/admin/history-post/', label: 'Lịch sử gói bài đăng' },
            { to: '/admin/history-cv/', label: 'Lịch sử gói xem ứng viên' },
        ]
    },
];

const MENU_EMPLOYER_CHUA_CO_CONG_TY = [
    {
        key: 'employer-company', permission: PERMISSIONS.CREATE_COMPANY, title: 'Công ty', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/add-company/', label: 'Tạo mới công ty' },
        ]
    },
];

const MENU_EMPLOYER = [
    {
        key: 'employer-post', permission: PERMISSIONS.MANAGE_POSTS, title: 'Quản lý bài đăng', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/add-post/', label: 'Tạo mới bài đăng' },
            { to: '/admin/list-post/', label: 'Danh sách bài đăng' },
        ]
    },
    {
        key: 'employer-candidate', permission: PERMISSIONS.MANAGE_CANDIDATES, title: 'Quản lý ứng viên', icon: 'icon-head menu-icon', children: [
            { to: '/admin/pipeline/', label: 'Quy trình tuyển dụng' },
            { to: '/admin/list-candiate/', label: 'Tìm kiếm ứng viên' },
        ]
    },
];

const Menu = ({ user: suppliedUser }) => {
    const location = useLocation()
    const user = useMemo(
        () => suppliedUser || readJsonStorage('userData'),
        [suppliedUser]
    )
    const [unreadChat, setUnreadChat] = useState(0)
    const [openKey, setOpenKey] = useState(null)
    const canUseChat = hasPermission(user, PERMISSIONS.USE_CHAT)
    const canViewDashboard = hasPermission(user, PERMISSIONS.VIEW_ADMIN_HOME)

    // Dem tin nhan chua doc cho muc "Tin nhan".
    useEffect(() => {
        if (!user || !user.id || !canUseChat) return
        const loadUnread = async () => {
            const res = await getListChatConversationService()
            if (res && res.errCode === 0) setUnreadChat(res.totalUnread || 0)
        }
        loadUnread()
        const intervalId = window.setInterval(loadUnread, 30000)
        const socket = getSocket()
        if (socket) socket.on('chat:new-message', loadUnread)
        return () => {
            window.clearInterval(intervalId)
            if (socket) socket.off('chat:new-message', loadUnread)
        }
    }, [user, canUseChat])

    // Danh sach nhom menu theo vai tro
    const getGroups = () => {
        if (!user) return []
        if (user.roleCode === 'ADMIN') return MENU_ADMIN.filter(group => hasPermission(user, group.permission))
        if (user.roleCode === 'COMPANY') return MENU_COMPANY.filter(group => hasPermission(user, group.permission))
        if (user.roleCode === 'EMPLOYER') {
            const menu = hasCompanyMembership(user) ? MENU_EMPLOYER : MENU_EMPLOYER_CHUA_CO_CONG_TY
            return menu.filter(group => hasPermission(user, group.permission))
        }
        return []
    }
    const groups = getGroups()

    const laDuongDanHienTai = (to) => {
        const a = location.pathname.replace(/\/+$/, '')
        const b = to.replace(/\/+$/, '')
        return a === b
    }

    // Khong dung startsWith vi /admin/list-user khong phai la trang chu.
    const dangOTrangChu = laDuongDanHienTai('/admin')

    // Vao thang mot trang con thi tu mo nhom chua trang do ra.
    useEffect(() => {
        const nhomChuaTrang = groups.find(g => g.children.some(c => laDuongDanHienTai(c.to)))
        if (nhomChuaTrang) setOpenKey(nhomChuaTrang.key)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, user])

    // Bam vao nhom nao thi mo nhom do va dong tat ca nhom con lai.
    const toggleNhom = (key) => setOpenKey(prev => (prev === key ? null : key))

    return (
        <nav className="sidebar sidebar-offcanvas" id="sidebar">
            <ul className="nav">
                {canViewDashboard && (
                    <li className={'nav-item relative' + (dangOTrangChu ? ' active' : '')}>
                        <Link className="nav-link" to="/admin/" onClick={() => setOpenKey(null)}>
                            <i className="icon-grid menu-icon" />
                            <span className="menu-title">Trang chủ</span>
                        </Link>
                    </li>
                )}

                {canUseChat && (
                    <li className={'nav-item relative' + (location.pathname.startsWith('/admin/chat') ? ' active' : '')}>
                        <Link className="nav-link" to="/admin/chat" onClick={() => setOpenKey(null)}>
                            <i className="icon-paper menu-icon" />
                            <span className="menu-title">Tin nhắn</span>
                            {unreadChat > 0 &&
                                <span style={{
                                    background: '#fb246a', color: '#fff', borderRadius: '10px',
                                    fontSize: '11px', padding: '1px 7px', marginLeft: '8px'
                                }}>{unreadChat}</span>
                            }
                        </Link>
                    </li>
                )}

                {groups.map(group => {
                    const dangMo = openKey === group.key
                    const dangXemTrongNhom = group.children.some(c => laDuongDanHienTai(c.to))
                    return (
                        <li
                            key={group.key}
                            className={'nav-item relative' + (dangXemTrongNhom ? ' active' : '')}
                        >
                            <a
                                className="nav-link"
                                href={`#${group.key}`}
                                aria-expanded={dangMo}
                                onClick={(e) => { e.preventDefault(); toggleNhom(group.key) }}
                            >
                                <i className={group.icon} />
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
                                                className={'nav-link' + (laDuongDanHienTai(child.to) ? ' active' : '')}
                                                to={child.to}
                                            >
                                                {child.label}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </nav>
    )
}

export default Menu
