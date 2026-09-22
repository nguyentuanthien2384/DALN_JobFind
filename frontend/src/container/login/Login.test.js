jest.mock('../../auth/authClient', () => ({ ...jest.requireActual('../../auth/authClient'), getProviders: jest.fn(), startSocialLogin: jest.fn(), refreshSession: jest.fn() }));
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "react-toastify";
import { handleLoginService } from "../../service/userService";
import Login from "./Login";
import { getProviders, startSocialLogin, refreshSession } from '../../auth/authClient';
import { useLocation } from 'react-router-dom';
import { readApplicationIntent, rememberApplicationIntent } from '../../auth/applicationIntent';

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
        await screen.findByText(/Google, GitHub, Auth0 chưa được bật/);
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
        sessionStorage.clear();
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
        sessionStorage.clear();
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
    it('only enables configured providers and carries remember-me into SSO', async () => {
        getProviders.mockResolvedValueOnce({ google: false, github: true, auth0: false });
        renderLogin();
        const github = await screen.findByRole('button', { name: 'Đăng nhập bằng GitHub' });
        await waitFor(() => expect(github).toBeEnabled());
        expect(screen.getByRole('button', { name: 'Đăng nhập bằng Auth0' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Đăng nhập bằng Google' })).toBeDisabled();
        expect(screen.getByText(/Google, Auth0 chưa được bật/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: /Ghi nhớ/ }));
        fireEvent.click(github);
        expect(startSocialLogin).toHaveBeenCalledWith('github', { rememberMe: true });
    });
    it('keeps all providers visible and explains why they cannot be used before configuration', async () => {
        renderLogin();
        await screen.findByText(/Google, GitHub, Auth0 chưa được bật/);
        for (const provider of ['Google', 'GitHub', 'Auth0']) {
            const button = screen.getByRole('button', { name: `Đăng nhập bằng ${provider}` });
            expect(button).toBeVisible();
            expect(button).toBeDisabled();
            expect(button).toHaveAccessibleDescription(/Google, GitHub, Auth0 chưa được bật/);
            fireEvent.click(button);
        }
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
        await screen.findByText(/Google, GitHub, Auth0 chưa được bật/);
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
        await screen.findByText(/Google, GitHub, Auth0 chưa được bật/);
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
        await screen.findByText(/Google, GitHub, Auth0 chưa được bật/);
        expect(refreshSession).not.toHaveBeenCalled();
    });
});

describe('Login while preparing an application', () => {
    const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
    beforeEach(() => {
        localStorage.clear(); sessionStorage.clear(); jest.clearAllMocks();
        useLocation.mockReturnValue({ state: { from: '/account/security' } });
        getProviders.mockResolvedValue({ google: false });
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { origin: 'http://localhost', search: '', href: '/login', replace: jest.fn() },
        });
        rememberApplicationIntent({ jobId: 7, jobTitle: 'Kỹ sư phần mềm' });
        localStorage.setItem('lastUrl', '/detail-job/2');
    });
    afterEach(() => {
        Object.defineProperty(window, 'location', originalLocation);
        sessionStorage.clear();
    });

    it.each(['CANDIDATE', 'EMPLOYER'])('returns a password login as %s to the intended job before any other destination', async roleCode => {
        handleLoginService.mockResolvedValueOnce({ errCode: 0, user: { id: 5, roleCode }, token: 'application-token' });
        renderLogin(); fillAndSubmit();
        await waitFor(() => expect(window.location.href).toBe('/detail-job/7'));
        expect(localStorage.getItem('lastUrl')).toBeNull();
        expect(readApplicationIntent()).toMatchObject({ jobId: '7' });
    });

    it.each(['CANDIDATE', 'EMPLOYER'])('returns SSO as %s to the intended job and keeps its context for the detail page', async roleCode => {
        window.location.search = '?sso=success';
        refreshSession.mockResolvedValueOnce({ errCode: 0, user: { id: 5, roleCode }, token: 'social-application-token' });
        renderLogin();
        await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith('/detail-job/7'));
        expect(readApplicationIntent()).toMatchObject({ jobTitle: 'Kỹ sư phần mềm' });
        expect(localStorage.getItem('lastUrl')).toBeNull();
    });

    it('shows the job and retains the intent through a failed login and the registration link', async () => {
        handleLoginService.mockResolvedValueOnce({ errCode: 1, errMessage: 'Sai mật khẩu' });
        renderLogin();
        expect(screen.getByRole('status')).toHaveTextContent('Đăng nhập bằng tài khoản ứng viên để tiếp tục ứng tuyển Kỹ sư phần mềm');
        expect(screen.getByRole('link', { name: /Tạo tài khoản ngay/ })).toHaveAttribute('href', '/register');
        fillAndSubmit();
        await screen.findByText('Sai mật khẩu');
        expect(readApplicationIntent()).toMatchObject({ jobId: '7' });
        expect(screen.getByText('Kỹ sư phần mềm')).toBeInTheDocument();
    });

    it('allows returning to public job details without resuming an application later', async () => {
        renderLogin();
        const link = screen.getByRole('link', { name: 'Quay lại xem công việc' });
        expect(link).toHaveAttribute('href', '/detail-job/7');
        link.addEventListener('click', event => event.preventDefault());
        fireEvent.click(link);
        expect(readApplicationIntent()).toBeNull();
        expect(localStorage.getItem('lastUrl')).toBeNull();
        expect(screen.queryByText('Kỹ sư phần mềm')).not.toBeInTheDocument();
        await screen.findByText(/Google, GitHub, Auth0 chưa được bật/);
    });

    it('preserves the application while starting a social provider', async () => {
        getProviders.mockResolvedValueOnce({ google: true });
        renderLogin();
        const google = await screen.findByRole('button', { name: 'Đăng nhập bằng Google' });
        await waitFor(() => expect(google).toBeEnabled());
        fireEvent.click(google);
        expect(startSocialLogin).toHaveBeenCalledWith('google', { rememberMe: false });
        expect(readApplicationIntent()).toMatchObject({ jobId: '7' });
    });
});
