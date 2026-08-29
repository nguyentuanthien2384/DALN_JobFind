import { act, renderHook } from "@testing-library/react";
import { getSocket } from "../socket";
import useAutoRefresh from "./useAutoRefresh";

jest.mock("../socket", () => ({
    getSocket: jest.fn(),
}));

const setVisibility = (value) => {
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value,
    });
};

describe("useAutoRefresh", () => {
    let socket;

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date("2026-08-29T12:00:00Z"));
        setVisibility("visible");
        socket = { on: jest.fn(), off: jest.fn() };
        getSocket.mockReturnValue(socket);
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it("polls only while the page is visible", async () => {
        const refresh = jest.fn().mockResolvedValue(undefined);
        const { result, unmount } = renderHook(() => useAutoRefresh(refresh, { khoangPoll: 1000 }));

        setVisibility("hidden");
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
        });
        expect(refresh).not.toHaveBeenCalled();

        setVisibility("visible");
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(result.current.dangTai).toBe(false);
        expect(result.current.capNhatLuc).toBeInstanceOf(Date);
        expect(result.current.capNhatLuc.getTime()).toBe(Date.now());
        unmount();
    });

    it("debounces socket and visibility refresh signals", async () => {
        const refresh = jest.fn().mockResolvedValue(undefined);
        const { unmount } = renderHook(() => useAutoRefresh(refresh, { khoangPoll: 5000 }));
        const socketHandler = socket.on.mock.calls.find(([event]) => event === "dashboard:changed")[1];

        act(() => {
            socketHandler();
            socketHandler();
            document.dispatchEvent(new Event("visibilitychange"));
            jest.advanceTimersByTime(499);
        });
        expect(refresh).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(1);
            await Promise.resolve();
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("uses the latest callback without rebuilding its interval", async () => {
        const first = jest.fn().mockResolvedValue(undefined);
        const second = jest.fn().mockResolvedValue(undefined);
        const { rerender, unmount } = renderHook(({ callback }) => useAutoRefresh(callback, { khoangPoll: 1000 }), {
            initialProps: { callback: first },
        });

        rerender({ callback: second });
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
        });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        unmount();
    });

    it("does not overlap refresh requests", async () => {
        let resolveRequest;
        const refresh = jest.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
        const { result, unmount } = renderHook(() => useAutoRefresh(refresh, { bat: false }));

        let firstRequest;
        await act(async () => {
            firstRequest = result.current.lamMoi();
            result.current.lamMoi();
            await Promise.resolve();
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(result.current.dangTai).toBe(true);

        await act(async () => {
            resolveRequest();
            await firstRequest;
        });
        expect(result.current.dangTai).toBe(false);
        unmount();
    });

    it("swallows a refresh failure and resets loading state", async () => {
        const failure = new Error("offline");
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const { result, unmount } = renderHook(() => useAutoRefresh(() => Promise.reject(failure), { bat: false }));

        await act(async () => {
            await result.current.lamMoi();
        });
        expect(warn).toHaveBeenCalledWith("Khong tai lai duoc du lieu dashboard:", failure);
        expect(result.current.dangTai).toBe(false);
        expect(result.current.capNhatLuc).toBeNull();
        warn.mockRestore();
        unmount();
    });

    it("does not install automatic listeners when disabled", () => {
        const interval = jest.spyOn(window, "setInterval");
        const { unmount } = renderHook(() => useAutoRefresh(jest.fn(), { bat: false }));
        expect(getSocket).not.toHaveBeenCalled();
        expect(interval).not.toHaveBeenCalled();
        unmount();
        interval.mockRestore();
    });

    it("works without a socket and removes all listeners on cleanup", () => {
        getSocket.mockReturnValue(null);
        const remove = jest.spyOn(document, "removeEventListener");
        const clearInterval = jest.spyOn(window, "clearInterval");
        const { unmount } = renderHook(() => useAutoRefresh(jest.fn(), { khoangPoll: 1000 }));
        unmount();
        expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
        expect(clearInterval).toHaveBeenCalled();
        expect(socket.off).not.toHaveBeenCalled();
        remove.mockRestore();
        clearInterval.mockRestore();
    });

    it("unsubscribes the exact socket callback", () => {
        const { unmount } = renderHook(() => useAutoRefresh(jest.fn(), { khoangPoll: 1000 }));
        const callback = socket.on.mock.calls[0][1];
        unmount();
        expect(socket.off).toHaveBeenCalledWith("dashboard:changed", callback);
    });
});
