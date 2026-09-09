import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SendCvModal from './SendCvModal';
import { listMyCvs } from '../../service/aiSearchService';
import { createNewCv } from '../../service/cvService';
import { getDetailUserById } from '../../service/userService';
import { renderPreparedCv } from '../../service/preparedCvPdf';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { emptyCv } from '../../service/candidateWorkspace';
import { toast } from 'react-toastify';

jest.mock('reactstrap', () => {
    const React = require('react');
    const Box = ({ children, isOpen = true }) => isOpen ? <div>{children}</div> : null;
    return { Modal: Box, ModalFooter: Box, ModalBody: Box, Button: ({ children, ...props }) => <button {...props}>{children}</button> };
});
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('../../service/aiSearchService', () => ({ listMyCvs: jest.fn() }));
jest.mock('../../service/cvService', () => ({ createNewCv: jest.fn() }));
jest.mock('../../service/userService', () => ({ getDetailUserById: jest.fn() }));
jest.mock('../../service/preparedCvPdf', () => ({ renderPreparedCv: jest.fn() }));
const first = { ...emptyCv(), _id: '507f1f77bcf86cd799439011', title: 'CV kỹ sư', fullName: 'Nguyễn Thị Ánh' };
const second = { ...first, _id: '507f1f77bcf86cd799439012', title: 'CV quản lý' };
const pdf = 'data:application/pdf;base64,JVBERi0xLjcKZml4dHVyZQ==';
const result = () => ({ file: pdf, blob: new Blob(['%PDF-1.7']), pages: 2 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const send = () => screen.getByRole('button', { name: 'Gửi hồ sơ' });
const choose = async () => {
    fireEvent.click(screen.getByLabelText('CV đã chuẩn bị'));
    await screen.findByRole('option', { name: first.title });
    fireEvent.change(screen.getByLabelText('CV đã lưu'), { target: { value: first._id } });
    fireEvent.change(screen.getByLabelText('Lời giới thiệu'), { target: { value: 'Tôi muốn ứng tuyển vị trí này.' } });
};
const prepare = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bản PDF để xem lại' }));
    await screen.findByRole('link', { name: 'Mở bản PDF sẽ gửi' });
};
const review = () => fireEvent.click(screen.getByLabelText('Tôi đã xem và chọn bản PDF này để ứng tuyển'));
beforeEach(() => {
    jest.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('token_user', 'current-token'); localStorage.setItem('userData', JSON.stringify({ id: 8, roleCode: 'CANDIDATE' }));
    process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED = 'true';
    getDetailUserById.mockResolvedValue({ errCode: 0, data: {} });
    listMyCvs.mockResolvedValue({ errCode: 0, data: [first, second] });
    renderPreparedCv.mockResolvedValue(result()); createNewCv.mockResolvedValue({ errCode: 0, cvId: 22 });
    URL.createObjectURL = jest.fn(() => 'blob:prepared'); URL.revokeObjectURL = jest.fn();
});
afterEach(() => { delete process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED; });

test('requires explicit source, selection, PDF review and send; submits the frozen bytes only', async () => {
    const onHide = jest.fn(); render(<SendCvModal isOpen postId={7} jobTitle="Kỹ sư phần mềm" onHide={onHide} />);
    expect(listMyCvs).not.toHaveBeenCalled(); await choose();
    expect(renderPreparedCv).not.toHaveBeenCalled(); expect(send()).toBeDisabled();
    await prepare(); expect(send()).toBeDisabled(); expect(createNewCv).not.toHaveBeenCalled(); review();
    listMyCvs.mockResolvedValue({ errCode: 0, data: [{ ...first, fullName: 'Changed on server' }] });
    fireEvent.click(send()); await waitFor(() => expect(onHide).toHaveBeenCalledTimes(1));
    expect(createNewCv).toHaveBeenCalledWith({ userId: 8, postId: 7, file: pdf, description: 'Tôi muốn ứng tuyển vị trí này.' });
    expect(listMyCvs).toHaveBeenCalledTimes(1); expect(renderPreparedCv).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0); expect(localStorage.length).toBe(2);
});
test('changing selection or refreshing revokes the preview and invalidates approval', async () => {
    render(<SendCvModal isOpen postId={7} onHide={jest.fn()} />); await choose(); await prepare(); review();
    fireEvent.change(screen.getByLabelText('CV đã lưu'), { target: { value: second._id } });
    expect(send()).toBeDisabled(); expect(screen.queryByRole('link', { name: 'Mở bản PDF sẽ gửi' })).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prepared');
    await prepare(); review(); fireEvent.click(screen.getByRole('button', { name: 'Tải lại CV đã chuẩn bị' }));
    await waitFor(() => expect(listMyCvs).toHaveBeenCalledTimes(2)); expect(send()).toBeDisabled();
    expect(screen.getByLabelText('CV đã lưu')).toHaveValue(''); expect(createNewCv).not.toHaveBeenCalled();
});
test('a source change discards a PDF that completes late', async () => {
    const pending = deferred(); renderPreparedCv.mockReturnValue(pending.promise);
    render(<SendCvModal isOpen postId={7} onHide={jest.fn()} />); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bản PDF để xem lại' }));
    await waitFor(() => expect(renderPreparedCv).toHaveBeenCalled()); fireEvent.click(screen.getByLabelText('Tự chọn CV'));
    await act(async () => pending.resolve(result())); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(createNewCv).not.toHaveBeenCalled();
});
test.each(['close', 'job', 'session'])('discarding the %s clears the prepared CV and ignores a late result', async kind => {
    const pending = deferred(); renderPreparedCv.mockReturnValue(pending.promise);
    const view = render(<SendCvModal isOpen postId={7} onHide={jest.fn()} />); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bản PDF để xem lại' })); await waitFor(() => expect(renderPreparedCv).toHaveBeenCalled());
    if (kind === 'session') act(() => { localStorage.setItem('token_user', 'another-token'); window.dispatchEvent(new Event(SESSION_ENDED_EVENT)); });
    else view.rerender(<SendCvModal isOpen={kind !== 'close'} postId={8} onHide={jest.fn()} />);
    await act(async () => pending.resolve(result()));
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(createNewCv).not.toHaveBeenCalled();
});
test('lost response and duplicate replies keep the reviewed bytes and never resend automatically', async () => {
    const pending = deferred(); createNewCv.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ errCode: 5, httpStatus: 409 });
    const onHide = jest.fn(); render(<SendCvModal isOpen postId={7} onHide={onHide} />); await choose(); await prepare(); review();
    fireEvent.click(send()); fireEvent.click(send()); expect(createNewCv).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ errCode: -1, httpStatus: 503 }));
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa xác nhận');
    expect(screen.getByRole('link', { name: 'Xem Công việc đã nộp' })).toHaveAttribute('href', '/candidate/cv-post');
    expect(onHide).not.toHaveBeenCalled(); fireEvent.click(send()); await screen.findByText(/Bạn đã ứng tuyển tin này/);
    expect(createNewCv).toHaveBeenCalledTimes(2); expect(createNewCv.mock.calls[0]).toEqual(createNewCv.mock.calls[1]);
});
test('CV service errors, empty lists and invalid responses never fall back or submit', async () => {
    listMyCvs.mockResolvedValueOnce({ errCode: 503 }).mockResolvedValueOnce({ errCode: 0, data: [] }).mockResolvedValueOnce({ errCode: 0, data: [{ ...first, _id: 'invalid' }] });
    render(<SendCvModal isOpen postId={7} onHide={jest.fn()} />); fireEvent.click(screen.getByLabelText('CV đã chuẩn bị'));
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Tải lại CV đã chuẩn bị' }));
    await screen.findByText(/Bạn chưa có CV đã lưu/); fireEvent.click(screen.getByRole('button', { name: 'Tải lại CV đã chuẩn bị' }));
    await screen.findByRole('alert'); expect(send()).toBeDisabled(); expect(createNewCv).not.toHaveBeenCalled();
});
test('PDF failure can be retried explicitly without accepting a partial file', async () => {
    renderPreparedCv.mockRejectedValueOnce(new Error('Phông chữ chưa tải được'));
    render(<SendCvModal isOpen postId={7} onHide={jest.fn()} />); await choose();
    fireEvent.click(screen.getByRole('button', { name: 'Tạo bản PDF để xem lại' })); await screen.findByText('Phông chữ chưa tải được');
    expect(send()).toBeDisabled(); await prepare(); expect(send()).toBeDisabled(); expect(createNewCv).not.toHaveBeenCalled();
});
test('flag off and non-candidate sessions cannot load or select prepared CVs', () => {
    process.env.REACT_APP_PREPARED_CV_APPLICATION_ENABLED = 'false';
    const view = render(<SendCvModal isOpen postId={7} onHide={jest.fn()} />);
    expect(screen.queryByLabelText('CV đã chuẩn bị')).not.toBeInTheDocument(); expect(listMyCvs).not.toHaveBeenCalled();
    localStorage.setItem('userData', JSON.stringify({ id: 9, roleCode: 'ADMIN' }));
    view.rerender(<SendCvModal isOpen postId={7} onHide={jest.fn()} />); expect(screen.queryByRole('button', { name: 'Gửi hồ sơ' })).not.toBeInTheDocument();
});
test('changing identity while sending cannot close another user’s view or report success', async () => {
    const pending = deferred(); createNewCv.mockReturnValueOnce(pending.promise);
    const onHide = jest.fn(); render(<SendCvModal isOpen postId={7} onHide={onHide} />); await choose(); await prepare(); review(); fireEvent.click(send());
    localStorage.setItem('userData', JSON.stringify({ id: 9, roleCode: 'CANDIDATE' }));
    await act(async () => pending.resolve({ errCode: 0, cvId: 2 }));
    expect(onHide).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
});
