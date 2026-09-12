import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import OfferLetterForm, { validateOfferForm } from './OfferLetterForm';

const offer = { companyName: 'Job Example', startDate: '2099-10-20', startTime: '08:30', timeZone: 'Asia/Ho_Chi_Minh',
    workMode: 'onsite', location: '12 Nguyễn Huệ', responseDeadline: '2099-10-18T17:00', contactName: 'Hà', contactEmail: 'hr@example.com' };
const detail = { id: 1, candidate_name: 'Lan', candidate_email: 'lan@example.com', job_title: 'Developer' };
const setup = (props = {}) => {
    const onSend = jest.fn();
    render(<OfferLetterForm detail={detail} user={{}} message="Chào mừng Lan" onSend={onSend} onCancel={jest.fn()} {...props} />);
    return onSend;
};

it('requires complete logistics before showing the preview or sending', () => {
    const onSend = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tên công ty');
    expect(screen.queryByRole('button', { name: 'Xác nhận gửi thư mời' })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
});

it('restores an existing offer, previews its details and submits only after explicit confirmation', () => {
    const onSend = setup({ detail: { ...detail, timeline: [{ decision_snapshot: { decision: 'accepted', offer } }] } });
    fireEvent.change(screen.getByLabelText('Người liên hệ HR *'), { target: { value: '  Hà Nguyễn  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời' }));
    expect(screen.getByText('20/10/2099')).toBeInTheDocument();
    expect(screen.getByText('18/10/2099 lúc 17:00')).toBeInTheDocument();
    expect(screen.getByText('12 Nguyễn Huệ')).toBeInTheDocument();
    expect(screen.getByText('Chào mừng Lan')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận gửi thư mời' }));
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ ...offer, contactName: 'Hà Nguyễn' }));
});

it('allows editing the preview without losing entered fields', () => {
    setup({ detail: { ...detail, latestDecision: { decision: 'accepted', offer } } });
    fireEvent.click(screen.getByRole('button', { name: 'Xem trước thư mời' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chỉnh sửa thư' }));
    expect(screen.getByLabelText('Địa điểm nhận việc cụ thể *')).toHaveValue(offer.location);
});

it.each([
    { startDate: '2099-02-30' }, { startTime: '24:30' }, { startDate: '2020-01-01' },
    { responseDeadline: '2099-10-21T09:00' }, { responseDeadline: '2020-01-01T09:00' },
    { workMode: 'remote', meetingUrl: '' }, { location: ' ' }, { meetingUrl: 'javascript:alert(1)' },
    { meetingUrl: 'https://a:b@host.com' }, { contactEmail: 'a@x.com\r\nBcc: bad@x.com' }
])('rejects invalid dates, missing logistics and unsafe input %#', (changes) => {
    expect(validateOfferForm({ ...offer, ...changes })).toBeTruthy();
});

it('accepts remote onboarding and compares deadlines in Vietnam time', () => {
    const remote = { ...offer, location: '', workMode: 'remote', meetingUrl: 'https://meet.example.com/join' };
    expect(validateOfferForm(remote)).toBe('');
    const input = { ...offer, startDate: '2026-10-01', startTime: '08:00', responseDeadline: '2026-10-01T07:30' };
    expect(validateOfferForm(input, Date.parse('2026-10-01T00:00:00Z'))).toBe('');
    expect(validateOfferForm(input, Date.parse('2026-10-01T00:30:00Z'))).toBeTruthy();
});
