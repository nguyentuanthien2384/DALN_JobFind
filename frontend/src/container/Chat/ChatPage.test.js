import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import {
    getChatConversationService,
    getListChatConversationService,
    sendChatMessageService,
} from "../../service/userService";
import { getSocket } from "../../socket";
import ChatPage from "./ChatPage";

const mockNavigate = jest.fn();
let mockPartnerId;
let mockPathname = "/chat";

jest.mock("../../service/userService", () => ({
    getChatConversationService: jest.fn(),
    getListChatConversationService: jest.fn(),
    sendChatMessageService: jest.fn(),
}));
jest.mock("../../socket", () => ({ getSocket: jest.fn() }));
jest.mock("react-toastify", () => ({ toast: { error: jest.fn() } }));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        useNavigate: () => mockNavigate,
        useParams: () => ({ partnerId: mockPartnerId }),
        useLocation: () => ({ pathname: mockPathname }),
        Link: ({ to, children, ...props }) =>
            React.createElement("a", { href: to, ...props }, children),
    };
});

const socketHandlers = {};
const socket = {
    connected: false,
    on: jest.fn((event, handler) => {
        socketHandlers[event] = handler;
    }),
    off: jest.fn(),
    emit: jest.fn(),
    timeout: jest.fn().mockReturnThis(),
    emitWithAck: jest.fn(),
    volatile: { emit: jest.fn() },
};

const companyPartner = {
    id: 20,
    firstName: "Ignored",
    lastName: "Name",
    image: "/ignored.png",
    userCompanyData: {
        name: "Công ty Ánh Dương",
        thumbnail: "/company.png",
    },
};

const candidatePartner = {
    id: 30,
    firstName: "Mai",
    lastName: "Lan",
    image: "/candidate.png",
};

const conversations = [
    {
        partnerId: 20,
        partnerData: companyPartner,
        lastMessage: { content: "Chào ứng viên" },
        unreadCount: 2,
    },
    {
        partnerId: 30,
        partnerData: candidatePartner,
        lastMessage: { content: "Em đã gửi CV" },
        unreadCount: 0,
    },
];

const messages = [
    {
        id: 1,
        senderId: 20,
        receiverId: 7,
        content: "Bạn có thể phỏng vấn ngày mai không?",
        isRead: 1,
        createdAt: "2026-08-29T03:00:00Z",
    },
    {
        id: 2,
        senderId: 7,
        receiverId: 20,
        content: "Tôi có thể tham gia",
        isRead: 1,
        createdAt: "2026-08-29T03:01:00Z",
    },
];

describe("ChatPage", () => {
    beforeAll(() => {
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: require('crypto').webcrypto });
        Object.defineProperty(Element.prototype, "scrollIntoView", {
            configurable: true,
            value: jest.fn(),
        });
    });

    beforeEach(() => {
        localStorage.clear(); sessionStorage.clear();
        socket.timeout.mockReturnValue(socket);
        socket.emitWithAck.mockReset();
        socket.emitWithAck.mockImplementation((event) => event === 'chat:presence' ? Promise.resolve({ errCode: 1 }) : Promise.resolve({ errCode: 0 }));
        localStorage.setItem(
            "userData",
            JSON.stringify({ id: 7, firstName: "An", roleCode: "CANDIDATE" })
        );
        mockPartnerId = undefined;
        mockPathname = "/chat";
        jest.clearAllMocks();
        Object.keys(socketHandlers).forEach((event) => delete socketHandlers[event]);
        socket.connected = false;
        socket.on.mockImplementation((event, handler) => {
            socketHandlers[event] = handler;
        });
        getSocket.mockReturnValue(socket);
        getListChatConversationService.mockResolvedValue({
            errCode: 0,
            data: conversations,
        });
        getChatConversationService.mockResolvedValue({
            errCode: 0,
            data: messages,
            partnerData: companyPartner,
        });
        sendChatMessageService.mockResolvedValue({ errCode: 0 });
    });

    it("redirects an anonymous visitor and remembers the requested URL", () => {
        localStorage.clear();
        render(<ChatPage />);

        expect(toast.error).toHaveBeenCalledWith(
            "Xin hãy đăng nhập để sử dụng tính năng nhắn tin"
        );
        expect(localStorage.getItem("lastUrl")).toBe(window.location.href);
        expect(mockNavigate).toHaveBeenCalledWith("/login");
        expect(getListChatConversationService).not.toHaveBeenCalled();
        expect(screen.queryByText("Tin nhắn")).not.toBeInTheDocument();
    });

    it("renders company and candidate conversations, unread counts and empty selection", async () => {
        render(<ChatPage />);

        expect(await screen.findByText("Công ty Ánh Dương")).toBeInTheDocument();
        expect(screen.getByText("Mai Lan")).toBeInTheDocument();
        expect(screen.getByText("Chào ứng viên")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
        expect(screen.getByText("Chọn một cuộc trò chuyện để bắt đầu")).toBeInTheDocument();
        expect(screen.getByText("Công ty Ánh Dương").closest("a")).toHaveAttribute(
            "href",
            "/chat/20"
        );
        expect(getListChatConversationService).toHaveBeenCalledTimes(1);
        expect(getChatConversationService).not.toHaveBeenCalled();
    });

    it("shows the explicit empty-conversation guidance", async () => {
        getListChatConversationService.mockResolvedValueOnce({ errCode: 0, data: [] });
        render(<ChatPage />);

        expect(
            await screen.findByText(/Chưa có cuộc trò chuyện nào/)
        ).toBeInTheDocument();
    });

    it("uses admin chat links when mounted below the admin route", async () => {
        mockPathname = "/admin/chat";
        render(<ChatPage />);

        expect((await screen.findByText("Công ty Ánh Dương")).closest("a")).toHaveAttribute(
            "href",
            "/admin/chat/20"
        );
    });

    it("loads an open conversation, displays delivery state and marks it read", async () => {
        mockPartnerId = "20";
        socket.connected = true;
        render(<ChatPage />);

        expect(
            await screen.findByText("Bạn có thể phỏng vấn ngày mai không?")
        ).toBeInTheDocument();
        expect(screen.getByText("Tôi có thể tham gia")).toBeInTheDocument();
        expect(screen.getByText("Đã xem")).toBeInTheDocument();
        expect(screen.getByText("Đang kết nối trực tiếp")).toBeInTheDocument();
        expect(getChatConversationService).toHaveBeenCalledWith({ partnerId: "20" });
        expect(socket.emit).toHaveBeenCalledWith("chat:read", expect.objectContaining({ partnerId: 20, throughMessageId: expect.any(Number) }));
        expect(screen.getAllByText("Công ty Ánh Dương", { selector: "b" })).toHaveLength(2);
        expect(document.querySelector(".chat-back-btn")).toHaveAttribute("href", "/chat");
    });

    it("sends through the REST fallback and refreshes messages and conversations", async () => {
        mockPartnerId = "20";
        render(<ChatPage />);
        await screen.findByText("Tôi có thể tham gia");
        const input = screen.getByPlaceholderText("Nhập tin nhắn...");
        fireEvent.change(input, { target: { value: "  Tin nhắn mới  " } });
        fireEvent.keyDown(input, { key: "Enter" });

        await waitFor(() =>
            expect(sendChatMessageService).toHaveBeenCalledWith(expect.objectContaining({
                receiverId: 20, content: "Tin nhắn mới", clientMessageId: expect.any(String), v: 1,
            }))
        );
        await waitFor(() => expect(input).toHaveValue(""));
        expect(getChatConversationService).toHaveBeenCalledTimes(2);
        expect(getListChatConversationService).toHaveBeenCalledTimes(2);
    });

    it("keeps a failed REST message available and reports the service error", async () => {
        mockPartnerId = "20";
        sendChatMessageService.mockResolvedValueOnce({
            errCode: 2,
            errMessage: "Người nhận không tồn tại",
        });
        render(<ChatPage />);
        await screen.findByText("Tôi có thể tham gia");
        const input = screen.getByPlaceholderText("Nhập tin nhắn...");
        fireEvent.change(input, { target: { value: "Thử lại" } });
        fireEvent.click(screen.getByRole("button"));

        await waitFor(() =>
            expect(toast.error).toHaveBeenCalledWith("Người nhận không tồn tại")
        );
        expect(input).toHaveValue("Thử lại");
    });

    it("uses the socket transport and restores text when its acknowledgement fails", async () => {
        mockPartnerId = "20";
        socket.connected = true;
        render(<ChatPage />);
        await screen.findByText("Tôi có thể tham gia");
        const input = screen.getByPlaceholderText("Nhập tin nhắn...");
        socket.emitWithAck.mockResolvedValueOnce({ errCode: 2, errMessage: 'Socket từ chối' });
        fireEvent.change(input, { target: { value: "Gửi realtime" } });
        fireEvent.click(screen.getByRole("button"));

        const sendCall = socket.emitWithAck.mock.calls.find(([event]) => event === "chat:send");
        expect(sendCall[1]).toEqual(expect.objectContaining({ receiverId: 20, content: "Gửi realtime", clientMessageId: expect.any(String) }));
        expect(sendChatMessageService).not.toHaveBeenCalled();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Socket từ chối'));
        expect(input).toHaveValue("Gửi realtime");
        expect(toast.error).toHaveBeenCalledWith("Socket từ chối");
    });

    it("reacts to typing, incoming-message and read events and removes listeners", async () => {
        mockPartnerId = "20";
        socket.connected = true;
        getChatConversationService.mockResolvedValueOnce({
            errCode: 0,
            data: messages.map((item) => ({ ...item, isRead: 0 })),
            partnerData: companyPartner,
        });
        const { unmount } = render(<ChatPage />);
        await screen.findByText("Tôi có thể tham gia");

        act(() => socketHandlers["chat:typing"]({ fromUserId: 20 }));
        expect(screen.getByText("đang soạn tin nhắn...")).toBeInTheDocument();

        act(() => socketHandlers["chat:read"]({ byUserId: 20 }));
        expect(screen.getByText("Đã xem")).toBeInTheDocument();

        const incoming = {
            id: 3,
            senderId: 20,
            receiverId: 7,
            content: "Tin đến tức thì",
            isRead: 0,
            createdAt: "2026-08-29T03:02:00Z",
        };
        const listCallsBeforeMessage = getListChatConversationService.mock.calls.length;
        await act(async () => socketHandlers["chat:new-message"](incoming));
        expect(screen.getByText("Tin đến tức thì")).toBeInTheDocument();
        expect(socket.emit).toHaveBeenCalledWith("chat:read", expect.objectContaining({ partnerId: 20, throughMessageId: expect.any(Number) }));
        expect(getListChatConversationService).toHaveBeenCalledTimes(
            listCallsBeforeMessage + 1
        );

        await act(async () => socketHandlers["chat:new-message"](incoming));
        expect(screen.getAllByText("Tin đến tức thì")).toHaveLength(1);

        fireEvent.change(screen.getByPlaceholderText("Nhập tin nhắn..."), {
            target: { value: "Đang nhập" },
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 300));
        });
        expect(socket.volatile.emit).toHaveBeenCalledWith("chat:typing", { receiverId: 20 });

        unmount();
        ["connect", "disconnect", "chat:new-message", "chat:typing", "chat:read"].forEach(
            (event) => expect(socket.off).toHaveBeenCalledWith(event, expect.any(Function))
        );
    });

    it('retains an uncertain send across remount and retries with the same key without blocking the button', async () => {
        mockPartnerId = '20';
        sendChatMessageService.mockResolvedValueOnce({ errCode: -1, errorType: 'timeout', errMessage: 'Chưa xác nhận' });
        const first = render(<ChatPage />);
        await screen.findByText('Tôi có thể tham gia');
        fireEvent.change(screen.getByPlaceholderText('Nhập tin nhắn...'), { target: { value: 'Mất phản hồi' } });
        fireEvent.click(screen.getByRole('button', { name: 'Gửi tin nhắn' }));
        const retry = await screen.findByRole('button', { name: 'Gửi lại tin nhắn' });
        expect(retry).toBeEnabled();
        expect(screen.getByPlaceholderText('Nhập tin nhắn...')).toBeDisabled();
        const original = sendChatMessageService.mock.calls[0][0];
        first.unmount(); render(<ChatPage />);
        await screen.findByText('Tôi có thể tham gia');
        expect(screen.getByPlaceholderText('Nhập tin nhắn...')).toHaveValue('Mất phản hồi');
        sendChatMessageService.mockResolvedValueOnce({ errCode: 0, duplicate: true });
        fireEvent.click(screen.getByRole('button', { name: 'Gửi lại tin nhắn' }));
        await waitFor(() => expect(sendChatMessageService).toHaveBeenLastCalledWith(original));
        await waitFor(() => expect(screen.getByPlaceholderText('Nhập tin nhắn...')).toHaveValue(''));
    });

    it('reconciles messages on reconnect and preserves an event received during a stale REST response', async () => {
        mockPartnerId = '20'; socket.connected = true;
        render(<ChatPage />); await screen.findByText('Tôi có thể tham gia');
        let resolveSnapshot;
        getChatConversationService.mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
        await act(async () => socketHandlers.connect());
        await act(async () => socketHandlers['chat:new-message']({ id: 99, senderId: 20, receiverId: 7, content: 'Tin trong lúc đồng bộ' }));
        await act(async () => resolveSnapshot({ errCode: 0, data: messages, partnerData: companyPartner }));
        expect(screen.getByText('Tin trong lúc đồng bộ')).toBeInTheDocument();
        expect(getChatConversationService).toHaveBeenCalledTimes(2);
    });
    it('loads older history while preserving a new live message and removes the history button at the beginning', async () => {
        mockPartnerId = '20'; socket.connected = true;
        getChatConversationService.mockResolvedValueOnce({errCode:0, data:[{...messages[1],id:20}], partnerData:companyPartner, pageInfo:{hasMore:true}});
        render(<ChatPage />);
        const older = await screen.findByRole('button', {name:'Xem tin nhắn cũ'});
        let finish;
        getChatConversationService.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
        fireEvent.click(older); expect(older).toBeDisabled();
        await act(async () => socketHandlers['chat:new-message']({id:21,senderId:20,receiverId:7,content:'Tin mới trong lúc tải lịch sử'}));
        await act(async () => finish({errCode:0,data:[{...messages[0],id:19}],pageInfo:{hasMore:false}}));
        expect(getChatConversationService).toHaveBeenLastCalledWith({partnerId:'20',beforeId:20});
        expect(screen.getByText(messages[0].content)).toBeInTheDocument();
        expect(screen.getByText('Tin mới trong lúc tải lịch sử')).toBeInTheDocument();
        expect(screen.queryByRole('button',{name:'Xem tin nhắn cũ'})).not.toBeInTheDocument();
    });
    it('shows a recoverable history error and re-enables the button after a network exception', async () => {
        mockPartnerId='20';
        getChatConversationService.mockResolvedValueOnce({errCode:0,data:messages,partnerData:companyPartner,pageInfo:{hasMore:true}});
        render(<ChatPage />);
        const older=await screen.findByRole('button',{name:'Xem tin nhắn cũ'});
        getChatConversationService.mockRejectedValueOnce(new Error('offline'));
        fireEvent.click(older);
        await screen.findByRole('alert'); expect(older).toBeEnabled();
    });
    it('displays last-seen for an offline authorized partner and clears stale status on disconnect', async () => {
        mockPartnerId='20';socket.connected=true;
        socket.emitWithAck.mockResolvedValue({errCode:0,data:{online:false,lastSeenAt:'2026-01-03T12:00:00Z'}});
        render(<ChatPage />);
        expect(await screen.findByText(/Hoạt động lúc/)).toBeInTheDocument();
        act(() => socketHandlers.disconnect());
        expect(screen.queryByText(/Hoạt động lúc/)).not.toBeInTheDocument();
    });

});
