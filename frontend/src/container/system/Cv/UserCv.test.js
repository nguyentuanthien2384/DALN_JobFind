import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import UserCv from './UserCv';
import { getDetailCvService } from '../../../service/cvService';
import { SESSION_ENDED_EVENT } from '../../../auth/sessionExpiry';

let mockId = '31';
jest.mock('react-router-dom', () => ({ useParams: () => ({ id: mockId }), useNavigate: () => jest.fn() }));
jest.mock('../../../service/cvService', () => ({ getDetailCvService: jest.fn() }));
const valid = { errCode: 0, data: { description: 'Reviewed submission', file: '/files/reviewed.pdf', userCvData: { firstName: 'An' } } };
beforeEach(() => {
    jest.clearAllMocks(); mockId = '31'; localStorage.clear();
    localStorage.setItem('userData', JSON.stringify({ id: 8, roleCode: 'CANDIDATE' }));
    localStorage.setItem('token_user', 'session');
});

it('keeps historical submissions readable when the candidate or file is missing', async () => {
    getDetailCvService.mockResolvedValue({ errCode: 0, data: { description: 'Historical', userCvData: null, file: null } });
    const view = render(<UserCv />);
    expect(await screen.findByText('Historical')).toBeInTheDocument();
    expect(screen.getByText('Thông tin ứng viên không còn khả dụng')).toBeInTheDocument();
    expect(screen.getByText('Hồ sơ này không còn tệp PDF hợp lệ để xem.')).toBeInTheDocument();
    expect(view.container.querySelector('iframe')).toBeNull();
});

it('shows a permission error with no old PDF and supports an explicit read retry', async () => {
    getDetailCvService.mockResolvedValueOnce({ errCode: 3, httpStatus: 403, errMessage: 'Không có quyền xem hồ sơ' }).mockResolvedValue(valid);
    const view = render(<UserCv />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền');
    expect(view.container.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại hồ sơ' }));
    expect(await screen.findByRole('link', { name: 'Mở PDF đã nộp' })).toHaveAttribute('href', '/files/reviewed.pdf');
    expect(getDetailCvService).toHaveBeenCalledTimes(2);
});

it('ignores a late response from another CV route', async () => {
    let release;
    getDetailCvService.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue(valid);
    const view = render(<UserCv />);
    mockId = '32'; view.rerender(<UserCv />);
    await screen.findByText('Reviewed submission');
    await act(async () => release({ errCode: 0, data: { description: 'Obsolete private CV', file: '/old.pdf' } }));
    expect(screen.queryByText('Obsolete private CV')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tải CV đã nộp' })).toHaveAttribute('download', 'CV-32.pdf');
});

it('creates an openable PDF URL and releases it when the session ends', async () => {
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:submitted'); URL.revokeObjectURL = jest.fn();
    try {
        getDetailCvService.mockResolvedValue({ ...valid, data: { ...valid.data, file: 'data:application/pdf;base64,JVBERi0xLjQ=' } });
        const view = render(<UserCv />);
        expect(await screen.findByRole('link', { name: 'Mở PDF đã nộp' })).toHaveAttribute('href', 'blob:submitted');
        expect(URL.createObjectURL.mock.calls[0][0].type).toBe('application/pdf');
        fireEvent(window, new Event(SESSION_ENDED_EVENT));
        expect(await screen.findByRole('alert')).toHaveTextContent('Phiên đăng nhập đã kết thúc');
        expect(view.container.querySelector('iframe')).toBeNull();
        await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:submitted'));
        view.unmount();
    } finally { URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

it('does not render a malformed historical data attachment as a frame or link', async () => {
    getDetailCvService.mockResolvedValue({ ...valid, data: { ...valid.data, file: 'data:text/html,<script>bad</script>' } });
    const view = render(<UserCv />);
    await screen.findByText('Reviewed submission');
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
