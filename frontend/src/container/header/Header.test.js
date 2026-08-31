import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
    getListChatConversationService,
    getNotificationByUserService,
    markReadNotificationService,
} from "../../service/userService";
import { disconnectSocket, getSocket } from "../../socket";
import Header from "./header";

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
    const React = require("react");
    const Link = ({ to, children, ...props }) =>
        React.createElement("a", { href: to, ...props }, children);
    return { Link, NavLink: Link };
});

const socketHandlers = {};
const socket = {
    on: jest.fn((event, handler) => {
        socketHandlers[event] = handler;
    }),
    off: jest.fn(),
};

describe("public Header", () => {
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

    it.each([
        ["ADMIN", 9],
        ["COMPANY", undefined],
    ])("hides chat and skips its API for %s without backend chat permission", async (roleCode, companyId) => {
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 8, roleCode, companyId, firstName: roleCode, lastName: "User" })
        );
        render(<Header />);

        expect(await screen.findByText(`${roleCode} User`)).toBeInTheDocument();
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
                JSON.stringify({ id: 8, roleCode, companyId: 4, firstName: roleCode, lastName: "User" })
            );
            render(<Header />);

            expect(await screen.findByText(`${roleCode} User`)).toBeInTheDocument();
            expect(await screen.findByText("3")).toBeInTheDocument();
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

    it("makes the header sticky after scrolling", async () => {
        render(<Header />);
        await screen.findByRole("link", { name: "Đăng kí" });
        Object.defineProperty(window, "scrollY", { configurable: true, value: 20 });
        fireEvent.scroll(window);
        expect(screen.getByTestId("public-header-area")).toHaveClass("sticky");
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

        fireEvent.click(screen.getByText("Đăng xuất"));
        expect(disconnectSocket).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem("userData")).toBeNull();
        expect(localStorage.getItem("token_user")).toBeNull();
        consoleError.mockRestore();
    });
});
