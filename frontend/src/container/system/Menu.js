import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react';
import { getListChatConversationService } from '../../service/userService';
import { getSocket } from '../../socket';

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
        key: 'chart', title: 'Đồ thị', icon: 'icon-head menu-icon', children: [
            { to: '/admin/sum-by-year-post/', label: 'Đồ thị doanh thu gói bài viết' },
            { to: '/admin/sum-by-year-cv/', label: 'Đồ thị doanh thu gói xem ứng viên' },
        ]
    },
    {
        key: 'user', title: 'Quản lý người dùng', icon: 'icon-head menu-icon', children: [
            { to: '/admin/list-user/', label: 'Danh sách người dùng' },
            { to: '/admin/add-user/', label: 'Thêm người dùng' },
        ]
    },
    {
        key: 'jobtype', title: 'Quản lý loại công việc', icon: 'far fa-building menu-icon', children: [
            { to: '/admin/list-job-type/', label: 'Danh sách loại công việc' },
            { to: '/admin/add-job-type/', label: 'Thêm loại công việc' },
        ]
    },
    {
        key: 'jobskill', title: 'Quản lý kĩ năng', icon: 'fas fa-lightbulb menu-icon', children: [
            { to: '/admin/list-job-skill/', label: 'Danh sách kĩ năng' },
            { to: '/admin/add-job-skill/', label: 'Thêm kĩ năng' },
        ]
    },
    {
        key: 'joblevel', title: 'Quản lý cấp bậc', icon: 'fas fa-level-up-alt menu-icon', children: [
            { to: '/admin/list-job-level/', label: 'Danh sách cấp bậc' },
            { to: '/admin/add-job-level/', label: 'Thêm cấp bậc' },
        ]
    },
    {
        key: 'worktype', title: 'Quản lý hình thức làm việc', icon: 'fas fa-briefcase menu-icon', children: [
            { to: '/admin/list-work-type/', label: 'Danh sách hình thức làm việc' },
            { to: '/admin/add-work-type/', label: 'Thêm hình thức làm việc' },
        ]
    },
    {
        key: 'salarytype', title: 'Quản lý khoảng lương', icon: 'fas fa-money-check-alt menu-icon', children: [
            { to: '/admin/list-salary-type/', label: 'Danh sách khoảng lương' },
            { to: '/admin/add-salary-type/', label: 'Thêm khoảng lương' },
        ]
    },
    {
        key: 'exptype', title: 'Quản lý kinh nghiệm làm việc', icon: 'far fa-clock menu-icon', children: [
            { to: '/admin/list-exp-type/', label: 'Danh sách kinh nghiệm' },
            { to: '/admin/add-exp-type/', label: 'Thêm kinh nghiệm' },
        ]
    },
    {
        key: 'packagepost', title: 'Quản lý gói bài đăng', icon: 'fas fa-cube menu-icon', children: [
            { to: '/admin/list-package-post/', label: 'Danh sách gói bài đăng' },
            { to: '/admin/add-package-post/', label: 'Thêm gói bài đăng' },
        ]
    },
    {
        key: 'packagecv', title: 'Quản lý gói xem ứng viên', icon: 'fas fa-cube menu-icon', children: [
            { to: '/admin/list-package-cv/', label: 'Danh sách gói xem ứng viên' },
            { to: '/admin/add-package-cv/', label: 'Thêm gói xem ứng viên' },
        ]
    },
    {
        key: 'admin-company', title: 'Quản lý công ty', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/list-company-admin/', label: 'Danh sách công ty' },
        ]
    },
    {
        key: 'admin-post', title: 'Quản lý bài đăng', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/list-post-admin/', label: 'Danh sách bài đăng' },
        ]
    },
];

const MENU_COMPANY = [
    {
        key: 'company-info', title: 'Quản lý công ty', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/edit-company/', label: 'Thông tin công ty' },
            { to: '/admin/recruitment/', label: 'Tuyển dụng vào công ty' },
            { to: '/admin/list-employer/', label: 'Danh sách nhân viên' },
            { to: '/admin/add-user/', label: 'Thêm nhân viên' },
        ]
    },
    {
        key: 'company-post', title: 'Quản lý bài đăng', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/add-post/', label: 'Tạo mới bài đăng' },
            { to: '/admin/list-post/', label: 'Danh sách bài đăng' },
            { to: '/admin/buy-post/', label: 'Mua thêm lượt đăng bài' },
        ]
    },
    {
        key: 'company-candidate', title: 'Tìm kiếm ứng viên', icon: 'icon-head menu-icon', children: [
            { to: '/admin/list-candiate/', label: 'Danh sách ứng viên' },
            { to: '/admin/buy-cv/', label: 'Mua thêm lượt xem ứng viên' },
        ]
    },
    {
        key: 'company-history', title: 'Lịch sử giao dịch', icon: 'fas fa-money-check-alt menu-icon', children: [
            { to: '/admin/history-post/', label: 'Lịch sử gói bài đăng' },
            { to: '/admin/history-cv/', label: 'Lịch sử gói xem ứng viên' },
        ]
    },
];

const MENU_EMPLOYER_CHUA_CO_CONG_TY = [
    {
        key: 'employer-company', title: 'Công ty', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/add-company/', label: 'Tạo mới công ty' },
        ]
    },
];

const MENU_EMPLOYER = [
    {
        key: 'employer-post', title: 'Quản lý bài đăng', icon: 'fas fa-clipboard menu-icon', children: [
            { to: '/admin/add-post/', label: 'Tạo mới bài đăng' },
            { to: '/admin/list-post/', label: 'Danh sách bài đăng' },
        ]
    },
    {
        key: 'employer-candidate', title: 'Tìm kiếm ứng viên', icon: 'icon-head menu-icon', children: [
            { to: '/admin/list-candiate/', label: 'Danh sách ứng viên' },
        ]
    },
];

const Menu = () => {
    const location = useLocation()
    const [user, setUser] = useState({})
    const [unreadChat, setUnreadChat] = useState(0)
    const [openKey, setOpenKey] = useState(null)

    useEffect(() => {
        const userData = JSON.parse(localStorage.getItem('userData'));
        setUser(userData)
    }, [])

    // Dem tin nhan chua doc cho muc "Tin nhan".
    useEffect(() => {
        if (!user || !user.id) return
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
    }, [user])

    // Danh sach nhom menu theo vai tro
    const getGroups = () => {
        if (!user) return []
        if (user.roleCode === 'ADMIN') return MENU_ADMIN
        if (user.roleCode === 'COMPANY') return MENU_COMPANY
        if (user.roleCode === 'EMPLOYER') {
            return user.companyId ? MENU_EMPLOYER : MENU_EMPLOYER_CHUA_CO_CONG_TY
        }
        return []
    }
    const groups = getGroups()

    const laDuongDanHienTai = (to) => {
        const a = location.pathname.replace(/\/+$/, '')
        const b = to.replace(/\/+$/, '')
        return a === b
    }

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
                <li className={'nav-item relative' + (laDuongDanHienTai('/admin') ? ' active' : '')}>
                    <Link className="nav-link" to="/admin/" onClick={() => setOpenKey(null)}>
                        <i className="icon-grid menu-icon" />
                        <span className="menu-title">Trang chủ</span>
                    </Link>
                </li>

                {/* Trang chat nam ngoai khu quan tri, truoc day khu nay khong co link nao
                    tro toi nen nha tuyen dung dang nhap xong khong biet vao chat bang cach nao. */}
                <li className={'nav-item relative' + (location.pathname.startsWith('/chat') ? ' active' : '')}>
                    <Link className="nav-link" to="/chat" onClick={() => setOpenKey(null)}>
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
