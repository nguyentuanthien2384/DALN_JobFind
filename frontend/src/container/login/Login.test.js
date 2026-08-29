import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { handleLoginService } from "../../service/userService";
import Login from "./Login";

jest.mock("../../service/userService", () => ({
    handleLoginService: jest.fn(),
}));
jest.mock("react-toastify", () => ({
    toast: { error: jest.fn(), success: jest.fn() },
}));
jest.mock("react-router-dom", () => {
    const React = require("react");
    return {
        Link: ({ to, children, ...props }) => React.createElement("a", { href: to, ...props }, children),
    };
});

const renderLogin = () => render(<Login />);

const fillAndSubmit = (phone = "0912345678", password = "secret1") => {
    fireEvent.change(screen.getByPlaceholderText("Số điện thoại"), { target: { value: phone } });
    fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
};

describe("Login", () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        window.history.replaceState({}, "", "/login");
    });

    it("submits the entered credentials and displays the backend error", async () => {
        handleLoginService.mockResolvedValue({ errCode: 1, errMessage: "Sai mật khẩu" });
        renderLogin();
        fillAndSubmit();

        await waitFor(() => expect(handleLoginService).toHaveBeenCalledWith({
            phonenumber: "0912345678",
            password: "secret1",
        }));
        expect(toast.error).toHaveBeenCalledWith("Sai mật khẩu");
        await waitFor(() => expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeEnabled());
    });

    it("uses a safe fallback when an empty error response is returned", async () => {
        handleLoginService.mockResolvedValue(null);
        renderLogin();
        fillAndSubmit();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Dang nhap that bai. Vui long thu lai."));
    });

    it("disables submit and prevents duplicate requests while logging in", async () => {
        let resolveLogin;
        handleLoginService.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
        renderLogin();
        fillAndSubmit();
        const submit = screen.getByRole("button", { name: "Đăng nhập" });
        await waitFor(() => expect(submit).toBeDisabled());
        fireEvent.click(submit);
        expect(handleLoginService).toHaveBeenCalledTimes(1);

        resolveLogin({ errCode: 1, errMessage: "No" });
        await waitFor(() => expect(submit).toBeEnabled());
    });

    it("stores an authenticated employer session", async () => {
        const user = { id: 4, roleCode: "EMPLOYER" };
        handleLoginService.mockResolvedValue({ errCode: 0, user, token: "token-4" });
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        renderLogin();
        fillAndSubmit();

        await waitFor(() => expect(localStorage.getItem("token_user")).toBe("token-4"));
        expect(JSON.parse(localStorage.getItem("userData"))).toEqual(user);
        expect(toast.error).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it("consumes the remembered URL for a candidate login", async () => {
        localStorage.setItem("lastUrl", "http://localhost/detail-job/7");
        const user = { id: 5, roleCode: "CANDIDATE" };
        handleLoginService.mockResolvedValue({ errCode: 0, user, token: "token-5" });
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
        renderLogin();
        fillAndSubmit();

        await waitFor(() => expect(localStorage.getItem("lastUrl")).toBeNull());
        expect(localStorage.getItem("token_user")).toBe("token-5");
        consoleError.mockRestore();
    });
});
