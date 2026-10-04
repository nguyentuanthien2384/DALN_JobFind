import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InterviewCalendar from './InterviewCalendar';
import { adjacentMonth, calendarDays, dateLabel, vietnamDate } from './calendarDates';
import { getInterviewCalendar } from '../../service/interviewCalendarService';

jest.mock('../../service/interviewCalendarService', () => ({ getInterviewCalendar: jest.fn() }));
jest.mock('../../auth/sessionExpiry', () => ({ SESSION_ENDED_EVENT: 'jobfind:session-ended' }));
jest.mock('./InterviewComposer', () => () => <div data-testid="composer">Composer</div>);

const recruiter = { id: 2, companyId: 3, roleCode: 'EMPLOYER' };
const month = vietnamDate().slice(0, 7);
const makeEvent = (changes = {}) => ({
    id: 1, applicationId: 11, applicationStage: 'phong_van', candidateName: 'Nguyễn Đặng', candidateEmail: 'dang@example.com',
    jobTitle: 'Kỹ sư Frontend', companyName: 'Công ty Sao Khuê', status: 'scheduled',
    startAt: `${month}-15T09:00:00+07:00`, endAt: `${month}-15T10:00:00+07:00`,
    interview: { interviewMode: 'online', meetingUrl: 'https://meet.example.com/room', contactName: 'Hà', contactEmail: 'hr@example.com' }, ...changes,
});
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const respond = async (pending, data) => { await act(async () => { pending.resolve({ errCode: 0, data }); }); };
const list = () => { fireEvent.click(screen.getByRole('button', { name: 'Danh sách' })); return document.querySelector('.ic-list'); };

beforeEach(() => { localStorage.clear(); localStorage.setItem('token_user', 'test-token'); getInterviewCalendar.mockReset(); });

test('StrictMode remount finishes the latest request and uses the complete 42-day range', async () => {
    const old = deferred(); const latest = deferred();
    getInterviewCalendar.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    render(<StrictMode><InterviewCalendar user={recruiter} /></StrictMode>);
    expect(getInterviewCalendar).toHaveBeenCalledTimes(2);
    const days = calendarDays(month);
    expect(getInterviewCalendar).toHaveBeenLastCalledWith({ candidate: false, from: days[0], to: days[41] });
    await respond(latest, [makeEvent()]);
    expect(screen.getByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ })).toBeInTheDocument();
    expect(screen.queryByText('Đang tải lịch phỏng vấn…')).not.toBeInTheDocument();
    await respond(old, [makeEvent({ candidateName: 'Phản hồi cũ' })]);
    expect(screen.queryByText('Phản hồi cũ')).not.toBeInTheDocument();
});

test('a late response from the previous month cannot replace the newly selected month', async () => {
    const old = deferred(); const latest = deferred();
    getInterviewCalendar.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    render(<InterviewCalendar user={recruiter} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    const next = adjacentMonth(month, 1);
    expect(screen.getByLabelText('Chọn tháng')).toHaveValue(next);
    await respond(latest, [makeEvent({ id: 2, candidateName: 'Lịch mới', startAt: `${next}-15T09:00:00+07:00`, endAt: `${next}-15T10:00:00+07:00` })]);
    await respond(old, [makeEvent()]);
    expect(screen.getByRole('button', { name: /Lịch mới · Kỹ sư Frontend/ })).toBeInTheDocument();
    expect(screen.queryByText('Nguyễn Đặng')).not.toBeInTheDocument();
});

test('search ignores Vietnamese accents and combines status and mode filters in list view', async () => {
    getInterviewCalendar.mockResolvedValue({ errCode: 0, data: [makeEvent(), makeEvent({ id: 2, candidateName: 'Lan', status: 'past', interview: { interviewMode: 'onsite', location: 'Hà Nội' } })] });
    render(<InterviewCalendar user={recruiter} />);
    await screen.findByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ });
    const rows = list();
    expect(within(rows).getAllByRole('button')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Tìm lịch phỏng vấn'), { target: { value: 'nguyen dang' } });
    expect(within(rows).getAllByRole('button')).toHaveLength(1);
    expect(within(rows).queryByText('Lan')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Lọc hình thức'), { target: { value: 'onsite' } });
    expect(within(rows).getByText('Không có lịch phù hợp với bộ lọc.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tìm lịch phỏng vấn'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Lọc trạng thái'), { target: { value: 'past' } });
    expect(within(rows).getByText('Lan')).toBeInTheDocument();
    expect(getInterviewCalendar).toHaveBeenCalledTimes(1);
});

test('candidate details are read-only, explain email confirmation and do not link unsafe meeting URLs', async () => {
    getInterviewCalendar.mockResolvedValue({ errCode: 0, data: [makeEvent({ interview: { interviewMode: 'online', meetingUrl: 'javascript:alert(1)', contactName: 'Hà', contactEmail: 'hr@example.com' } })] });
    render(<InterviewCalendar candidate user={{ id: 10, roleCode: 'CANDIDATE' }} />);
    fireEvent.click(await screen.findByRole('button', { name: /Công ty Sao Khuê · Kỹ sư Frontend/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Để xác nhận tham gia hoặc đề xuất đổi lịch/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Link phòng họp không hợp lệ/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Liên hệ HR' })).toHaveAttribute('href', expect.stringContaining('mailto:hr@example.com?subject='));
    expect(screen.queryByRole('button', { name: 'Tạo lịch phỏng vấn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Đổi lịch / gửi lại thư mời' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
});

test('selecting a day exposes all appointments and inactive invitations cannot be downloaded', async () => {
    const day = `${month}-15`;
    getInterviewCalendar.mockResolvedValue({ errCode: 0, data: [makeEvent({ status: 'inactive', applicationStage: 'tu_choi' }), makeEvent({ id: 2, candidateName: 'Lan' }), makeEvent({ id: 3, candidateName: 'Bình' })] });
    render(<InterviewCalendar user={recruiter} />);
    await screen.findByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ });
    fireEvent.click(screen.getByRole('button', { name: `Xem lịch ngày ${dateLabel(day)}` }));
    const agenda = document.querySelector('.ic-agenda');
    expect(within(agenda).getByRole('heading', { name: 'Lịch trong ngày' })).toBeInTheDocument();
    expect(within(agenda).getAllByRole('button')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ }));
    expect(screen.getByRole('button', { name: 'Tải lịch .ics' })).toBeDisabled();
    expect(screen.getByText(/Lịch này không còn hiệu lực/)).toBeInTheDocument();
});

test('server errors expose a retry that refreshes the same date range', async () => {
    getInterviewCalendar.mockResolvedValueOnce({ errCode: 503, errMessage: 'Lịch đang bảo trì' }).mockResolvedValueOnce({ errCode: 0, data: [] });
    render(<InterviewCalendar user={recruiter} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Lịch đang bảo trì');
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Chưa có lịch phỏng vấn trong tháng này.');
    expect(getInterviewCalendar.mock.calls[1]).toEqual(getInterviewCalendar.mock.calls[0]);
});

test('logout immediately removes details and ignores a pending calendar refresh', async () => {
    const pending = deferred();
    getInterviewCalendar.mockResolvedValueOnce({ errCode: 0, data: [makeEvent()] }).mockReturnValueOnce(pending.promise);
    render(<InterviewCalendar user={recruiter} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    act(() => { localStorage.removeItem('token_user'); window.dispatchEvent(new Event('jobfind:session-ended')); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Vui lòng đăng nhập để xem lịch/)).toBeInTheDocument();
    await respond(pending, [makeEvent({ candidateName: 'Dữ liệu riêng tư' })]);
    expect(screen.queryByText('Dữ liệu riêng tư')).not.toBeInTheDocument();
});

test('account change clears old appointments while ignoring the previous account response', async () => {
    const old = deferred(); const latest = deferred();
    getInterviewCalendar.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { rerender } = render(<InterviewCalendar user={recruiter} />);
    localStorage.setItem('token_user', 'new-account-token');
    rerender(<InterviewCalendar user={{ id: 20, companyId: 30, roleCode: 'EMPLOYER' }} />);
    await respond(old, [makeEvent({ candidateName: 'Tài khoản cũ' })]);
    expect(screen.queryByText('Tài khoản cũ')).not.toBeInTheDocument();
    await respond(latest, [makeEvent({ candidateName: 'Tài khoản mới' })]);
    expect(await screen.findByRole('button', { name: /Tài khoản mới · Kỹ sư Frontend/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Đang tải lịch phỏng vấn…')).not.toBeInTheDocument());
});

test('a cached user without an access token does not load private appointments', () => {
    localStorage.removeItem('token_user');
    render(<InterviewCalendar user={recruiter} />);
    expect(screen.getByText(/Vui lòng đăng nhập để xem lịch/)).toBeInTheDocument();
    expect(getInterviewCalendar).not.toHaveBeenCalled();
});

test.each(['token_user', 'userData', null])('a cross-tab session storage event %p clears cached details and ignores pending data', async key => {
    const pending = deferred();
    getInterviewCalendar.mockResolvedValueOnce({ errCode: 0, data: [makeEvent()] }).mockReturnValueOnce(pending.promise);
    render(<InterviewCalendar user={recruiter} />);
    fireEvent.click(await screen.findByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key })));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Vui lòng đăng nhập để xem lịch/)).toBeInTheDocument();
    await respond(pending, [makeEvent({ candidateName: 'Thông tin cũ' })]);
    expect(screen.queryByText('Thông tin cũ')).not.toBeInTheDocument();
});

test('manual refresh disables duplicate refreshes while requesting the currently selected range', async () => {
    const pending = deferred();
    getInterviewCalendar.mockResolvedValueOnce({ errCode: 0, data: [] }).mockReturnValueOnce(pending.promise);
    render(<InterviewCalendar user={recruiter} />);
    await screen.findByText('Chưa có lịch phỏng vấn trong tháng này.');
    const refresh = screen.getByRole('button', { name: 'Làm mới lịch' });
    fireEvent.click(refresh);
    expect(refresh).toBeDisabled();
    fireEvent.click(refresh);
    expect(getInterviewCalendar).toHaveBeenCalledTimes(2);
    expect(getInterviewCalendar.mock.calls[1]).toEqual(getInterviewCalendar.mock.calls[0]);
    await respond(pending, [makeEvent()]);
    expect(refresh).toBeEnabled();
    expect(screen.getByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ })).toBeInTheDocument();
});

test('overnight appointments display their end date in detail and in the agenda', async () => {
    getInterviewCalendar.mockResolvedValue({ errCode: 0, data: [makeEvent({ startAt: `${month}-15T23:30:00+07:00`, endAt: `${month}-16T00:30:00+07:00` })] });
    render(<InterviewCalendar user={recruiter} />);
    const trigger = await screen.findByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ });
    const range = `23:30 – 00:30 (ngày 16/${month.slice(-2)})`;
    expect(within(document.querySelector('.ic-agenda')).getByRole('button', { name: /Nguyễn Đặng/ })).toHaveTextContent(range);
    fireEvent.click(trigger);
    expect(within(screen.getByRole('dialog')).getByText(range)).toBeInTheDocument();
});

test('the detail dialog cycles keyboard focus and restores it to the event when closed', async () => {
    getInterviewCalendar.mockResolvedValue({ errCode: 0, data: [makeEvent()] });
    render(<InterviewCalendar user={recruiter} />);
    const trigger = await screen.findByRole('button', { name: /Nguyễn Đặng · Kỹ sư Frontend/ });
    trigger.focus(); fireEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Đóng hộp thoại' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    const edit = screen.getByRole('button', { name: 'Đổi lịch / gửi lại thư mời' });
    expect(edit).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
});
