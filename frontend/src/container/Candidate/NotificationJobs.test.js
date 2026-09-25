import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import NotificationJobs from './NotificationJobs';
import { getNotificationJobs } from '../../service/notificationJobsService';
import { SESSION_ENDED_EVENT } from '../../auth/sessionExpiry';

jest.mock('react-router-dom', () => {
    global.TextEncoder = require('util').TextEncoder;
    global.TextDecoder = require('util').TextDecoder;
    return jest.requireActual('react-router');
});
jest.mock('../../service/notificationJobsService', () => ({ getNotificationJobs: jest.fn() }));
const job = { id: 42, timeEnd: '2000000000000', userPostData: { userCompanyData: { name: 'Công ty đang theo dõi' } },
    postDetailData: { name: 'Kỹ sư Node.js', provincePostData: { value: 'Hà Nội' }, salaryTypePostData: { value: 'Thỏa thuận' } } };
const mount = () => render(<BrowserRouter><Routes>
    <Route path="/candidate/followed-jobs" element={<NotificationJobs source="followed" />} />
    <Route path="/candidate/recommended-jobs" element={<NotificationJobs source="recommended" />} />
    <Route path="/detail-job/:id" element={<h1>Chi tiết công việc</h1>} />
</Routes></BrowserRouter>);
beforeEach(() => {
    jest.resetAllMocks(); localStorage.clear();
    localStorage.setItem('token_user', 'fixture-token');
    localStorage.setItem('userData', JSON.stringify({ id: 5, roleCode: 'CANDIDATE' }));
    window.history.replaceState({}, '', '/candidate/followed-jobs');
    getNotificationJobs.mockResolvedValue({ errCode: 0, data: [job], count: 1, source: 'followed' });
});

test('loads the selected collection and opens the specific job from its card', async () => {
    mount();
    const card = await screen.findByRole('link', { name: /Kỹ sư Node.js/ });
    expect(getNotificationJobs).toHaveBeenCalledWith({ source: 'followed', limit: 10, offset: 0 });
    expect(card).toHaveAttribute('href', '/detail-job/42');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Việc làm từ công ty bạn theo dõi');
    fireEvent.click(card);
    expect(await screen.findByRole('heading', { name: 'Chi tiết công việc' })).toBeInTheDocument();
});

test.each([
    ['followed', 'Khám phá công ty', '/company'],
    ['recommended', 'Cập nhật thiết lập tìm việc', '/candidate/usersetting'],
])('shows an honest empty collection with a useful next step for %s', async (source, action, target) => {
    window.history.replaceState({}, '', `/candidate/${source === 'followed' ? 'followed' : 'recommended'}-jobs`);
    getNotificationJobs.mockResolvedValue({ errCode: 0, data: [], count: 0, source });
    mount();
    expect(await screen.findByRole('link', { name: action })).toHaveAttribute('href', target);
    expect(screen.getByText('0 việc làm đang tuyển')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Kỹ sư Node.js/ })).not.toBeInTheDocument();
});

test('keeps failure distinct from empty results and allows retry', async () => {
    getNotificationJobs.mockRejectedValueOnce(new Error('offline'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được danh sách việc làm');
    expect(screen.queryByText('0 việc làm đang tuyển')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('link', { name: /Kỹ sư Node.js/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('uses URL pagination and requests the next offset', async () => {
    window.history.replaceState({}, '', '/candidate/followed-jobs?page=2');
    getNotificationJobs.mockResolvedValue({ errCode: 0, data: [job], count: 35, source: 'followed' });
    mount(); await screen.findByRole('link', { name: /Kỹ sư Node.js/ });
    expect(getNotificationJobs).toHaveBeenLastCalledWith({ source: 'followed', limit: 10, offset: 10 });
    fireEvent.click(screen.getByText('Tiếp'));
    await waitFor(() => expect(getNotificationJobs).toHaveBeenLastCalledWith({ source: 'followed', limit: 10, offset: 20 }));
    await screen.findByRole('link', { name: /Kỹ sư Node.js/ });
    expect(window.location.search).toBe('?page=3');
});

test('does not show an old collection when its delayed response arrives after switching tabs', async () => {
    let resolveOld;
    getNotificationJobs.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    getNotificationJobs.mockResolvedValue({ errCode: 0, data: [{ ...job, id: 43, postDetailData: { name: 'Công việc phù hợp' } }], count: 1, source: 'recommended' });
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Phù hợp với bạn' }));
    expect(await screen.findByRole('link', { name: /Công việc phù hợp/ })).toHaveAttribute('href', '/detail-job/43');
    await act(async () => { resolveOld({ errCode: 0, data: [job], count: 1, source: 'followed' }); });
    expect(screen.queryByRole('link', { name: /Kỹ sư Node.js/ })).not.toBeInTheDocument();
});

test('retains results during a same-account refresh in another tab, and hides them when the session ends', async () => {
    mount(); await screen.findByRole('link', { name: /Kỹ sư Node.js/ });
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'userData' })));
    expect(screen.getByRole('link', { name: /Kỹ sư Node.js/ })).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event(SESSION_ENDED_EVENT)));
    expect(screen.queryByRole('link', { name: /Kỹ sư Node.js/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập bằng tài khoản ứng viên');
});

test('does not request personal job lists for a noncandidate account', () => {
    localStorage.setItem('userData', JSON.stringify({ id: 1, roleCode: 'ADMIN' }));
    mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Đăng nhập bằng tài khoản ứng viên');
    expect(getNotificationJobs).not.toHaveBeenCalled();
});
