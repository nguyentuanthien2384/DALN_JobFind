jest.mock('../../auth/authClient', () => ({ ...jest.requireActual('../../auth/authClient'), getProviders: jest.fn(), startSocialLogin: jest.fn(), refreshSession: jest.fn() }));
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { handleLoginService } from "../../service/userService";
import Login from "./Login";
import { getProviders, startSocialLogin, refreshSession } from '../../auth/authClient';
import { useLocation } from 'react-router-dom';

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
        useLocation: jest.fn(() => ({ state: null })),
    };
});

const renderLogin = () => render(<Login />);

const fillAndSubmit = (phone = "0912345678", password = "secret1") => {
    fireEvent.change(screen.getByPlaceholderText("Email hoặc số điện thoại"), { target: { value: phone } });
    fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
};

describe("Login", () => {
    it('explains an expired session on the login page', async () => {
        window.history.replaceState({}, '', '/login?reason=expired');
        renderLogin();
        expect(screen.getByRole('status')).toHaveTextContent('Phiên đăng nhập đã hết hạn');
        await screen.findByText(/Đăng nhập Google chưa được bật/);
    });
    it('handles a rejected login request without leaving the submit button stuck', async () => {
        handleLoginService.mockRejectedValueOnce(new Error('network failure'));
        renderLogin();
        fillAndSubmit();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Không gửi được yêu cầu đăng nhập. Vui lòng thử lại.'));
        expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeEnabled();
    });
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        useLocation.mockReturnValue({ state: null });
        getProviders.mockResolvedValue({ google: false });
        window.history.replaceState({}, "", "/login");
    });

    it("submits the entered credentials and displays the backend error", async () => {
        handleLoginService.mockResolvedValue({ errCode: 1, errMessage: "Sai mật khẩu" });
        renderLogin();
        fillAndSubmit();

        await waitFor(() => expect(handleLoginService).toHaveBeenCalledWith({
            identifier: "0912345678",
            rememberMe: false,
            password: "secret1",
        }));
        expect(toast.error).toHaveBeenCalledWith("Sai mật khẩu");
        await waitFor(() => expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeEnabled());
    });

    it("uses a safe fallback when an empty error response is returned", async () => {
        handleLoginService.mockResolvedValue(null);
        renderLogin();
        fillAndSubmit();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Đăng nhập thất bại. Vui lòng thử lại."));
        expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập thất bại');
    });

    it("disables submit and prevents duplicate requests while logging in", async () => {
        let resolveLogin;
        handleLoginService.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve; }));
        renderLogin();
        fillAndSubmit();
        const submit = screen.getByRole("button", { name: "Đang đăng nhập..." });
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

        await waitFor(() => expect(localStorage.getItem("token_user")).toMatch(/^jf-session:/));
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
        expect(localStorage.getItem("token_user")).toMatch(/^jf-session:/);
        consoleError.mockRestore();
    });
});

describe('Login methods and form feedback', () => {
    beforeEach(() => {
        localStorage.clear(); jest.clearAllMocks();
        useLocation.mockReturnValue({ state: null });
        getProviders.mockResolvedValue({ google: false });
        window.history.replaceState({}, '', '/login');
    });
    it('submits an email with an explicit persistent-session choice', async () => {
        handleLoginService.mockResolvedValueOnce({ errCode: 1, errMessage: 'Thử lại' });
        renderLogin();
        expect(screen.getByRole('checkbox', { name: /Ghi nhớ/ })).not.toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: /Ghi nhớ/ }));
        fillAndSubmit('  person@gmail.com  ', 'legacy1');
        await waitFor(() => expect(handleLoginService).toHaveBeenCalledWith({ identifier: 'person@gmail.com', password: 'legacy1', rememberMe: true }));
    });
    it('only offers configured extra providers and carries remember-me into SSO', async () => {
        getProviders.mockResolvedValueOnce({ google: false, github: true, auth0: false });
        renderLogin();
        const github = await screen.findByRole('button', { name: 'Đăng nhập bằng GitHub' });
        expect(screen.queryByRole('button', { name: 'Đăng nhập bằng Auth0' })).toBeNull();
        fireEvent.click(screen.getByRole('checkbox', { name: /Ghi nhớ/ }));
        fireEvent.click(github);
        expect(startSocialLogin).toHaveBeenCalledWith('github', { rememberMe: true });
    });
    it('keeps Google visible and explains why it cannot be used before configuration', async () => {
        renderLogin();
        await screen.findByText(/Đăng nhập Google chưa được bật/);
        const google = screen.getByRole('button', { name: 'Đăng nhập bằng Google' });
        expect(google).toBeDisabled(); fireEvent.click(google);
        expect(startSocialLogin).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
    });
    it('checks empty fields without sending credentials and focuses the missing input', async () => {
        renderLogin();
        fireEvent.submit(screen.getByRole('form', { name: 'Đăng nhập JobFind' }));
        expect(screen.getByText('Vui lòng nhập email hoặc số điện thoại.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email hoặc số điện thoại')).toHaveFocus();
        fireEvent.change(screen.getByLabelText('Email hoặc số điện thoại'), { target: { value: '0912345678' } });
        fireEvent.submit(screen.getByRole('form'));
        expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveFocus();
        expect(handleLoginService).not.toHaveBeenCalled();
        await screen.findByText(/Đăng nhập Google chưa được bật/);
    });
    it('supports phone/password autofill and toggles password visibility without submitting', async () => {
        renderLogin();
        expect(screen.getByLabelText('Email hoặc số điện thoại')).toHaveAttribute('type', 'text');
        expect(screen.getByLabelText('Email hoặc số điện thoại')).toHaveAttribute('autocomplete', 'username');
        const password = screen.getByLabelText('Mật khẩu', { exact: true });
        expect(password).toHaveAttribute('autocomplete', 'current-password');
        fireEvent.change(password, { target: { value: 'not-a-real-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
        expect(password).toHaveAttribute('type', 'text');
        expect(password).toHaveValue('not-a-real-password');
        fireEvent.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
        expect(password).toHaveAttribute('type', 'password');
        expect(handleLoginService).not.toHaveBeenCalled();
        await screen.findByText(/Đăng nhập Google chưa được bật/);
    });
    it('recovers provider lookup after failure while keeping local login available', async () => {
        getProviders.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ google: true });
        renderLogin();
        await screen.findByText(/Chưa kiểm tra được phương thức đăng nhập/);
        expect(screen.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng Google' }));
        expect(startSocialLogin).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: /Đang chuyển đến Google/ })).toBeDisabled();
    });
    it('treats a malformed provider response as a load error', async () => {
        getProviders.mockResolvedValueOnce({ google: 'true' });
        renderLogin();
        await screen.findByText(/Chưa kiểm tra được phương thức đăng nhập/);
        expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeDisabled();
    });
    it.each([
        ['/account/security', '/account/security'],
        ['https://untrusted.example/path', null]
    ])('remembers only safe protected routes before Google (%s)', async (from, expected) => {
        useLocation.mockReturnValue({ state: { from } });
        getProviders.mockResolvedValueOnce({ google: true });
        renderLogin();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng Google' }));
        expect(localStorage.getItem('lastUrl')).toBe(expected);
    });
    it('disables local login during SSO completion and recovers on failure', async () => {
        let rejectSso;
        refreshSession.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSso = reject; }));
        window.history.replaceState({}, '', '/login?sso=success');
        renderLogin();
        expect(screen.getByRole('button', { name: 'Đang xác thực...' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Đang hoàn tất đăng nhập liên kết');
        rejectSso(new Error('invalid callback'));
        await screen.findByText('Không thể hoàn tất đăng nhập liên kết. Vui lòng đăng nhập lại.');
        expect(screen.getByRole('button', { name: 'Đăng nhập', exact: true })).toBeEnabled();
    });
    it('establishes the returned SSO session and consumes the remembered route', async () => {
        const user = { id: 21, roleCode: 'CANDIDATE' };
        refreshSession.mockResolvedValueOnce({ errCode: 0, token: 'sso-test-token', user });
        localStorage.setItem('lastUrl', '/account/security');
        window.history.replaceState({}, '', '/login?sso=success');
        // jsdom does not implement cross-document navigation; the browser suite
        // covers the real redirects for local login.
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            renderLogin();
            await waitFor(() => expect(localStorage.getItem('token_user')).toMatch(/^jf-session:/));
            expect(JSON.parse(localStorage.getItem('userData'))).toEqual(user);
            expect(localStorage.getItem('lastUrl')).toBeNull();
            expect(screen.queryByRole('alert')).toBeNull();
        } finally { consoleError.mockRestore(); }
    });
    it.each([
        ['cancelled', /Bạn đã hủy đăng nhập bằng tài khoản liên kết/],
        ['not-linked', /Tài khoản Google này chưa liên kết/],
        ['failed', /Không thể xác thực tài khoản liên kết/]
    ])('explains SSO result %s without starting a new session', async (status, message) => {
        window.history.replaceState({}, '', '/login?sso=' + status);
        renderLogin(); expect(screen.getByText(message)).toBeInTheDocument();
        await screen.findByText(/Đăng nhập Google chưa được bật/);
        expect(refreshSession).not.toHaveBeenCalled();
    });
});
