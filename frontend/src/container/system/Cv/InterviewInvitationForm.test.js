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
