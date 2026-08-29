import { io } from "socket.io-client";
import { disconnectSocket, getSocket } from "./socket";

jest.mock("socket.io-client", () => ({
    io: jest.fn(),
}));

const makeSocket = () => {
    const handlers = {};
    return {
        auth: null,
        on: jest.fn((event, handler) => { handlers[event] = handler; }),
        disconnect: jest.fn(),
        handlers,
    };
};

describe("shared Socket.IO client", () => {
    beforeEach(() => {
        disconnectSocket();
        localStorage.clear();
        jest.clearAllMocks();
    });

    afterEach(() => disconnectSocket());

    it("does not connect an anonymous browser", () => {
        expect(getSocket()).toBeNull();
        expect(io).not.toHaveBeenCalled();
    });

    it("connects with the token and resilient transport options", () => {
        const socket = makeSocket();
        socket.auth = { token: "token-a" };
        io.mockReturnValue(socket);
        localStorage.setItem("token_user", "token-a");

        expect(getSocket()).toBe(socket);
        expect(io).toHaveBeenCalledWith(process.env.REACT_APP_BACKEND_URL || "http://localhost:5000", {
            auth: { token: "token-a" },
            transports: ["websocket", "polling"],
            reconnectionAttempts: 5,
            reconnectionDelay: 2000,
            autoConnect: true,
        });
        expect(socket.on).toHaveBeenCalledWith("connect_error", expect.any(Function));
    });

    it("reuses the connection while the token is unchanged", () => {
        const socket = makeSocket();
        socket.auth = { token: "same" };
        io.mockReturnValue(socket);
        localStorage.setItem("token_user", "same");
        expect(getSocket()).toBe(socket);
        expect(getSocket()).toBe(socket);
        expect(io).toHaveBeenCalledTimes(1);
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it("disconnects and recreates the client when the account changes", () => {
        const first = makeSocket();
        first.auth = { token: "old" };
        const second = makeSocket();
        second.auth = { token: "new" };
        io.mockReturnValueOnce(first).mockReturnValueOnce(second);
        localStorage.setItem("token_user", "old");
        getSocket();

        localStorage.setItem("token_user", "new");
        expect(getSocket()).toBe(second);
        expect(first.disconnect).toHaveBeenCalledTimes(1);
        expect(io).toHaveBeenCalledTimes(2);
    });

    it("warns without throwing on connection errors", () => {
        const socket = makeSocket();
        socket.auth = { token: "token" };
        io.mockReturnValue(socket);
        localStorage.setItem("token_user", "token");
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        getSocket();

        socket.handlers.connect_error(new Error("refused"));
        expect(warn).toHaveBeenCalledWith("Socket khong ket noi duoc, dung che do poll:", "refused");
        warn.mockRestore();
    });

    it("disconnectSocket is idempotent and allows a clean reconnect", () => {
        const first = makeSocket();
        first.auth = { token: "token" };
        const second = makeSocket();
        second.auth = { token: "token" };
        io.mockReturnValueOnce(first).mockReturnValueOnce(second);
        localStorage.setItem("token_user", "token");
        getSocket();
        disconnectSocket();
        disconnectSocket();
        expect(first.disconnect).toHaveBeenCalledTimes(1);
        expect(getSocket()).toBe(second);
    });
});
