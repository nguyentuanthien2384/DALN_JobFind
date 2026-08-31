import React from "react";
import { Link } from "react-router-dom";
import { useEffect, useMemo, useState, useRef } from "react";
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
    const [isSidebarMinimized, setIsSidebarMinimized] = useState(() =>
        document.body.classList.contains("sidebar-icon-only") ||
        document.body.classList.contains("sidebar-hidden")
    );
    const boxRef = useRef(null);
    const homePath = getDefaultRouteForUser(user);

    const handleSidebarToggle = () => {
        const isMobile = window.matchMedia("(max-width: 991.98px)").matches;
        const sidebarStateClass = isMobile
            ? "sidebar-hidden"
            : "sidebar-icon-only";
        const willBeMinimized = !document.body.classList.contains(sidebarStateClass);

        // Xóa trạng thái của chế độ còn lại để việc đổi kích thước màn hình
        // không làm sidebar bị kẹt ở trạng thái cũ.
        document.body.classList.remove(
            isMobile ? "sidebar-icon-only" : "sidebar-hidden"
        );
        document.body.classList.toggle(sidebarStateClass, willBeMinimized);
        setIsSidebarMinimized(willBeMinimized);
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

    // Bam ra ngoai thi dong hop thong bao lai
    useEffect(() => {
        if (!showNotification) return;
        const onClickOutside = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) {
                setShowNotification(false);
            }
        };
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, [showNotification]);

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
        setShowNotification(false);
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
                            style={{
                                color: "#252b60", fontSize: "18px", cursor: "pointer",
                                background: "none", border: 0, padding: 0, lineHeight: 1,
                            }}
                            onClick={() => setShowNotification(!showNotification)}
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
                    <li className="nav-item nav-profile dropdown">
                        <button
                            type="button"
                            className="nav-link dropdown-toggle"
                            data-toggle="dropdown"
                            id="profileDropdown"
                            style={{ border: 0, background: "none" }}
                        >
                            <img
                                style={{ objectFit: "cover" }}
                                src={user.image}
                                alt="profile"
                            />
                        </button>
                        <div
                            className="dropdown-menu dropdown-menu-right navbar-dropdown"
                            aria-labelledby="profileDropdown"
                        >
                            <Link
                                to={"/admin/user-info/"}
                                className="dropdown-item"
                            >
                                <i className="far fa-user text-primary"></i>
                                Thông tin
                            </Link>
                            <Link
                                to={"/admin/changepassword/"}
                                className="dropdown-item"
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
                    data-toggle="offcanvas"
                >
                    <span className="icon-menu" />
                </button>
            </div>
        </nav>
    );
};

export default Header;
