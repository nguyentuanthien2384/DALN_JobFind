import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CandidateNotifications from './CandidateNotifications';
import { getNotificationByUserService, markReadNotificationService } from '../../service/userService';
import { getSocket } from '../../socket';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';
import { NOTIFICATIONS_UPDATED_EVENT, notifyNotificationsUpdated } from '../../util/notificationEvents';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('../../service/userService', () => ({ getNotificationByUserService: jest.fn(), markReadNotificationService: jest.fn() }));
jest.mock('../../socket', () => ({ getSocket: jest.fn(), disconnectSocket: jest.fn() }));

const notification = { id: 42, typeCode: 'NEW_POST', content: 'Công ty ITP vừa đăng tin tuyển dụng mới: Kỹ sư Node.js',
    isChecked: 0, link: '/detail-job/87', createdAt: '2026-09-25T08:00:00.000Z' };
const response = { errCode: 0, data: [notification], count: 1, unreadCount: 1 };
const handlers = {};
const socket = { on: jest.fn((event, handler) => { handlers[event] = handler; }), off: jest.fn() };
const mount = () => render(<BrowserRouter><Routes>
    <Route path="/candidate/notifications" element={<CandidateNotifications />} />
    <Route path="/detail-job/:id" element={<h1>Chi tiết công việc</h1>} />
</Routes></BrowserRouter>);

beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    Object.keys(handlers).forEach(key => delete handlers[key]);
    socket.on.mockImplementation((event, handler) => { handlers[event] = handler; });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    localStorage.setItem('token_user', 'fixture-token');
    localStorage.setItem('userData', JSON.stringify({ id: 5, roleCode: 'CANDIDATE' }));
    window.history.replaceState({}, '', '/candidate/notifications');
    getSocket.mockReturnValue(socket);
    getNotificationByUserService.mockResolvedValue(response);
    markReadNotificationService.mockResolvedValue({ errCode: 0 });
});

test('shows persisted company job notifications and opens the exact job after marking it read', async () => {
    const eventListener = jest.fn();
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, eventListener);
    mount();
    const link = await screen.findByRole('link', { name: notification.content });
    expect(link).toHaveAttribute('href', '/detail-job/87');
    expect(getNotificationByUserService).toHaveBeenCalledWith({ userId: 5, limit: 10, offset: 0 });
    expect(screen.getByText('1 thông báo · 1 chưa đọc')).toBeInTheDocument();
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Chi tiết công việc' })).toBeInTheDocument();
    expect(markReadNotificationService).toHaveBeenCalledWith({ userId: 5, id: 42 });
    expect(eventListener).toHaveBeenCalledTimes(1);
    window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, eventListener);
});

test('receives a newly published company job while the page is open', async () => {
    getNotificationByUserService.mockResolvedValueOnce({ ...response, data: [], count: 0, unreadCount: 0 });
    const { unmount } = mount();
    expect(await screen.findByRole('heading', { name: 'Chưa có thông báo nào' })).toBeInTheDocument();
    await act(async () => { await handlers['notification:new'](); });
    expect(await screen.findByRole('link', { name: notification.content })).toBeInTheDocument();
    expect(screen.getByText('1 thông báo · 1 chưa đọc')).toBeInTheDocument();
    unmount();
    expect(socket.off).toHaveBeenCalledWith('notification:new', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('notification:read', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('connect', expect.any(Function));
});

test('marks all notifications read and syncs reads from the header', async () => {
    mount();
    await screen.findByRole('link', { name: notification.content });
    fireEvent.click(screen.getByRole('button', { name: 'Đọc tất cả' }));
    await waitFor(() => expect(screen.getByText('1 thông báo · 0 chưa đọc')).toBeInTheDocument());
    expect(markReadNotificationService).toHaveBeenCalledWith({ userId: 5 });
    expect(screen.getByText('Đã đọc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đọc tất cả' })).toBeDisabled();
    getNotificationByUserService.mockResolvedValue({ ...response, data: [{ ...notification, isChecked: 1 }], unreadCount: 0 });
    await act(async () => { notifyNotificationsUpdated('header'); });
    expect(getNotificationByUserService).toHaveBeenCalledTimes(2);
});

test('read failures leave the notification unread and allow retry', async () => {
    markReadNotificationService.mockRejectedValueOnce(new Error('offline'));
    mount();
    fireEvent.click(await screen.findByRole('link', { name: notification.content }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đánh dấu được thông báo đã đọc');
    expect(screen.getByText('1 thông báo · 1 chưa đọc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: notification.content }));
    expect(await screen.findByRole('heading', { name: 'Chi tiết công việc' })).toBeInTheDocument();
});

test('opens already-read notifications without another read mutation', async () => {
    getNotificationByUserService.mockResolvedValue({ ...response, data: [{ ...notification, isChecked: 1 }], unreadCount: 0 });
    mount();
    fireEvent.click(await screen.findByRole('link', { name: notification.content }));
    expect(await screen.findByRole('heading', { name: 'Chi tiết công việc' })).toBeInTheDocument();
    expect(markReadNotificationService).not.toHaveBeenCalled();
});

test('supports historical notifications with URL pagination', async () => {
    getNotificationByUserService.mockResolvedValue({ ...response, count: 31 });
    window.history.replaceState({}, '', '/candidate/notifications?page=2');
    mount();
    await screen.findByRole('link', { name: notification.content });
    expect(getNotificationByUserService).toHaveBeenLastCalledWith({ userId: 5, limit: 10, offset: 10 });
    fireEvent.click(screen.getByText('Tiếp'));
    await waitFor(() => expect(getNotificationByUserService).toHaveBeenLastCalledWith({ userId: 5, limit: 10, offset: 20 }));
    expect(window.location.search).toBe('?page=3');
});

test('returns an out-of-range page to the last available page', async () => {
    window.history.replaceState({}, '', '/candidate/notifications?page=7');
    mount();
    await screen.findByRole('link', { name: notification.content });
    expect(window.location.search).toBe('');
    expect(getNotificationByUserService).toHaveBeenLastCalledWith({ userId: 5, limit: 10, offset: 0 });
});

test('distinguishes loading failures from no notifications and retries', async () => {
    getNotificationByUserService.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được thông báo');
    expect(screen.queryByText('Chưa có thông báo nào')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('link', { name: notification.content })).toBeInTheDocument();
});

test('keeps the latest state when an older refresh finishes after a read', async () => {
    mount();
    await screen.findByRole('link', { name: notification.content });
    let finishOld;
    getNotificationByUserService.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    act(() => { handlers['notification:new'](); });
    fireEvent.click(screen.getByRole('button', { name: 'Đọc tất cả' }));
    await screen.findByText('1 thông báo · 0 chưa đọc');
    await act(async () => { finishOld(response); });
    expect(screen.getByText('1 thông báo · 0 chưa đọc')).toBeInTheDocument();
});

test('refreshes via polling when realtime is unavailable', async () => {
    jest.useFakeTimers();
    getSocket.mockReturnValue(null);
    try {
        mount();
        await act(async () => {});
        getNotificationByUserService.mockResolvedValue({ ...response, count: 2, unreadCount: 2 });
        await act(async () => { jest.advanceTimersByTime(30000); });
        expect(screen.getByText('2 thông báo · 2 chưa đọc')).toBeInTheDocument();
    } finally { jest.useRealTimers(); }
});

test('hides personal notifications when the candidate session ends', async () => {
    mount();
    await screen.findByRole('link', { name: notification.content });
    act(() => { window.dispatchEvent(new Event(SESSION_ENDED_EVENT)); });
    expect(screen.queryByRole('link', { name: notification.content })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập bằng tài khoản ứng viên');
});

test('does not request notifications for a recruiter account', () => {
    localStorage.setItem('userData', JSON.stringify({ id: 5, roleCode: 'EMPLOYER' }));
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập bằng tài khoản ứng viên');
    expect(getNotificationByUserService).not.toHaveBeenCalled();
});

test('shows non-link notifications safely and supports marking them read', async () => {
    getNotificationByUserService.mockResolvedValue({ ...response, data: [{ ...notification, link: 'https://other.example/account' }] });
    mount();
    expect(await screen.findByText(notification.content)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: notification.content })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã đọc' }));
    await waitFor(() => expect(screen.getByText('Đã đọc')).toBeInTheDocument());
});
