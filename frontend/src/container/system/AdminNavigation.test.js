jest.mock('../../auth/authClient', () => ({ logoutServer: jest.fn().mockResolvedValue(undefined) }));
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { disconnectSocket, getSocket } from "../../socket";
import {
    getListChatConversationService,
    getNotificationByUserService,
    markReadNotificationService,
} from "../../service/userService";
import { supportRequest } from "../../service/supportChatService";
import { getAllCompany, getAllPostByRoleAdminService } from "../../service/userService";
import { resetAdminAttentionForTests } from "./adminAttention";
import { notifyAdminAttentionChanged } from "./adminEvents";
import Header from "./Header";
import Menu from "./Menu";

let mockPathname = "/admin/";
const socket = { on: jest.fn(), off: jest.fn() };

jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, onClick, ...props }) => (
            <a
                href={typeof to === "string" ? to : "#"}
                onClick={(event) => { event.preventDefault(); if (onClick) onClick(event); }}
                {...props}
            >{children}</a>
        ),
        useLocation: () => ({ pathname: mockPathname }),
    };
});
jest.mock("../../socket", () => ({
    disconnectSocket: jest.fn(),
    getSocket: jest.fn(),
}));
jest.mock("../../service/userService", () => ({
    getAllCompany: jest.fn(),
    getAllPostByRoleAdminService: jest.fn(),
    getListChatConversationService: jest.fn(),
    getNotificationByUserService: jest.fn(),
    markReadNotificationService: jest.fn(),
}));
jest.mock("../../service/supportChatService", () => ({ supportRequest: jest.fn() }));

describe("system Menu", () => {
    it('reloads the chat badge on read and reconnect while suppressing hidden-tab work',async()=>{
        localStorage.setItem('userData',JSON.stringify({id:1,roleCode:'ADMIN'}));
        render(<Menu/>);await screen.findByText('3');
        const handler=event=>socket.on.mock.calls.find(([name])=>name===event)[1];
        getListChatConversationService.mockResolvedValue({errCode:0,totalUnread:0});
        await act(async()=>{await handler('chat:read')();});expect(screen.queryByText('3')).not.toBeInTheDocument();
        Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
        const count=getListChatConversationService.mock.calls.length;
        await act(async()=>{await handler('connect')();});expect(getListChatConversationService).toHaveBeenCalledTimes(count);
        Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
        await act(async()=>{window.dispatchEvent(new Event('online'));});expect(getListChatConversationService).toHaveBeenCalledTimes(count+1);
    });
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockPathname = "/admin/";
        getSocket.mockReturnValue(socket);
        getListChatConversationService.mockResolvedValue({ errCode: 0, totalUnread: 3 });
        resetAdminAttentionForTests();
        getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count: 10, data: [] });
        getAllCompany.mockResolvedValue({ errCode: 0, count: 0, data: [] });
        supportRequest.mockResolvedValue([{ status: "waiting" }, { status: "waiting" }, { status: "resolved" }]);
    });

    it("groups the ADMIN menu by business section and counts pending work", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockPathname = "/admin/list-user/";
        const { unmount } = render(<Menu />);

        const sections = screen.getAllByRole("listitem").filter(item => item.classList.contains("jf-nav-section"));
        expect(sections.map(item => item.textContent)).toEqual(["Kiểm duyệt & hỗ trợ", "Báo cáo", "Kinh doanh", "Hệ thống"]);
        const users = screen.getByRole("link", { name: "Người dùng" });
        expect(users).toHaveAttribute("aria-current", "page");
        expect(users.closest("li")).toHaveClass("active");
        expect(screen.getByRole("link", { name: "Gói đăng tin" })).toHaveAttribute("href", "/admin/list-package-post/");
        expect(screen.queryByText("Thêm người dùng")).not.toBeInTheDocument();
        expect(screen.queryByText("Tạo mới công ty")).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Tin nhắn/ })).toHaveAttribute("href", "/admin/chat");
        expect(await screen.findByText("3")).toBeInTheDocument();
        expect(await screen.findByTitle("10 tin chờ duyệt")).toHaveTextContent("10");
        expect(screen.getByRole("link", { name: /Yêu cầu hỗ trợ/ })).toHaveTextContent("2");
        // Nothing pending is not a badge.
        expect(screen.getByRole("link", { name: "Công ty" })).not.toHaveTextContent("0");
        expect(getListChatConversationService).toHaveBeenCalledTimes(1);
        expect(socket.on).toHaveBeenCalledWith("chat:new-message", expect.any(Function));

        const chatHandler = socket.on.mock.calls.find(([event]) => event === "chat:new-message")[1];

        unmount();
        expect(socket.off).toHaveBeenCalledWith("chat:new-message", chatHandler);
    });

    it("highlights the parent list and opens its group on a page that is not in the menu", () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockPathname = "/admin/edit-job-skill/IT-REACT/";
        render(<Menu />);
        expect(screen.getByText("Danh mục tuyển dụng").closest("a")).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("link", { name: "Kỹ năng" })).toHaveClass("active");
        expect(screen.getByRole("link", { name: "Ngành nghề" })).not.toHaveClass("active");
    });

    it("refreshes pending-work badges right after a moderation action", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        render(<Menu />);
        expect(await screen.findByTitle("10 tin chờ duyệt")).toBeInTheDocument();
        getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count: 9, data: [] });
        await act(async () => { notifyAdminAttentionChanged(); });
        expect(await screen.findByTitle("9 tin chờ duyệt")).toBeInTheDocument();
        expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2);
    });

    it("does not load administrator work counts for recruiters", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 3, roleCode: "COMPANY", companyId: 5, companyStatusCode: "S1", companyCensorCode: "CS1",
        }));
        render(<Menu />);
        await screen.findByText("3");
        expect(getAllPostByRoleAdminService).not.toHaveBeenCalled();
        expect(supportRequest).not.toHaveBeenCalled();
        expect(screen.getAllByRole("listitem").filter(item => item.classList.contains("jf-nav-section"))
            .map(item => item.textContent)).toEqual(["Tuyển dụng", "Doanh nghiệp"]);
    });

    it("limits an unattached employer menu to company creation and skips chat/dashboard work", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 2, roleCode: "EMPLOYER" }));
        render(<Menu />);

        expect(screen.getByText("Tạo mới công ty")).toBeInTheDocument();
        expect(screen.queryByText("Tạo mới bài đăng")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Tổng quan" })).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Tin nhắn" })).not.toBeInTheDocument();
        expect(getListChatConversationService).not.toHaveBeenCalled();
        expect(socket.on).not.toHaveBeenCalledWith("chat:new-message", expect.any(Function));
    });

    it("shows recruiting and chat, but not owner-only actions, for an attached employer", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 2, roleCode: "EMPLOYER", companyId: 9,
            companyStatusCode: "S1", companyCensorCode: "CS1",
        }));
        const { unmount } = render(<Menu />);

        expect(screen.getByText("Tạo mới bài đăng")).toBeInTheDocument();
        expect(screen.getByText("Quy trình tuyển dụng")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Tổng quan" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Tin nhắn/ })).toBeInTheDocument();
        expect(screen.queryByText("Mua thêm lượt đăng bài")).not.toBeInTheDocument();
        expect(screen.queryByText("Danh sách nhân viên")).not.toBeInTheDocument();
        expect(await screen.findByText("3")).toBeInTheDocument();
        expect(getListChatConversationService).toHaveBeenCalledTimes(1);
        expect(socket.on).toHaveBeenCalledWith("chat:new-message", expect.any(Function));

        const chatHandler = socket.on.mock.calls.find(([event]) => event === "chat:new-message")[1];
        await act(async () => chatHandler());
        expect(getListChatConversationService).toHaveBeenCalledTimes(2);
        unmount();
        expect(socket.off).toHaveBeenCalledWith("chat:new-message", chatHandler);
    });

    it("shows owner-only company, purchase and transaction actions to attached COMPANY", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 3, roleCode: "COMPANY", companyId: 5,
            companyStatusCode: "S1", companyCensorCode: "CS1",
        }));
        render(<Menu />);

        expect(screen.getByText("Thông tin công ty")).toBeInTheDocument();
        expect(screen.getByText("Danh sách nhân viên")).toBeInTheDocument();
        expect(screen.getByText("Mua thêm lượt đăng bài")).toBeInTheDocument();
        expect(screen.getByText("Mua thêm lượt xem ứng viên")).toBeInTheDocument();
        expect(screen.getByText("Lịch sử gói bài đăng")).toBeInTheDocument();
        expect(screen.queryByText("Danh sách người dùng")).not.toBeInTheDocument();
        expect(await screen.findByText("3")).toBeInTheDocument();
    });

    it("shows only company information to a pending COMPANY", () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 4, roleCode: "COMPANY", companyId: 5,
            companyStatusCode: "S1", companyCensorCode: "CS3",
        }));
        render(<Menu />);

        expect(screen.getByText("Thông tin công ty")).toBeInTheDocument();
        expect(screen.queryByText("Tuyển dụng vào công ty")).not.toBeInTheDocument();
        expect(screen.queryByText("Danh sách nhân viên")).not.toBeInTheDocument();
        expect(screen.queryByText("Thêm nhân viên")).not.toBeInTheDocument();
    });

    it("keeps exactly one accordion group open and closes it from the home/chat links", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 3, roleCode: "COMPANY", companyId: 5,
            companyStatusCode: "S1", companyCensorCode: "CS1",
        }));
        render(<Menu />);
        const company = await screen.findByText("Quản lý công ty");
        const post = screen.getByText("Quản lý bài đăng");

        fireEvent.click(company);
        expect(company.closest("a")).toHaveAttribute("aria-expanded", "true");
        fireEvent.click(post);
        expect(company.closest("a")).toHaveAttribute("aria-expanded", "false");
        expect(post.closest("a")).toHaveAttribute("aria-expanded", "true");
        fireEvent.click(screen.getByRole("link", { name: "Tổng quan" }));
        expect(post.closest("a")).toHaveAttribute("aria-expanded", "false");
    });
});

describe("system Header", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        document.body.className = "";
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "ADMIN", image: "/avatar.png" }));
        getSocket.mockReturnValue(socket);
        getNotificationByUserService.mockResolvedValue({
            errCode: 0,
            unreadCount: 2,
            data: [
                { id: 11, content: "Có CV mới", isChecked: 0 },
                { id: 12, content: "Tin đã đọc", isChecked: 1 },
            ],
        });
        markReadNotificationService.mockResolvedValue({ errCode: 0 });
        window.matchMedia.mockImplementation((query) => ({
            matches: false,
            media: query,
            addListener: jest.fn(),
            removeListener: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn(),
        }));
    });

    it("loads notifications, handles realtime refresh and marks all as read", async () => {
        const { unmount } = render(<Header />);
        expect(await screen.findByText("2")).toBeInTheDocument();
        expect(getNotificationByUserService).toHaveBeenCalledWith({ userId: 7, limit: 10, offset: 0 });
        expect(socket.on).toHaveBeenCalledWith("notification:new", expect.any(Function));

        await act(async () => socket.on.mock.calls[0][1]());
        expect(getNotificationByUserService).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole("button", { name: "Thông báo" }));
        expect(screen.getByText("Có CV mới")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Đọc tất cả" }));
        await waitFor(() => expect(markReadNotificationService).toHaveBeenCalledWith({ userId: 7 }));
        await waitFor(() => expect(screen.queryByRole("button", { name: "Đọc tất cả" })).not.toBeInTheDocument());

        unmount();
        expect(socket.off).toHaveBeenCalledWith("notification:new", expect.any(Function));
    });

    it("marks one notification, decrements safely and closes the popup", async () => {
        render(<Header />);
        await screen.findByText("2");
        fireEvent.click(screen.getByRole("button", { name: "Thông báo" }));
        fireEvent.click(screen.getByText("Có CV mới"));
        await waitFor(() => expect(markReadNotificationService).toHaveBeenCalledWith({ userId: 7, id: 11 }));
        await waitFor(() => expect(screen.queryByText("Có CV mới")).not.toBeInTheDocument());
        expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("closes notifications on outside click and toggles desktop/mobile sidebar state", async () => {
        render(
            <>
                <Header />
                <nav className="sidebar-offcanvas" aria-label="Thanh menu kiểm thử" />
            </>
        );
        await screen.findByText("2");
        fireEvent.click(screen.getByRole("button", { name: "Thông báo" }));
        expect(screen.getByText("Có CV mới")).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText("Có CV mới")).not.toBeInTheDocument();

        const sidebarButton = screen.getByRole("button", { name: "Thu gọn thanh menu" });
        fireEvent.click(sidebarButton);
        expect(document.body).toHaveClass("sidebar-icon-only");
        expect(screen.getByRole("button", { name: "Mở thanh menu" })).toHaveAttribute("aria-expanded", "false");

        const mobileSidebarButton = screen.getByRole("button", { name: "Mở menu trên điện thoại" });
        fireEvent.click(mobileSidebarButton);
        expect(screen.getByLabelText("Thanh menu kiểm thử")).toHaveClass("active");
        expect(screen.getByRole("button", { name: "Đóng menu trên điện thoại" })).toHaveAttribute("aria-expanded", "true");
    });

    it("opens the account menu and closes it with Escape", async () => {
        render(<Header />);
        const profileButton = await screen.findByRole("button", { name: "Tài khoản" });

        expect(profileButton).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(profileButton);
        expect(profileButton).toHaveAttribute("aria-expanded", "true");
        expect(document.getElementById("system-profile-menu")).toHaveClass("show");
        fireEvent.keyDown(document, { key: "Escape" });
        expect(profileButton).toHaveAttribute("aria-expanded", "false");
    });

    it("disconnects and clears both authentication values on logout", async () => {
        localStorage.setItem("token_user", "token");
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        render(<Header />);
        await screen.findByAltText("profile");
        fireEvent.click(screen.getByRole("button", { name: "Tài khoản" }));
        fireEvent.click(screen.getByText("Đăng xuất"));
        await waitFor(() => expect(disconnectSocket).toHaveBeenCalledTimes(1));
        expect(localStorage.getItem("userData")).toBeNull();
        expect(localStorage.getItem("token_user")).toBeNull();
        consoleError.mockRestore();
    });

    it("keeps navigation usable when notifications are temporarily unavailable", async () => {
        getNotificationByUserService.mockRejectedValue(new Error("offline"));
        render(<Header />);

        expect(await screen.findByAltText("profile")).toBeInTheDocument();
        expect(screen.getAllByRole("link", { name: "logo" })).toHaveLength(2);
        screen.getAllByRole("link", { name: "logo" }).forEach((link) => {
            expect(link).toHaveAttribute("href", "/admin/");
        });
    });

    it("shows who is signed in and links to the public site in a new tab", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "ADMIN", image: "/avatar.png", firstName: "Nguyễn", lastName: "Thiền" }));
        render(<Header />);
        const profile = await screen.findByRole("button", { name: "Tài khoản" });
        expect(profile).toHaveTextContent("Nguyễn Thiền");
        expect(profile).toHaveTextContent("Quản trị viên");
        const site = screen.getByRole("link", { name: /Xem trang tuyển dụng/ });
        expect(site).toHaveAttribute("href", "/");
        expect(site).toHaveAttribute("target", "_blank");
        expect(site).toHaveAttribute("rel", "noopener noreferrer");
        fireEvent.click(profile);
        expect(within(document.getElementById("system-profile-menu")).getByText("Nguyễn Thiền")).toBeInTheDocument();
    });

    it("shows an initial instead of a broken image when the account has no avatar", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 7, roleCode: "ADMIN", image: "", firstName: "NT", lastName: "Thiền" }));
        render(<Header />);
        const profile = await screen.findByRole("button", { name: "Tài khoản" });
        expect(screen.queryByAltText("profile")).toBeNull();
        expect(within(profile).getByText("N")).toBeInTheDocument();
    });

    it("sends an employer without companyId from the logo to company creation", async () => {
        localStorage.setItem("userData", JSON.stringify({
            id: 8,
            roleCode: "EMPLOYER",
            image: "/avatar.png",
        }));
        render(<Header />);

        expect(await screen.findByAltText("profile")).toBeInTheDocument();
        screen.getAllByRole("link", { name: "logo" }).forEach((link) => {
            expect(link).toHaveAttribute("href", "/admin/add-company/");
        });
    });
});
