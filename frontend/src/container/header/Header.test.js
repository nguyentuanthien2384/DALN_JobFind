jest.mock('../../auth/authClient', () => ({ logoutServer: jest.fn().mockResolvedValue(undefined) }));
import React from "react";
import { act, fireEvent, render as renderView, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import {
    getListChatConversationService,
    getNotificationByUserService,
    markReadNotificationService,
} from "../../service/userService";
import { disconnectSocket, getSocket } from "../../socket";
import Header from "./header";
import { notifyNotificationsUpdated } from '../../util/notificationEvents';

jest.mock("../../service/userService", () => ({
    getNotificationByUserService: jest.fn(),
    markReadNotificationService: jest.fn(),
    getListChatConversationService: jest.fn(),
}));
jest.mock("../../socket", () => ({
    getSocket: jest.fn(),
    disconnectSocket: jest.fn(),
}));
jest.mock("react-toastify", () => ({ toast: { error: jest.fn() } }));
jest.mock("react-router-dom", () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});

const render = (view, entry = '/') => renderView(<MemoryRouter initialEntries={[entry]}>{view}</MemoryRouter>);
const BackButton = () => {
    const navigate = useNavigate();
    return <button onClick={() => navigate(-1)}>Back</button>;
};

const socketHandlers = {};
const socket = {
    on: jest.fn((event, handler) => {
        socketHandlers[event] = handler;
    }),
    off: jest.fn(),
};

describe("public Header", () => {
    it('refreshes read badges across tabs and reconnects; stale responses cannot restore an old count', async () => {
        localStorage.setItem('userData', JSON.stringify({id:7,roleCode:'CANDIDATE'}));
        const {unmount}=render(<Header/>);await screen.findByText('2');
        let finishOld;
        getNotificationByUserService.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve;}));
        act(()=>{socketHandlers['notification:read']();});
        getNotificationByUserService.mockResolvedValue({errCode:0,unreadCount:0,data:[]});
        getListChatConversationService.mockResolvedValue({errCode:0,totalUnread:0});
        await act(async()=>{await socketHandlers.connect();});
        await act(async()=>{finishOld({errCode:0,unreadCount:19,data:[]});});
        expect(screen.queryByText('19')).not.toBeInTheDocument();expect(screen.queryByText('2')).not.toBeInTheDocument();
        const count=getNotificationByUserService.mock.calls.length;
        Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
        await act(async()=>{await socketHandlers['chat:read']();});expect(getNotificationByUserService).toHaveBeenCalledTimes(count);
        Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
        await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));});expect(getNotificationByUserService).toHaveBeenCalledTimes(count+1);
        unmount();expect(socket.off).toHaveBeenCalledWith('notification:read',socketHandlers['notification:read']);
    });
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
        socket.on.mockImplementation((event, handler) => {
            socketHandlers[event] = handler;
        });
        getSocket.mockReturnValue(socket);
        getNotificationByUserService.mockResolvedValue({
            errCode: 0,
            unreadCount: 2,
            data: [
                { id: 11, content: "Hồ sơ đã được xem", isChecked: 0 },
                { id: 12, content: "Tin đã đọc", isChecked: 1 },
            ],
        });
        getListChatConversationService.mockResolvedValue({ errCode: 0, totalUnread: 3 });
        markReadNotificationService.mockResolvedValue({ errCode: 0 });
    });

    it("shows login actions for an anonymous visitor", async () => {
        render(<Header />);

        expect(await screen.findByRole("link", { name: "Đăng kí" })).toHaveAttribute(
            "href",
            "/register"
        );
        expect(screen.getByRole("link", { name: "Đăng nhập" })).toHaveAttribute(
            "href",
            "/login"
        );
        expect(getNotificationByUserService).not.toHaveBeenCalled();
    });

    it.each([
        ['/', 'Trang chủ'],
        ['/job?page=2&jobLevel=JUNIOR', 'Việc làm'],
        ['/job/', 'Việc làm'],
        ['/detail-job/42', 'Việc làm'],
        ['/company', 'Công ty'],
        ['/detail-company/9', 'Công ty'],
        ['/about', 'Giới thiệu'],
        ['/contact', 'Liên hệ'],
        ['/login', null],
        ['/register', null],
        ['/account/security', null],
    ])('marks only the current public section on desktop and mobile at %s', (entry, activeLabel) => {
        render(<Header />, entry);
        fireEvent.click(screen.getByRole('button', { name: 'Menu' }));

        ['Điều hướng chính', 'Điều hướng di động'].forEach(name => {
            const navigation = screen.getByRole('navigation', { name });
            const activeLinks = Array.from(navigation.querySelectorAll('.public-nav-link[aria-current="page"]'));
            expect(activeLinks.map(link => link.textContent.trim())).toEqual(activeLabel ? [activeLabel] : []);
        });
        if (entry === '/login' || entry === '/register') {
            const activeAuthLabel = entry === '/login' ? 'Đăng nhập' : 'Đăng kí';
            const inactiveAuthLabel = entry === '/login' ? 'Đăng kí' : 'Đăng nhập';
            screen.getAllByRole('link', { name: activeAuthLabel }).forEach(link => {
                expect(link).toHaveAttribute('aria-current', 'page');
            });
            screen.getAllByRole('link', { name: inactiveAuthLabel }).forEach(link => {
                expect(link).not.toHaveAttribute('aria-current');
            });
        }
    });

    it('updates the active section after navigation and Back, preserving active auth links', () => {
        render(<><Header /><BackButton /></>);
        const desktopNavigation = screen.getByRole('navigation', { name: 'Điều hướng chính' });
        const jobsLink = within(desktopNavigation).getByRole('link', { name: 'Việc làm' });
        fireEvent.click(jobsLink);
        expect(jobsLink).toHaveAttribute('aria-current', 'page');
        expect(within(desktopNavigation).getByRole('link', { name: 'Trang chủ' })).not.toHaveAttribute('aria-current');

        fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
        fireEvent.click(within(screen.getByRole('navigation', { name: 'Điều hướng di động' })).getByRole('link', { name: 'Công ty' }));
        expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
        expect(within(desktopNavigation).getByRole('link', { name: 'Công ty' })).toHaveAttribute('aria-current', 'page');
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(jobsLink).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('link', { name: 'Đăng nhập' }));
        expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('aria-current', 'page');
        expect(jobsLink).not.toHaveAttribute('aria-current');
        fireEvent.click(screen.getByRole('link', { name: 'Đăng kí' }));
        expect(screen.getByRole('link', { name: 'Đăng kí' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Đăng nhập' })).not.toHaveAttribute('aria-current');
    });

    it("treats malformed persisted user data as an anonymous session", async () => {
        localStorage.setItem("userData", "{broken-json");
        render(<Header />);

        expect(await screen.findByRole("link", { name: "Đăng nhập" })).toBeInTheDocument();
        expect(localStorage.getItem("userData")).toBeNull();
        expect(getNotificationByUserService).not.toHaveBeenCalled();
    });

    it("loads candidate badges and exposes candidate-only menu links", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({
                id: 7,
                roleCode: "CANDIDATE",
                firstName: "An",
                lastName: "Nguyễn",
                image: "/avatar.png",
            })
        );
        render(<Header />);

        expect(await screen.findByText("An Nguyễn")).toBeInTheDocument();
        expect(getNotificationByUserService).toHaveBeenCalledWith({
            userId: 7,
            limit: 10,
            offset: 0,
        });
        expect(getListChatConversationService).toHaveBeenCalledTimes(1);
        expect(await screen.findByText("2")).toBeInTheDocument();
        expect(await screen.findByText("3")).toBeInTheDocument();
        const profileButton = screen.getByRole("button", { name: /An Nguyễn/ });
        expect(profileButton).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(profileButton);
        expect(profileButton).toHaveAttribute("aria-expanded", "true");
        expect(document.getElementById("public-profile-menu")).toHaveClass("show");
        expect(screen.getByRole("link", { name: /Thông tin/ })).toHaveAttribute(
            "href",
            "/candidate/info"
        );
        expect(screen.getByRole("link", { name: /Cài đặt nâng cao/ })).toHaveAttribute(
            "href",
            "/candidate/usersetting"
        );
        expect(socket.on).toHaveBeenCalledWith("chat:new-message", expect.any(Function));
        expect(socket.on).toHaveBeenCalledWith("notification:new", expect.any(Function));
    });

    it("renders profile routes but no chat/dashboard shortcuts for an unattached employer", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({
                id: 8,
                roleCode: "EMPLOYER",
                firstName: "Nhà",
                lastName: "Tuyển dụng",
            })
        );
        render(<Header />);

        expect(await screen.findByText("Nhà Tuyển dụng")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Nhà Tuyển dụng/ }));
        expect(screen.getByRole("link", { name: /Thông tin/ })).toHaveAttribute(
            "href",
            "/admin/user-info/"
        );
        expect(screen.getByRole("link", { name: /Đổi mật khẩu/ })).toHaveAttribute(
            "href",
            "/admin/changepassword/"
        );
        expect(screen.queryByText("Công việc đã nộp")).not.toBeInTheDocument();
        expect(screen.queryByText("Việc làm đã lưu")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: /Tin nhắn/ })).not.toBeInTheDocument();
        expect(getListChatConversationService).not.toHaveBeenCalled();
        expect(socket.on).not.toHaveBeenCalledWith("chat:new-message", expect.any(Function));
    });

    it("shows chat and loads its badge for ADMIN", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 8, roleCode: "ADMIN", firstName: "Admin", lastName: "User" })
        );
        render(<Header />);

        expect(await screen.findByText("Admin User")).toBeInTheDocument();
        expect(await screen.findByText("3")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /Admin User/ }));
        expect(screen.getAllByRole("link", { name: /Tin nhắn/ })).toHaveLength(2);
        expect(getListChatConversationService).toHaveBeenCalledTimes(1);
        expect(socket.on).toHaveBeenCalledWith("chat:new-message", expect.any(Function));
    });

    it("hides chat and skips its API for COMPANY without backend chat permission", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 8, roleCode: "COMPANY", firstName: "COMPANY", lastName: "User" })
        );
        render(<Header />);

        expect(await screen.findByText("COMPANY User")).toBeInTheDocument();
        await waitFor(() => expect(getNotificationByUserService).toHaveBeenCalledTimes(1));
        expect(screen.queryByRole("link", { name: /Tin nhắn/ })).not.toBeInTheDocument();
        expect(getListChatConversationService).not.toHaveBeenCalled();
        expect(socket.on).not.toHaveBeenCalledWith("chat:new-message", expect.any(Function));
    });

    it.each(["COMPANY", "EMPLOYER"])(
        "shows chat and loads its badge for an attached %s",
        async (roleCode) => {
            localStorage.setItem(
                "userData",
                JSON.stringify({
                    id: 8, roleCode, companyId: 4,
                    companyStatusCode: "S1", companyCensorCode: "CS1",
                    firstName: roleCode, lastName: "User",
                })
            );
            render(<Header />);

            expect(await screen.findByText(`${roleCode} User`)).toBeInTheDocument();
            expect(await screen.findByText("3")).toBeInTheDocument();
            fireEvent.click(screen.getByRole("button", { name: new RegExp(`${roleCode} User`) }));
            expect(screen.getAllByRole("link", { name: /Tin nhắn/ })).toHaveLength(2);
            expect(getListChatConversationService).toHaveBeenCalledTimes(1);
            expect(socket.on).toHaveBeenCalledWith("chat:new-message", expect.any(Function));
        }
    );

    it("opens notifications, marks one or all as read, and closes with Escape", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 7, roleCode: "CANDIDATE", firstName: "An", lastName: "N" })
        );
        render(<Header />);
        await screen.findByText("An N");

        fireEvent.click(screen.getByRole("button", { name: "Thông báo" }));
        expect(screen.getByText("Hồ sơ đã được xem")).toBeInTheDocument();
        fireEvent.click(screen.getByText("Hồ sơ đã được xem"));
        await waitFor(() =>
            expect(markReadNotificationService).toHaveBeenCalledWith({ userId: 7, id: 11 })
        );
        await waitFor(() =>
            expect(screen.queryByText("Hồ sơ đã được xem")).not.toBeInTheDocument()
        );

        fireEvent.click(screen.getByRole("button", { name: "Thông báo" }));
        fireEvent.click(screen.getByText("Đọc tất cả"));
        await waitFor(() =>
            expect(markReadNotificationService).toHaveBeenLastCalledWith({ userId: 7 })
        );
        expect(screen.queryByText("2")).not.toBeInTheDocument();

        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByText("Đọc tất cả")).not.toBeInTheDocument();
    });

    it('links candidates to their notification history from the bell and account menus', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 7, roleCode: 'CANDIDATE', firstName: 'An', lastName: 'N' }));
        render(<Header />);
        await screen.findByText('2');
        fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
        expect(screen.getByRole('link', { name: 'Xem tất cả thông báo' })).toHaveAttribute('href', '/candidate/notifications');
        fireEvent.click(screen.getByRole('button', { name: /An N/ }));
        expect(screen.getByRole('link', { name: 'Thông báo tài khoản' })).toHaveAttribute('href', '/candidate/notifications');
        fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
        const mobile = screen.getByRole('navigation', { name: 'Điều hướng di động' });
        expect(within(mobile).getByRole('link', { name: 'Thông báo tài khoản' })).toHaveAttribute('href', '/candidate/notifications');
        fireEvent.click(within(mobile).getByRole('button', { name: 'Thông báo (2)' }));
        expect(within(mobile).getByRole('link', { name: 'Xem tất cả thông báo' })).toHaveAttribute('href', '/candidate/notifications');
    });

    it('refreshes the bell after a read on the account page without a realtime socket', async () => {
        localStorage.setItem('userData', JSON.stringify({ id: 7, roleCode: 'CANDIDATE' }));
        getSocket.mockReturnValue(null);
        render(<Header />);
        await screen.findByText('2');
        getNotificationByUserService.mockResolvedValue({ errCode: 0, unreadCount: 0, data: [] });
        await act(async () => { notifyNotificationsUpdated('account'); });
        expect(screen.queryByText('2')).not.toBeInTheDocument();
        expect(getNotificationByUserService).toHaveBeenCalledTimes(2);
    });

    it("opens the account menu with React and closes it outside or with Escape", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 7, roleCode: "CANDIDATE", firstName: "Menu", lastName: "User" })
        );
        render(<Header />);
        const profileButton = await screen.findByRole("button", { name: /Menu User/ });
        const initialScrollY = window.scrollY;

        fireEvent.click(profileButton);
        expect(profileButton).toHaveAttribute("aria-expanded", "true");
        const profileMenu = document.getElementById("public-profile-menu");
        expect(profileMenu).toHaveClass("show");
        expect(profileMenu).toHaveStyle({
            position: "absolute",
            top: "100%",
            right: "0px",
            left: "auto",
        });
        expect(window.scrollY).toBe(initialScrollY);
        fireEvent.mouseDown(document.body);
        expect(profileButton).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(profileButton);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(profileButton).toHaveAttribute("aria-expanded", "false");
    });

    it("provides a working React navigation menu on mobile", async () => {
        render(<Header />);
        const menuButton = screen.getByRole("button", { name: "Menu" });

        expect(menuButton).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(menuButton);
        expect(menuButton).toHaveAttribute("aria-expanded", "true");
        const mobileNavigation = screen.getByRole("navigation", { name: "Điều hướng di động" });
        expect(mobileNavigation).toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: "Việc làm" })).toHaveLength(2);
        const mobileLoginLink = within(mobileNavigation).getByRole("link", { name: "Đăng nhập" });
        mobileLoginLink.addEventListener("click", event => event.preventDefault(), { once: true });
        fireEvent.click(mobileLoginLink);
        expect(menuButton).toHaveAttribute("aria-expanded", "false");
    });

    it("refreshes immediately for socket events and removes listeners on unmount", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 9, roleCode: "CANDIDATE", firstName: "Socket", lastName: "User" })
        );
        const { unmount } = render(<Header />);
        await waitFor(() =>
            expect(socket.on).toHaveBeenCalledWith("notification:new", expect.any(Function))
        );

        await act(async () => {
            socketHandlers["notification:new"]();
        });
        expect(getNotificationByUserService).toHaveBeenCalledTimes(2);
        expect(getListChatConversationService).toHaveBeenCalledTimes(2);

        unmount();
        expect(socket.off).toHaveBeenCalledWith("chat:new-message", expect.any(Function));
        expect(socket.off).toHaveBeenCalledWith("notification:new", expect.any(Function));
    });

    it("keeps the chat badge available when notification loading fails", async () => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 9, roleCode: "CANDIDATE", firstName: "Mạng", lastName: "Chậm" })
        );
        getNotificationByUserService.mockRejectedValue(new Error("offline"));
        getListChatConversationService.mockResolvedValue({ errCode: 0, totalUnread: 4 });
        render(<Header />);

        expect(await screen.findByText("Mạng Chậm")).toBeInTheDocument();
        expect(await screen.findByText("4")).toBeInTheDocument();
    });

    it("keeps one stable sticky shell without adding fixed-position classes", async () => {
        render(<Header />);
        await screen.findByRole("link", { name: "Đăng kí" });
        Object.defineProperty(window, "scrollY", { configurable: true, value: 20 });
        fireEvent.scroll(window);
        expect(screen.getByTestId("public-header-shell")).toHaveClass("public-header-shell");
        expect(screen.getByTestId("public-header-area")).not.toHaveClass("sticky");
    });

    it("disconnects and clears credentials when logging out", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 10, roleCode: "CANDIDATE", firstName: "Log", lastName: "Out" })
        );
        localStorage.setItem("token_user", "secret");
        render(<Header />);
        await screen.findByText("Log Out");

        fireEvent.click(screen.getByRole("button", { name: /Log Out/ }));
        fireEvent.click(screen.getByText("Đăng xuất"));
        await waitFor(() => expect(disconnectSocket).toHaveBeenCalledTimes(1));
        expect(localStorage.getItem("userData")).toBeNull();
        expect(localStorage.getItem("token_user")).toBeNull();
        consoleError.mockRestore();
    });
});
