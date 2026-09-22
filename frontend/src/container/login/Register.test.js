jest.mock('../../auth/authClient', () => ({ ...jest.requireActual('../../auth/authClient'), getProviders: jest.fn(), getSocialSignup: jest.fn(), completeSocialSignup: jest.fn(), startSocialLogin: jest.fn() }));
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'react-toastify';
import { createNewUser, handleLoginService } from '../../service/userService';
import { getAccessTokenSync, getProviders, getSocialSignup, completeSocialSignup, startSocialLogin } from '../../auth/authClient';
import Register from './Register';
import { readApplicationIntent, rememberApplicationIntent } from '../../auth/applicationIntent';

jest.mock('../../service/userService', () => ({
    createNewUser: jest.fn(),
    handleLoginService: jest.fn(),
}));
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('react-router-dom', () => {
    const React = require('react');
    return { Link: ({ to, children, reloadDocument, ...props }) => React.createElement('a', { href: to, ...props }, children) };
});

const change = (label, value) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const fillProfile = ({ role = 'CANDIDATE', email = '  Lan@Gmail.com  ' } = {}) => {
    if (role === 'EMPLOYER') fireEvent.click(screen.getByRole('radio', { name: /Nhà tuyển dụng/ }));
    change('Họ', '  Nguyen  ');
    change('Tên', '  Lan  ');
    change('Email', email);
};
const nextStep = () => fireEvent.click(screen.getByRole('button', { name: /Tiếp tục/ }));
const fillAccount = ({ phone = '0912345678', password = 'secret12', confirmation = password } = {}) => {
    change('Số điện thoại', phone);
    change('Mật khẩu', password);
    change('Nhập lại mật khẩu', confirmation);
};
const submit = () => fireEvent.submit(screen.getByRole('form', { name: 'Đăng ký JobFind' }));
const completeForm = (options = {}) => {
    fillProfile(options);
    nextStep();
    fillAccount(options);
};

describe('Register', () => {
    afterEach(async () => { await act(async () => {}); });
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        jest.resetAllMocks();
        getProviders.mockResolvedValue({ google: false, github: false, auth0: false });
        window.history.replaceState({}, '', '/register');
    });

    it('offers only the two public roles and shows profile fields before credentials', async () => {
        render(<Register />);
        await act(async () => {});
        expect(screen.getAllByRole('radio')).toHaveLength(2);
        expect(screen.getByRole('radio', { name: /Ứng viên/ })).toBeChecked();
        expect(screen.getByRole('radio', { name: /Nhà tuyển dụng/ })).not.toBeChecked();
        expect(screen.getByLabelText('Họ', { exact: true })).toHaveAttribute('autocomplete', 'family-name');
        expect(screen.getByLabelText('Email', { exact: true })).toHaveAttribute('type', 'email');
        expect(screen.queryByLabelText('Mật khẩu', { exact: true })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Đăng nhập ngay' })).toHaveAttribute('href', '/login');
        expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();
    });

    it('validates only the current step and focuses the first invalid field', async () => {
        render(<Register />);
        await act(async () => {});
        nextStep();
        expect(screen.getAllByText('Không được để trống.')).toHaveLength(3);
        expect(screen.getByLabelText('Họ', { exact: true })).toHaveFocus();
        expect(createNewUser).not.toHaveBeenCalled();
        fillProfile({ email: 'not-an-email' });
        nextStep();
        expect(screen.getByText('Email chưa đúng định dạng.')).toBeInTheDocument();
        expect(screen.getByLabelText('Email', { exact: true })).toHaveAttribute('aria-invalid', 'true');
        change('Email', 'lan@gmail.com');
        nextStep();
        submit();
        expect(screen.getAllByText('Không được để trống.')).toHaveLength(3);
        expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveFocus();
        expect(createNewUser).not.toHaveBeenCalled();
    });

    it('preserves profile and credential values when returning and hides revealed passwords', async () => {
        render(<Register />);
        await act(async () => {});
        completeForm({ role: 'EMPLOYER' });
        expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveAttribute('type', 'tel');
        expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
        fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu', exact: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu nhập lại', exact: true }));
        expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveAttribute('type', 'text');
        fireEvent.click(screen.getByRole('button', { name: /Quay lại/ }));
        await act(async () => {});
        expect(screen.getByRole('radio', { name: /Nhà tuyển dụng/ })).toBeChecked();
        expect(screen.getByLabelText('Họ', { exact: true })).toHaveValue('  Nguyen  ');
        nextStep();
        expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveValue('0912345678');
        expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveValue('secret12');
        expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveAttribute('type', 'password');
        expect(screen.getByLabelText('Nhập lại mật khẩu', { exact: true })).toHaveAttribute('type', 'password');
        expect(createNewUser).not.toHaveBeenCalled();
    });

    it('rejects an invalid phone, the existing password policy, and confirmation mismatch', async () => {
        render(<Register />);
        await act(async () => {});
        completeForm({ phone: '123', password: 'bad!', confirmation: 'other' });
        submit();
        expect(screen.getByText('Số điện thoại cần đủ 10 chữ số.')).toBeInTheDocument();
        expect(screen.getByText('Mật khẩu cần ít nhất 8 ký tự.')).toBeInTheDocument();
        expect(screen.getByText('Mật khẩu nhập lại chưa trùng khớp.')).toBeInTheDocument();
        change('Mật khẩu', 'other123');
        change('Nhập lại mật khẩu', 'other123');
        expect(screen.queryByText('Mật khẩu nhập lại chưa trùng khớp.')).not.toBeInTheDocument();
        expect(createNewUser).not.toHaveBeenCalled();
    });

    it('prevents duplicate requests while registration is pending and allows retry after failure', async () => {
        let rejectRequest;
        createNewUser.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectRequest = reject; }));
        createNewUser.mockResolvedValueOnce({ errCode: 2, errMessage: 'Chưa thể tạo tài khoản lúc này.' });
        render(<Register />);
        await act(async () => {});
        completeForm();
        submit();
        submit();
        expect(createNewUser).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: /Đang tạo tài khoản/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Quay lại/ })).toBeDisabled();
        expect(screen.getByLabelText('Số điện thoại', { exact: true })).toBeDisabled();
        await act(async () => { rejectRequest(new Error('network unavailable')); });
        expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác nhận được kết quả tạo tài khoản');
        expect(screen.getByRole('button', { name: /Tạo tài khoản/ })).toBeEnabled();
        expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveValue('secret12');
        submit();
        await screen.findByText('Chưa thể tạo tài khoản lúc này.');
        expect(createNewUser).toHaveBeenCalledTimes(2);
        expect(handleLoginService).not.toHaveBeenCalled();
    });

    it('places a duplicate-phone error on its field without losing the entered profile', async () => {
        createNewUser.mockResolvedValue({ errCode: 1, errMessage: 'Số điện thoại đã tồn tại !' });
        render(<Register />);
        await act(async () => {});
        completeForm();
        submit();
        await waitFor(() => expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveAttribute('aria-invalid', 'true'));
        expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveAccessibleDescription('Số điện thoại đã tồn tại !');
        expect(screen.getByRole('button', { name: /Tạo tài khoản/ })).toBeEnabled();
        change('Số điện thoại', '0987654321');
        expect(screen.queryByText('Số điện thoại đã tồn tại !')).not.toBeInTheDocument();
        expect(handleLoginService).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /Quay lại/ }));
        await act(async () => {});
        expect(screen.getByLabelText('Tên', { exact: true })).toHaveValue('  Lan  ');
    });

    it('returns to the profile step when the backend rejects an email', async () => {
        createNewUser.mockResolvedValue({ errCode: 4, errMessage: 'Email không hợp lệ hoặc không thể nhận thư' });
        render(<Register />);
        await act(async () => {});
        completeForm();
        submit();
        const email = await screen.findByLabelText('Email', { exact: true });
        expect(email).toHaveAttribute('aria-invalid', 'true');
        expect(email).toHaveAccessibleDescription('Email không hợp lệ hoặc không thể nhận thư');
        expect(screen.getByLabelText('Tên', { exact: true })).toHaveValue('  Lan  ');
        change('Email', 'corrected@gmail.com');
        nextStep();
        expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveValue('0912345678');
        expect(handleLoginService).not.toHaveBeenCalled();
    });

    it.each(['CANDIDATE', 'EMPLOYER'])('creates a %s account with normalized profile and establishes its session', async roleCode => {
        const user = { id: 10, roleCode };
        createNewUser.mockResolvedValue({ errCode: 0 });
        handleLoginService.mockResolvedValue({ errCode: 0, user, token: 'new-token' });
        // jsdom cannot perform full-page navigation; live browser tests cover the landing page.
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            render(<Register />);
        await act(async () => {});
            completeForm({ role: roleCode });
            submit();
            await waitFor(() => expect(localStorage.getItem('token_user')).toMatch(/^jf-session:/));
            expect(createNewUser).toHaveBeenCalledTimes(1);
            expect(createNewUser).toHaveBeenCalledWith({
                firstName: 'Nguyen', lastName: 'Lan', email: 'lan@gmail.com',
                phonenumber: '0912345678', roleCode, password: 'secret12',
            });
            expect(handleLoginService).toHaveBeenCalledWith({ identifier: '0912345678', password: 'secret12', rememberMe: false });
            expect(toast.success).toHaveBeenCalledWith('Tạo tài khoản thành công');
            expect(JSON.parse(localStorage.getItem('userData'))).toEqual(user);
            expect(getAccessTokenSync()).toBe('new-token');
            expect(localStorage.getItem('token_user')).not.toBe('new-token');
        } finally { consoleError.mockRestore(); }
    });

    it.each(['rejected', 'unavailable'])('keeps a created account successful when automatic login is %s', async failure => {
        createNewUser.mockResolvedValue({ errCode: 0 });
        if (failure === 'rejected') handleLoginService.mockResolvedValue({ errCode: 1, errMessage: 'Login failed' });
        else handleLoginService.mockRejectedValue(new Error('network unavailable'));
        render(<Register />);
        await act(async () => {});
        completeForm();
        const form = screen.getByRole('form', { name: 'Đăng ký JobFind' });
        submit();
        await screen.findByRole('link', { name: /Đến trang đăng nhập/ });
        expect(screen.getByRole('heading', { name: 'Tài khoản đã sẵn sàng' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Tài khoản đã được tạo. Chưa đăng nhập tự động được');
        expect(screen.getByRole('link', { name: /Đến trang đăng nhập/ })).toHaveAttribute('href', '/login');
        expect(screen.queryByRole('form')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Mật khẩu', { exact: true })).not.toBeInTheDocument();
        fireEvent.submit(form);
        expect(createNewUser).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('token_user')).toBeNull();
    });

    it('does not sign in after leaving the page while account creation is pending', async () => {
        let finish;
        createNewUser.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const { unmount } = render(<Register />);
        await act(async () => {});
        completeForm();
        submit();
        unmount();
        await act(async () => { finish({ errCode: 0 }); });
        expect(handleLoginService).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(localStorage.getItem('token_user')).toBeNull();
    });

    it('starts registration only with a configured social provider', async () => {
        getProviders.mockResolvedValueOnce({ google: false, github: true, auth0: false });
        render(<Register />);
        await act(async () => {});
        fireEvent.click(await screen.findByRole('button', { name: 'Đăng ký bằng GitHub' }));
        expect(startSocialLogin).toHaveBeenCalledWith('github', { rememberMe: false });
        expect(screen.queryByRole('button', { name: 'Đăng ký bằng Auth0' })).toBeNull();
    });

    it('completes pending social signup with locked email, a public role and one server session', async () => {
        window.history.replaceState({}, '', '/register?sso=complete');
        getSocialSignup.mockResolvedValue({ errCode: 0, profile: { provider: 'github', email: 'lan@gmail.com', firstName: 'Nguyen', lastName: 'Lan' } });
        completeSocialSignup.mockResolvedValue({ errCode: 0, token: 'social-token', user: { id: 30, roleCode: 'CANDIDATE' } });
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            render(<Register />);
        await act(async () => {});
            const email = await screen.findByLabelText('Email', { exact: true });
            expect(email).toHaveAttribute('readonly');
            fireEvent.change(email, { target: { value: 'attacker@gmail.com' } });
            expect(email).toHaveValue('lan@gmail.com');
            nextStep(); fillAccount({ password: 'Mật khẩu 😀!' }); submit();
            await waitFor(() => expect(getAccessTokenSync()).toBe('social-token'));
            expect(completeSocialSignup).toHaveBeenCalledWith({ firstName: 'Nguyen', lastName: 'Lan', phonenumber: '0912345678', password: 'Mật khẩu 😀!', roleCode: 'CANDIDATE' });
            expect(createNewUser).not.toHaveBeenCalled();
            expect(handleLoginService).not.toHaveBeenCalled();
        } finally { consoleError.mockRestore(); }
    });

    it('keeps social validation errors editable and does not retry an account already created', async () => {
        window.history.replaceState({}, '', '/register?sso=complete');
        getSocialSignup.mockResolvedValue({ errCode: 0, profile: { provider: 'google', email: 'lan@gmail.com', firstName: 'Nguyen', lastName: 'Lan' } });
        completeSocialSignup.mockRejectedValueOnce({ response: { data: { errCode: 409, fieldErrors: { phonenumber: 'Số điện thoại đã tồn tại.' }, errMessage: 'Kiểm tra số điện thoại.' } } });
        completeSocialSignup.mockRejectedValueOnce({ response: { data: { errCode: 503, accountCreated: true } } });
        render(<Register />);
        await act(async () => {});
        await screen.findByLabelText('Email', { exact: true });
        nextStep(); fillAccount(); submit();
        await waitFor(() => expect(screen.getByLabelText('Số điện thoại', { exact: true })).toHaveAttribute('aria-invalid', 'true'));
        change('Số điện thoại', '0987654321'); submit();
        await screen.findByRole('link', { name: /Đến trang đăng nhập/ });
        expect(screen.queryByRole('form')).toBeNull();
        expect(completeSocialSignup).toHaveBeenCalledTimes(2);
        expect(screen.queryByLabelText('Mật khẩu', { exact: true })).toBeNull();
    });

    it('does not turn an expired social signup into an ordinary account creation', async () => {
        window.history.replaceState({}, '', '/register?sso=complete');
        getSocialSignup.mockRejectedValue(new Error('expired'));
        render(<Register />);
        await act(async () => {});
        expect(await screen.findByRole('alert')).toHaveTextContent('Phiên có thể đã hết hạn');
        expect(screen.queryByRole('form')).toBeNull();
        expect(createNewUser).not.toHaveBeenCalled();
        expect(screen.getByRole('link', { name: 'Bắt đầu đăng ký mới' })).toHaveAttribute('href', '/register');
    });
});

describe('Registration while preparing an application', () => {
    const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
    beforeEach(() => {
        localStorage.clear(); sessionStorage.clear(); jest.resetAllMocks();
        getProviders.mockResolvedValue({ google: false, github: false, auth0: false });
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { origin: 'http://localhost', search: '', href: '/register' },
        });
        rememberApplicationIntent({ jobId: 7, jobTitle: 'Kỹ sư phần mềm' });
        localStorage.setItem('lastUrl', '/account/security');
    });
    afterEach(async () => {
        await act(async () => {});
        Object.defineProperty(window, 'location', originalLocation);
        sessionStorage.clear();
    });

    it.each(['CANDIDATE', 'EMPLOYER'])('returns a newly registered %s to the intended job', async roleCode => {
        createNewUser.mockResolvedValueOnce({ errCode: 0 });
        handleLoginService.mockResolvedValueOnce({ errCode: 0, token: 'new-application-token', user: { id: 42, roleCode } });
        render(<Register />);
        await act(async () => {});
        expect(screen.getByRole('status')).toHaveTextContent('Tạo tài khoản ứng viên để tiếp tục ứng tuyển Kỹ sư phần mềm');
        expect(screen.getByRole('radio', { name: /Ứng viên/ })).toBeChecked();
        completeForm({ role: roleCode }); submit();
        await waitFor(() => expect(window.location.href).toBe('/detail-job/7'));
        expect(readApplicationIntent()).toMatchObject({ jobId: '7' });
        expect(localStorage.getItem('lastUrl')).toBeNull();
    });

    it('returns completed social registration to the intended job', async () => {
        window.location.search = '?sso=complete';
        getSocialSignup.mockResolvedValueOnce({ errCode: 0, profile: { provider: 'github', email: 'lan@gmail.com', firstName: 'Nguyen', lastName: 'Lan' } });
        completeSocialSignup.mockResolvedValueOnce({ errCode: 0, token: 'new-social-application-token', user: { id: 42, roleCode: 'CANDIDATE' } });
        render(<Register />);
        await screen.findByLabelText('Email', { exact: true });
        nextStep(); fillAccount(); submit();
        await waitFor(() => expect(window.location.href).toBe('/detail-job/7'));
        expect(readApplicationIntent()).toMatchObject({ jobId: '7' });
        expect(createNewUser).not.toHaveBeenCalled();
    });

    it('retains the application when automatic login needs to be retried from the login page', async () => {
        createNewUser.mockResolvedValueOnce({ errCode: 0 });
        handleLoginService.mockRejectedValueOnce(new Error('offline'));
        render(<Register />);
        await act(async () => {});
        completeForm(); submit();
        expect(await screen.findByRole('link', { name: /Đến trang đăng nhập/ })).toHaveAttribute('href', '/login');
        expect(readApplicationIntent()).toMatchObject({ jobId: '7' });
    });

    it('clears application context when returning to the public job instead of registering', async () => {
        render(<Register />);
        await act(async () => {});
        const link = screen.getByRole('link', { name: 'Quay lại xem công việc' });
        expect(link).toHaveAttribute('href', '/detail-job/7');
        link.addEventListener('click', event => event.preventDefault());
        fireEvent.click(link);
        expect(readApplicationIntent()).toBeNull();
        expect(localStorage.getItem('lastUrl')).toBeNull();
        expect(screen.queryByText('Kỹ sư phần mềm')).not.toBeInTheDocument();
    });
});
