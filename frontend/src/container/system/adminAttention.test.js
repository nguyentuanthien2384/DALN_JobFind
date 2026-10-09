import { act, cleanup, renderHook } from '@testing-library/react';
import { getAllCompany, getAllPostByRoleAdminService } from '../../service/userService';
import { supportRequest } from '../../service/supportChatService';
import { notifyAdminAttentionChanged } from './adminEvents';
import { getAdminAttention, refreshAdminAttention, resetAdminAttentionForTests, useAdminAttention } from './adminAttention';

jest.mock('../../service/userService', () => ({ getAllCompany: jest.fn(), getAllPostByRoleAdminService: jest.fn() }));
jest.mock('../../service/supportChatService', () => ({ supportRequest: jest.fn() }));

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const online = value => Object.defineProperty(navigator, 'onLine', { configurable: true, value });
const visibility = value => Object.defineProperty(document, 'visibilityState', { configurable: true, value });

beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    resetAdminAttentionForTests();
    online(true);
    visibility('visible');
    getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count: 4 });
    getAllCompany.mockResolvedValue({ errCode: 0, count: '2' });
    supportRequest.mockResolvedValue([{ status: 'waiting' }, { status: 'resolved' }]);
});
afterEach(() => {
    cleanup();
    resetAdminAttentionForTests();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    delete navigator.onLine;
    delete document.visibilityState;
});

test('menu and dashboard share one initial read and polling timer until the last view closes', async () => {
    const menu = renderHook(() => useAdminAttention());
    const dashboard = renderHook(() => useAdminAttention());
    expect(menu.result.current.pendingPosts).toBeNull();
    await act(flush);
    expect(menu.result.current).toMatchObject({ pendingPosts: 4, pendingCompanies: 2, waitingSupport: 1 });
    expect(dashboard.result.current).toEqual(menu.result.current);
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);

    menu.unmount();
    await act(async () => { jest.advanceTimersByTime(60000); await flush(); });
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2);
    dashboard.unmount();
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => { notifyAdminAttentionChanged(); jest.advanceTimersByTime(60000); await flush(); });
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2);
});

test('overlapping manual refreshes reuse the same pending request and publish one snapshot', async () => {
    let finish;
    getAllPostByRoleAdminService.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = refreshAdminAttention();
    const second = refreshAdminAttention();
    expect(second).toBe(first);
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
    finish({ errCode: 0, count: 7 });
    await expect(first).resolves.toMatchObject({ pendingPosts: 7, pendingCompanies: 2 });
    expect(getAdminAttention()).toMatchObject({ pendingPosts: 7, pendingCompanies: 2 });
});

test('keeps previously known counts when one source is offline while updating other sources', async () => {
    await refreshAdminAttention();
    getAllPostByRoleAdminService.mockRejectedValueOnce(new Error('offline'));
    getAllCompany.mockResolvedValueOnce({ errCode: 0, count: 0 });
    supportRequest.mockRejectedValueOnce(new Error('support offline'));
    await expect(refreshAdminAttention()).resolves.toMatchObject({ pendingPosts: 4, pendingCompanies: 0, waitingSupport: 1 });
});

test.each([undefined, null, '', ' ', false, true, -1, 1.5, 'not a count'])
('does not report an unknown or malformed pending count as a valid backlog: %j', async count => {
    getAllPostByRoleAdminService.mockResolvedValue({ errCode: 0, count });
    await expect(refreshAdminAttention()).resolves.toMatchObject({ pendingPosts: null });
});

test('does not refresh while hidden or offline and resumes promptly on becoming visible or online', async () => {
    visibility('hidden');
    const view = renderHook(() => useAdminAttention());
    await act(async () => { jest.advanceTimersByTime(60000); await flush(); });
    expect(getAllPostByRoleAdminService).not.toHaveBeenCalled();
    visibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await flush(); });
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);

    online(false);
    await act(async () => { notifyAdminAttentionChanged(); jest.advanceTimersByTime(60000); await flush(); });
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
    online(true);
    await act(async () => { window.dispatchEvent(new Event('online')); await flush(); });
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(2);
    expect(view.result.current.pendingPosts).toBe(4);
});

test('disabled views make no privileged requests and stop polling when access is revoked', async () => {
    const view = renderHook(({ enabled }) => useAdminAttention(enabled), { initialProps: { enabled: false } });
    await act(flush);
    expect(getAllPostByRoleAdminService).not.toHaveBeenCalled();
    expect(supportRequest).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    view.rerender({ enabled: true });
    await act(flush);
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: false });
    await act(async () => { notifyAdminAttentionChanged(); jest.advanceTimersByTime(60000); await flush(); });
    expect(getAllPostByRoleAdminService).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
});
