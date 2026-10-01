import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import InterviewInvitationForm, { validateInterviewForm, formatInterviewTime } from './InterviewInvitationForm';

const interview = { companyName: 'Job Example', interviewDate: '2099-10-15', interviewTime: '09:30', durationMinutes: '60',
    timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'onsite', location: '12 Nguyễn Huệ', contactName: 'Hà', contactEmail: 'hr@example.com' };
const detail = { id: 1, candidate_name: 'Lan', candidate_email: 'lan@example.com', job_title: 'Developer' };
const setup = (props = {}) => {
    const onSend = jest.fn();
    render(<InterviewInvitationForm detail={detail} user={{ firstName: 'Nguyễn', lastName: 'Hà', email: 'hr@example.com' }}
        message="Hẹn gặp Lan" onSend={onSend} onCancel={jest.fn()} {...props} />);
    return onSend;
};
const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

it('prefills the company and HR contact, then requires a date before previewing or sending', () => {
    const onSend = setup({ company: { name: 'Sao Khuê Digital', address: 'Tầng 5, 12 Nguyễn Huệ' } });
    expect(screen.getByLabelText('Tên công ty *')).toHaveValue('Sao Khuê Digital');
    expect(screen.getByLabelText('Địa điểm phỏng vấn cụ thể *')).toHaveValue('Tầng 5, 12 Nguyễn Huệ');
    expect(screen.getByLabelText('Người liên hệ HR *')).toHaveValue('Nguyễn Hà');
    expect(screen.getByLabelText('Email HR nhận phản hồi *')).toHaveValue('hr@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ngày phỏng vấn');
    expect(screen.queryByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn' })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
});

it('previews an online interview and sends only the chosen mode logistics after confirmation', () => {
    const onSend = setup({ company: { name: 'Job Example', address: 'Văn phòng cũ' } });
    fireEvent.change(screen.getByLabelText('Hình thức phỏng vấn *'), { target: { value: 'online' } });
    expect(screen.queryByLabelText(/Địa điểm phỏng vấn/)).not.toBeInTheDocument();
    fill('Ngày phỏng vấn *', '2099-10-15');
    fill('Giờ bắt đầu *', '09:30');
    fill('Link phòng họp trực tuyến (Google Meet, Zoom, Teams…) *', ' https://meet.example.com/abc ');
    fill('Hạn xác nhận tham gia', '2099-10-13T17:00');
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    expect(screen.getByText('Thứ Năm, 15/10/2099 lúc 09:30 (giờ Việt Nam, UTC+7)')).toBeInTheDocument();
    expect(screen.getByText('https://meet.example.com/abc')).toBeInTheDocument();
    expect(screen.getByText('Hẹn gặp Lan')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn' }));
    expect(onSend).toHaveBeenCalledWith({ companyName: 'Job Example', interviewDate: '2099-10-15', interviewTime: '09:30', durationMinutes: '60',
        timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'online', meetingUrl: 'https://meet.example.com/abc', contactName: 'Nguyễn Hà',
        contactEmail: 'hr@example.com', confirmBy: '2099-10-13T17:00' });
});

it('restores the latest invitation for rescheduling and keeps fields after editing the preview', () => {
    setup({ detail: { ...detail, timeline: [{ decision_snapshot: { decision: 'interview', interview: { ...interview, round: 'Vòng 2' } } }] } });
    expect(screen.getByLabelText('Vòng phỏng vấn')).toHaveValue('Vòng 2');
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa thư' }));
    expect(screen.getByLabelText('Địa điểm phỏng vấn cụ thể *')).toHaveValue(interview.location);
});

it.each([
    { interviewDate: '2099-02-30' }, { interviewTime: '24:30' }, { interviewDate: '2020-01-01' }, { interviewMode: 'video' },
    { location: ' ' }, { interviewMode: 'online', meetingUrl: '' }, { interviewMode: 'online', meetingUrl: 'javascript:alert(1)' },
    { interviewMode: 'online', meetingUrl: 'https://a:b@host.com' }, { interviewMode: 'phone', contactPhone: '' },
    { confirmBy: '2099-10-16T09:00' }, { confirmBy: '2020-01-01T09:00' }, { contactEmail: 'a@x.com\r\nBcc: bad@x.com' },
    { contactName: ' ' }
])('rejects invalid dates, missing logistics and unsafe input %#', (changes) => {
    expect(validateInterviewForm({ ...interview, ...changes })).toBeTruthy();
});

it('accepts phone interviews and compares times in Vietnam time', () => {
    expect(validateInterviewForm({ ...interview, location: '', interviewMode: 'phone', contactPhone: '0901234567' })).toBe('');
    const input = { ...interview, interviewDate: '2026-10-01', interviewTime: '08:00', confirmBy: '2026-10-01T07:30' };
    expect(validateInterviewForm(input, Date.parse('2026-10-01T00:00:00Z'))).toBe('');
    expect(validateInterviewForm(input, Date.parse('2026-10-01T00:30:00Z'))).toBeTruthy();
    expect(formatInterviewTime(input)).toBe('Thứ Năm, 01/10/2026 lúc 08:00');
    expect(formatInterviewTime({ interviewDate: 'bad', interviewTime: '08:00' })).toBe('');
});

it('marks the phone number as required only for phone interviews and sends it without a location', () => {
    const onSend = setup({ company: { name: 'Job Example', address: '12 Nguyễn Huệ' } });
    expect(screen.getByLabelText('Số điện thoại HR')).not.toBeRequired();
    fireEvent.change(screen.getByLabelText('Hình thức phỏng vấn *'), { target: { value: 'phone' } });
    expect(screen.getByLabelText('Số điện thoại HR *')).toBeRequired();
    expect(screen.queryByLabelText(/Địa điểm phỏng vấn/)).not.toBeInTheDocument();
    fill('Ngày phỏng vấn *', '2099-10-15');
    fill('Giờ bắt đầu *', '09:30');
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    expect(screen.getByRole('alert')).toHaveTextContent('số điện thoại');
    fill('Số điện thoại HR *', ' 0901234567 ');
    fireEvent.change(screen.getByLabelText('Thời lượng dự kiến'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('30 phút')).toBeInTheDocument();
    expect(screen.getByText('Qua điện thoại')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gửi thư mời phỏng vấn' }));
    expect(onSend.mock.calls[0][0]).toEqual({ companyName: 'Job Example', interviewDate: '2099-10-15', interviewTime: '09:30', durationMinutes: '30',
        timeZone: 'Asia/Ho_Chi_Minh', interviewMode: 'phone', contactName: 'Nguyễn Hà', contactEmail: 'hr@example.com', contactPhone: '0901234567' });
});

it('clears an error as soon as the recruiter edits the form', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fill('Ngày phỏng vấn *', '2099-10-15');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('locks every input and action while the invitation is being sent', () => {
    const onCancel = jest.fn();
    setup({ busy: true, onCancel });
    expect(screen.getByLabelText('Tên công ty *')).toBeDisabled();
    expect(screen.getByLabelText('Hình thức phỏng vấn *')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xem trước thư mời phỏng vấn' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đóng phần soạn thư' })).toBeDisabled();
});

it('closes the composer without sending', () => {
    const onCancel = jest.fn();
    const onSend = setup({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng phần soạn thư' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
});

it('falls back to the account company and an empty contact when profile data is missing', () => {
    render(<InterviewInvitationForm detail={{ ...detail, timeline: null }} user={{ companyName: 'Tài khoản Co' }} onSend={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByLabelText('Tên công ty *')).toHaveValue('Tài khoản Co');
    expect(screen.getByLabelText('Người liên hệ HR *')).toHaveValue('');
    expect(screen.getByLabelText('Email HR nhận phản hồi *')).toHaveValue('');
    expect(screen.getByLabelText('Địa điểm phỏng vấn cụ thể *')).toHaveValue('');
});

it('uses the latest interview snapshot rather than an older one or another decision', () => {
    setup({ detail: { ...detail, timeline: [
        { decision_snapshot: { decision: 'accepted', offer: { companyName: 'Offer Co' } } },
        { decision_snapshot: { decision: 'interview', interview: { ...interview, round: 'Vòng 3' } } },
        { decision_snapshot: { decision: 'interview', interview: { ...interview, round: 'Vòng 1' } } }
    ] } });
    expect(screen.getByLabelText('Vòng phỏng vấn')).toHaveValue('Vòng 3');
    expect(screen.getByLabelText('Tên công ty *')).toHaveValue('Job Example');
});

it.each([
    [{ companyName: 'x'.repeat(256) }, 'tên công ty'],
    [{ preparation: 'x'.repeat(3001) }, 'chuẩn bị'],
    [{ contactEmail: 'hr@' + 'a'.repeat(64) + '.com' }, 'Email'],
    [{ contactEmail: '.hr@example.com' }, 'Email'],
    [{ contactEmail: 'hr..team@example.com' }, 'Email'],
    [{ confirmBy: '2099-10-13' }, 'Hạn xác nhận'],
    [{ confirmBy: '2099-10-15T09:31' }, 'Hạn xác nhận phải']
])('explains which field is wrong %#', (changes, message) => {
    expect(validateInterviewForm({ ...interview, ...changes })).toContain(message);
});

it('accepts a confirmation deadline equal to the interview start', () => {
    expect(validateInterviewForm({ ...interview, confirmBy: '2099-10-15T09:30' })).toBe('');
});
