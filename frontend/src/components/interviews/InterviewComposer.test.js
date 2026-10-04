import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import InterviewComposer from './InterviewComposer';
import { getApplications, getApplicationDetail, sendInterviewInvitation } from '../../service/applicationService';
import { getDetailCompanyById } from '../../service/userService';

jest.mock('../../service/applicationService', () => ({ getApplications: jest.fn(), getApplicationDetail: jest.fn(), sendInterviewInvitation: jest.fn() }));
jest.mock('../../service/userService', () => ({ getDetailCompanyById: jest.fn() }));

const user = { id: 2, companyId: 3, companyName: 'Công ty dự phòng', firstName: 'Nguyễn', lastName: 'Hà', email: 'hr@example.com' };
const invitation = { companyName: 'Công ty mới', interviewDate: '2099-10-15', interviewTime: '09:30', durationMinutes: '60',
    timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'online', meetingUrl: 'https://meet.example.com/new', contactName: 'Nguyễn Hà', contactEmail: 'hr@example.com', round: 'Vòng mới nhất' };
const detail = { id: 11, company_id: 3, candidate_name: 'Nguyễn Lan', candidate_email: 'lan@example.com', job_title: 'Frontend', stage: 'phong_van',
    timeline: [{ decision_snapshot: { decision: 'interview', interview: invitation } }] };
const event = { applicationId: 11, message: 'Vui lòng đến sớm', interview: { ...invitation, round: 'Vòng cũ trong lịch' } };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const finish = async (pending, response) => { await act(async () => { pending.resolve(response); }); };
const setup = (changes = {}) => {
    const props = { user, event, sessionActive: jest.fn(() => true), onClose: jest.fn(), onSent: jest.fn(), ...changes };
    const rendered = render(<InterviewComposer {...props} />);
    return { ...rendered, props };
};
const preview = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    return screen.getByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn' });
};

beforeEach(() => {
    getApplications.mockReset(); getApplicationDetail.mockReset(); getDetailCompanyById.mockReset(); sendInterviewInvitation.mockReset();
    getApplicationDetail.mockResolvedValue({ errCode: 0, data: detail });
    getDetailCompanyById.mockResolvedValue({ errCode: 0, data: { name: 'Công ty từ API', address: '12 Nguyễn Huệ' } });
    getApplications.mockResolvedValue({ errCode: 0, data: [], count: 0 });
});

test('rescheduling fetches the current application and prefills the latest invitation instead of the old calendar copy', async () => {
    setup();
    expect(await screen.findByLabelText('Vòng phỏng vấn')).toHaveValue('Vòng mới nhất');
    expect(screen.getByLabelText('Lời nhắn thêm cho ứng viên')).toHaveValue('Vui lòng đến sớm');
    expect(screen.getByLabelText('Link phòng họp trực tuyến (Google Meet, Zoom, Teams…) *')).toHaveValue(invitation.meetingUrl);
    expect(getApplicationDetail).toHaveBeenCalledWith(11);
    expect(getDetailCompanyById).toHaveBeenCalledWith(3);
    expect(sendInterviewInvitation).not.toHaveBeenCalled();
});

test('StrictMode application loading finishes on the latest request', async () => {
    const old = deferred(); const current = deferred();
    getApplicationDetail.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<StrictMode><InterviewComposer user={user} event={event} sessionActive={() => true} onClose={jest.fn()} onSent={jest.fn()} /></StrictMode>);
    await finish(current, { errCode: 0, data: detail });
    expect(await screen.findByLabelText('Vòng phỏng vấn')).toHaveValue('Vòng mới nhất');
    await finish(old, { errCode: 0, data: { ...detail, candidate_name: 'Hồ sơ cũ' } });
    expect(screen.queryByText('Hồ sơ cũ')).not.toBeInTheDocument();
});

test('choosing an application loads fresh detail and first-time invitations prefill company and HR', async () => {
    getApplications.mockResolvedValue({ errCode: 0, data: [detail, { ...detail, id: 12, candidate_name: 'Đã nhận việc', stage: 'nhan_viec' }], count: 2 });
    getApplicationDetail.mockResolvedValue({ errCode: 0, data: { ...detail, timeline: [] } });
    setup({ event: null });
    expect(await screen.findByRole('button', { name: /Đã nhận việc/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Nguyễn Lan.*Chọn hồ sơ/ }));
    expect(await screen.findByLabelText('Tên công ty *')).toHaveValue('Công ty từ API');
    expect(screen.getByLabelText('Địa điểm phỏng vấn cụ thể *')).toHaveValue('12 Nguyễn Huệ');
    expect(screen.getByLabelText('Người liên hệ HR *')).toHaveValue('Nguyễn Hà');
    expect(screen.getByLabelText('Email HR nhận phản hồi *')).toHaveValue('hr@example.com');
});

test('preview requires confirmation, locks duplicate sends and closes only after a successful response', async () => {
    const pending = deferred(); sendInterviewInvitation.mockReturnValue(pending.promise);
    const { props } = setup();
    const send = await preview();
    expect(screen.getByText('Xem trước thư mời phỏng vấn')).toBeInTheDocument();
    expect(sendInterviewInvitation).not.toHaveBeenCalled();
    fireEvent.click(send); fireEvent.click(send);
    expect(sendInterviewInvitation).toHaveBeenCalledTimes(1);
    expect(sendInterviewInvitation).toHaveBeenCalledWith(11, 'Vui lòng đến sớm', invitation);
    expect(screen.getByRole('button', { name: 'Đang gửi…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đóng hộp thoại' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).not.toHaveBeenCalled();
    await finish(pending, { errCode: 0 });
    expect(props.onSent).toHaveBeenCalledWith(invitation);
});

test('send errors preserve the preview and allow a retry without losing the edited schedule', async () => {
    sendInterviewInvitation.mockResolvedValueOnce({ errCode: 409, errMessage: 'Lịch đã thay đổi, vui lòng thử lại' }).mockResolvedValueOnce({ errCode: 0 });
    const { props } = setup();
    await screen.findByLabelText('Ngày phỏng vấn *');
    fireEvent.change(screen.getByLabelText('Giờ bắt đầu *'), { target: { value: '10:15' } });
    fireEvent.click(await preview());
    expect(await screen.findByRole('alert')).toHaveTextContent('Lịch đã thay đổi');
    expect(props.onSent).not.toHaveBeenCalled();
    expect(screen.getByText(/15\/10\/2099 lúc 10:15/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn' }));
    await waitFor(() => expect(props.onSent).toHaveBeenCalledWith({ ...invitation, interviewTime: '10:15' }));
});

test('rejects an application newly marked hired and retries a temporary detail error', async () => {
    getApplicationDetail.mockResolvedValueOnce({ errCode: 0, data: { ...detail, stage: 'nhan_viec' } }).mockResolvedValueOnce({ errCode: 0, data: detail });
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ứng viên đã nhận việc');
    expect(screen.queryByRole('button', { name: 'Xem trước thư mời phỏng vấn' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByLabelText('Ngày phỏng vấn *');
    expect(getApplicationDetail).toHaveBeenCalledTimes(2);
});

test('search trims its query and pagination keeps that search while selecting another server page', async () => {
    const old = deferred(); const current = deferred();
    getApplications.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockResolvedValueOnce({ errCode: 0, data: [{ ...detail, candidate_name: 'Trang 2' }], count: 30 });
    setup({ event: null });
    // Wait for the initial picker before searching another page.
    await finish(old, { errCode: 0, data: [detail], count: 30 });
    fireEvent.change(screen.getByLabelText('Tìm ứng viên theo tên hoặc email'), { target: { value: ' lan@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tìm kiếm' }));
    expect(getApplications).toHaveBeenLastCalledWith({ q: 'lan@example.com', limit: 20, offset: 0 });
    await finish(current, { errCode: 0, data: [detail], count: 30 });
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(await screen.findByRole('button', { name: /Trang 2/ })).toBeInTheDocument();
    expect(getApplications).toHaveBeenLastCalledWith({ q: 'lan@example.com', limit: 20, offset: 20 });
});

test('a send response after session expiry cannot update the calendar', async () => {
    const pending = deferred(); sendInterviewInvitation.mockReturnValue(pending.promise);
    const sessionActive = jest.fn(() => true); const { props } = setup({ sessionActive });
    fireEvent.click(await preview());
    sessionActive.mockReturnValue(false);
    await finish(pending, { errCode: 0 });
    expect(props.onSent).not.toHaveBeenCalled();
});
