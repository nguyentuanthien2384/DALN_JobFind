import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { disconnectSocket, getSocket } from "../../socket";
import {
    getListChatConversationService,
    getNotificationByUserService,
    markReadNotificationService,
} from "../../service/userService";
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
    getListChatConversationService: jest.fn(),
    getNotificationByUserService: jest.fn(),
    markReadNotificationService: jest.fn(),
}));

describe("system Menu", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        mockPathname = "/admin/";
        getSocket.mockReturnValue(socket);
        getListChatConversationService.mockResolvedValue({ errCode: 0, totalUnread: 3 });
    });

    it("shows only platform groups for ADMIN and never loads or exposes chat", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 1, roleCode: "ADMIN" }));
        mockPathname = "/admin/list-user/";
        const { unmount } = render(<Menu />);

        expect(screen.getByText("Quản lý người dùng").closest("a")).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("link", { name: "Danh sách người dùng" })).toHaveClass("active");
        expect(screen.getByText("Quản lý gói bài đăng")).toBeInTheDocument();
        expect(screen.queryByText("Tạo mới công ty")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Tin nhắn" })).not.toBeInTheDocument();
        expect(getListChatConversationService).not.toHaveBeenCalled();
        expect(socket.on).not.toHaveBeenCalledWith("chat:new-message", expect.any(Function));

        unmount();
        expect(socket.off).not.toHaveBeenCalledWith("chat:new-message", expect.any(Function));
    });

    it("limits an unattached employer menu to company creation and skips chat/dashboard work", async () => {
        localStorage.setItem("userData", JSON.stringify({ id: 2, roleCode: "EMPLOYER" }));
        render(<Menu />);

        expect(screen.getByText("Tạo mới công ty")).toBeInTheDocument();
        expect(screen.queryByText("Tạo mới bài đăng")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Trang chủ" })).not.toBeInTheDocument();
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
        expect(screen.getByRole("link", { name: "Trang chủ" })).toBeInTheDocument();
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
        fireEvent.click(screen.getByRole("link", { name: "Trang chủ" }));
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
        render(<Header />);
        await screen.findByText("2");
        fireEvent.click(screen.getByRole("button", { name: "Thông báo" }));
        expect(screen.getByText("Có CV mới")).toBeInTheDocument();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText("Có CV mới")).not.toBeInTheDocument();

        const sidebarButton = screen.getByRole("button", { name: "Thu gọn thanh menu" });
        fireEvent.click(sidebarButton);
        expect(document.body).toHaveClass("sidebar-icon-only");
        expect(screen.getByRole("button", { name: "Mở thanh menu" })).toHaveAttribute("aria-expanded", "false");

        window.matchMedia.mockImplementationOnce(() => ({ matches: true }));
        fireEvent.click(screen.getByRole("button", { name: "Mở thanh menu" }));
        expect(document.body).not.toHaveClass("sidebar-icon-only");
        expect(document.body).toHaveClass("sidebar-hidden");
    });

    it("disconnects and clears both authentication values on logout", async () => {
        localStorage.setItem("token_user", "token");
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        render(<Header />);
        await screen.findByAltText("profile");
        fireEvent.click(screen.getByText("Đăng xuất"));
        expect(disconnectSocket).toHaveBeenCalledTimes(1);
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
