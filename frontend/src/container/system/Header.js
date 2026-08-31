import React from "react";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { disconnectSocket, getSocket } from "../../socket";
import {
    getNotificationByUserService,
    markReadNotificationService,
} from "../../service/userService";
import { readJsonStorage } from "../../util/storage";
import { getDefaultRouteForUser } from "../../auth/accessControl";

const Header = ({ user: suppliedUser }) => {
    const user = useMemo(
        () => suppliedUser || readJsonStorage("userData", {}),
        [suppliedUser]
    );
    const [listNotification, setListNotification] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotification, setShowNotification] = useState(false);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [isSidebarMinimized, setIsSidebarMinimized] = useState(() =>
        document.body.classList.contains("sidebar-icon-only")
    );
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const boxRef = useRef(null);
    const profileRef = useRef(null);
    const homePath = getDefaultRouteForUser(user);

    const handleSidebarToggle = () => {
        const willBeMinimized = !document.body.classList.contains("sidebar-icon-only");
        document.body.classList.toggle("sidebar-icon-only", willBeMinimized);
        setIsSidebarMinimized(willBeMinimized);
    };

    const handleMobileSidebarToggle = () => {
        const sidebar = document.querySelector(".sidebar-offcanvas");
        if (!sidebar) return;
        const willOpen = !sidebar.classList.contains("active");
        sidebar.classList.toggle("active", willOpen);
        setIsMobileSidebarOpen(willOpen);
    };

    let handleLogout = () => {
        disconnectSocket();
        localStorage.removeItem("userData");
        localStorage.removeItem("token_user");
        window.location.href = "/login";
    };
    // Khu quan tri truoc day khong co chuong thong bao (chi giao dien ngoai moi co),
    // nen nha tuyen dung khong biet co CV moi hay tin duoc duyet.
    useEffect(() => {
        if (!user || !user.id) return;
        const loadNotification = async () => {
            try {
                const res = await getNotificationByUserService({
                    userId: user.id,
                    limit: 10,
                    offset: 0,
                });
                if (res && res.errCode === 0) {
                    setListNotification(res.data || []);
                    setUnreadCount(res.unreadCount || 0);
                }
            } catch (error) {
                // Thong bao la thong tin phu; loi mang khong duoc lam hong thanh dieu huong.
            }
        };
        loadNotification();
        const intervalId = window.setInterval(loadNotification, 30000);

        // Co thong bao / tin nhan moi thi cap nhat ngay, khong cho het 30 giay
        const socket = getSocket();
        if (socket) socket.on("notification:new", loadNotification);

        return () => {
            window.clearInterval(intervalId);
            if (socket) socket.off("notification:new", loadNotification);
        };
    }, [user]);

    const closeHeaderMenus = useCallback(() => {
        setShowNotification(false);
        setShowProfileMenu(false);
    }, []);

    // Các menu dùng trạng thái React để hoạt động ổn định sau khi component render.
    useEffect(() => {
        if (!showNotification && !showProfileMenu) return;
        const onClickOutside = (e) => {
            const clickedInsideMenu = [boxRef, profileRef]
                .some(ref => ref.current && ref.current.contains(e.target));
            if (!clickedInsideMenu) closeHeaderMenus();
        };
        const onEscape = (e) => {
            if (e.key === "Escape") closeHeaderMenus();
        };
        document.addEventListener("mousedown", onClickOutside);
        document.addEventListener("keydown", onEscape);
        return () => {
            document.removeEventListener("mousedown", onClickOutside);
            document.removeEventListener("keydown", onEscape);
        };
    }, [showNotification, showProfileMenu, closeHeaderMenus]);

    const toggleNotificationMenu = () => {
        setShowNotification(current => !current);
        setShowProfileMenu(false);
    };

    const toggleProfileMenu = () => {
        setShowProfileMenu(current => !current);
        setShowNotification(false);
    };

    const handleReadAll = async () => {
        const res = await markReadNotificationService({ userId: user.id });
        if (res && res.errCode === 0) {
            setListNotification((cur) => cur.map((i) => ({ ...i, isChecked: 1 })));
            setUnreadCount(0);
        }
    };

    const handleClickNotification = async (notification) => {
        if (+notification.isChecked === 0) {
            await markReadNotificationService({
                userId: user.id,
                id: notification.id,
            });
            setListNotification((cur) =>
                cur.map((i) =>
                    i.id === notification.id ? { ...i, isChecked: 1 } : i
                )
            );
            setUnreadCount((cur) => Math.max(0, cur - 1));
        }
        closeHeaderMenus();
        if (notification.link) window.location.href = notification.link;
    };

    return (
        <nav className="navbar col-lg-12 col-12 p-0 fixed-top d-flex flex-row">
            <div className="text-center navbar-brand-wrapper d-flex align-items-center justify-content-center">
                <Link className="navbar-brand brand-logo mr-5" to={homePath}>
                    <img
                        src="/assets/img/logo/logo.png"
                        className="mr-2"
                        alt="logo"
                    />
                </Link>
                <Link className="navbar-brand brand-logo-mini" to={homePath}>
                    <img src="/assetsAdmin/images/logo-mini.svg" alt="logo" />
                </Link>
            </div>
            <div className="navbar-menu-wrapper d-flex align-items-center justify-content-end">
                <button
                    className="navbar-toggler navbar-toggler align-self-center"
                    type="button"
                    aria-label={isSidebarMinimized ? "Mở thanh menu" : "Thu gọn thanh menu"}
                    aria-expanded={!isSidebarMinimized}
                    onClick={handleSidebarToggle}
                >
                    <span className="icon-menu" />
                </button>

                <ul className="navbar-nav navbar-nav-right" style={{ flexDirection: "row", alignItems: "center" }}>
                    <li
                        className="nav-item"
                        ref={boxRef}
                        style={{ position: "relative", marginRight: "18px" }}
                    >
                        <button
                            type="button"
                            aria-label="Thông báo"
                            aria-expanded={showNotification}
                            aria-controls="system-notification-menu"
                            style={{
                                color: "#252b60", fontSize: "18px", cursor: "pointer",
                                background: "none", border: 0, padding: 0, lineHeight: 1,
                            }}
                            onClick={toggleNotificationMenu}
                        >
                            <i className="far fa-bell"></i>
                            {unreadCount > 0 && (
                                <span
                                    style={{
                                        position: "absolute", top: "-6px", right: "-10px",
                                        background: "#fb246a", color: "#fff", borderRadius: "50%",
                                        fontSize: "10px", padding: "1px 5px",
                                    }}
                                >
                                    {unreadCount}
                                </span>
                            )}
                        </button>
                        {showNotification && (
                            <div
                                id="system-notification-menu"
                                style={{
                                    position: "absolute", top: "34px", right: "-10px", width: "330px",
                                    background: "#fff", borderRadius: "8px",
                                    boxShadow: "0 4px 16px rgba(0,0,0,0.15)", zIndex: 999,
                                    maxHeight: "400px", overflowY: "auto",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex", justifyContent: "space-between",
                                        alignItems: "center", padding: "10px 14px",
                                        borderBottom: "1px solid #f0f0f0",
                                    }}
                                >
                                    <b style={{ color: "#333" }}>Thông báo</b>
                                    {unreadCount > 0 && (
                                        <button
                                            type="button"
                                            style={{
                                                fontSize: "12px", color: "#fb246a", cursor: "pointer",
                                                background: "none", border: 0, padding: 0,
                                            }}
                                            onClick={() => handleReadAll()}
                                        >
                                            Đọc tất cả
                                        </button>
                                    )}
                                </div>
                                {listNotification && listNotification.length > 0 ? (
                                    listNotification.map((item, index) => (
                                        <div
                                            key={index}
                                            onClick={() => handleClickNotification(item)}
                                            style={{
                                                padding: "10px 14px", cursor: "pointer",
                                                borderBottom: "1px solid #f7f7f7",
                                                background: +item.isChecked === 0 ? "#fff5f8" : "#fff",
                                            }}
                                        >
                                            <div style={{ fontSize: "13px", color: "#333" }}>
                                                {item.content}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div
                                        style={{
                                            padding: "18px", textAlign: "center",
                                            color: "#999", fontSize: "13px",
                                        }}
                                    >
                                        Chưa có thông báo nào
                                    </div>
                                )}
                            </div>
                        )}
                    </li>
                    <li className="nav-item nav-profile dropdown" ref={profileRef}>
                        <button
                            type="button"
                            className="nav-link dropdown-toggle"
                            id="profileDropdown"
                            aria-label="Tài khoản"
                            aria-haspopup="menu"
                            aria-expanded={showProfileMenu}
                            aria-controls="system-profile-menu"
                            onClick={toggleProfileMenu}
                            style={{ border: 0, background: "none", cursor: "pointer" }}
                        >
                            <img
                                style={{ objectFit: "cover" }}
                                src={user.image}
                                alt="profile"
                            />
                        </button>
                        <div
                            id="system-profile-menu"
                            className={`dropdown-menu dropdown-menu-right navbar-dropdown${showProfileMenu ? " show" : ""}`}
                            aria-labelledby="profileDropdown"
                        >
                            <Link
                                to={"/admin/user-info/"}
                                className="dropdown-item"
                                onClick={closeHeaderMenus}
                            >
                                <i className="far fa-user text-primary"></i>
                                Thông tin
                            </Link>
                            <Link
                                to={"/admin/changepassword/"}
                                className="dropdown-item"
                                onClick={closeHeaderMenus}
                            >
                                <i className="ti-settings text-primary" />
                                Đổi mật khẩu
                            </Link>
                            <button
                                type="button"
                                onClick={() => handleLogout()}
                                className="dropdown-item"
                            >
                                <i className="ti-power-off text-primary" />
                                Đăng xuất
                            </button>
                        </div>
                    </li>
                </ul>
                <button
                    className="navbar-toggler navbar-toggler-right d-lg-none align-self-center"
                    type="button"
                    aria-label={isMobileSidebarOpen ? "Đóng menu trên điện thoại" : "Mở menu trên điện thoại"}
                    aria-expanded={isMobileSidebarOpen}
                    onClick={handleMobileSidebarToggle}
                >
                    <span className="icon-menu" />
                </button>
            </div>
        </nav>
    );
};

export default Header;
