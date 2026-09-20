import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SessionContext from '../../auth/SessionContext';
import { supportRequest } from '../../service/supportChatService';
import SupportInbox from './SupportInbox';
jest.mock('react-router-dom', () => ({ MemoryRouter: ({ children }) => children, Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a> }));
jest.mock('../../service/supportChatService', () => ({ supportRequest: jest.fn() }));
const ticket = (extra = {}) => ({ id: 'ticket-1', userId: 7, agentId: null, title: 'Không tải được hồ sơ', status: 'waiting', createdAt: 1700000000000, delivered: false, ...extra });
const messages = [{ id: 'message-1', role: 'user', text: 'Nội dung đã đồng ý chia sẻ' }];
const show = () => render(<MemoryRouter><SessionContext.Provider value={{ id: 21, roleCode: 'ADMIN' }}><SupportInbox/></SessionContext.Provider></MemoryRouter>);
const rowButton = name => screen.getByRole('button', { name: new RegExp(name) });
beforeEach(() => { jest.resetAllMocks(); supportRequest.mockResolvedValue([]); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('explains the empty consent queue and keeps meaningful controls visible', async () => {
  show();
  expect(await screen.findByText('Chưa có yêu cầu cần hỗ trợ')).toBeInTheDocument();
  expect(screen.getByText(/Hội thoại riêng với chatbot không tự đưa vào hàng đợi/)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Quy trình hỗ trợ' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Làm mới' })).toBeEnabled();
  expect(screen.getByLabelText('Trạng thái')).toBeInTheDocument();
});
test('a failed initial request never pretends the queue is empty and retry clears the error', async () => {
  supportRequest.mockRejectedValueOnce(new Error('Dịch vụ chưa sẵn sàng'));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Dịch vụ chưa sẵn sàng');
  expect(screen.queryByText('Chưa có yêu cầu cần hỗ trợ')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại danh sách' }));
  await screen.findByText('Chưa có yêu cầu cần hỗ trợ');
  expect(screen.queryByRole('alert')).toBeNull();
});
test('search is accent-insensitive and status/mine filters retain correct scope', async () => {
  supportRequest.mockResolvedValue([ticket(), ticket({ id: 'ticket-2', title: 'Thanh toán gói đăng', status: 'assigned', agentId: 21 }), ticket({ id: 'ticket-3', title: 'Yêu cầu khác', status: 'assigned', agentId: 22 })]);
  show(); await screen.findByRole('heading', { name: 'Không tải được hồ sơ' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'khong tai duoc' } });
  expect(screen.getByRole('heading', { name: 'Không tải được hồ sơ' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Thanh toán gói đăng' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Trạng thái'), { target: { value: 'mine' } });
  expect(screen.getByRole('heading', { name: 'Thanh toán gói đăng' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Yêu cầu khác' })).toBeNull();
});
test('opening a resolved request is read-only and shows its consent snapshot', async () => {
  const done = ticket({ status: 'resolved', agentId: 21, delivered: true });
  supportRequest.mockImplementation(path => Promise.resolve(path === '/handoffs' ? [done] : { ...done, messages }));
  show(); fireEvent.click(await screen.findByRole('button', { name: /Không tải được hồ sơ/ }));
  expect(await screen.findByText(messages[0].text)).toBeInTheDocument();
  expect(supportRequest).toHaveBeenLastCalledWith('/handoffs/ticket-1', expect.objectContaining({ signal: expect.anything() }));
  expect(supportRequest.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  expect(screen.queryByRole('button', { name: 'Đánh dấu đã xử lý' })).toBeNull();
});
test('claim then resolve updates details; cancel never closes the request', async () => {
  let current = ticket();
  supportRequest.mockImplementation((path, options) => {
    if (options?.method === 'POST') current = { ...current, agentId: 21, delivered: true, status: path.endsWith('/resolve') ? 'resolved' : 'assigned' };
    return Promise.resolve(path === '/handoffs' ? [current] : { ...current, messages });
  });
  show(); fireEvent.click(await screen.findByRole('button', { name: 'Tiếp nhận', exact: true }));
  expect(await screen.findByRole('link', { name: 'Mở tin nhắn với người dùng ↗' })).toHaveAttribute('href', '/admin/chat/7');
  const confirmation = jest.spyOn(window, 'confirm').mockReturnValue(false);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Đánh dấu đã xử lý' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã xử lý' }));
  expect(current.status).toBe('assigned');
  confirmation.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Đánh dấu đã xử lý' }));
  expect(await screen.findByText('Đã đánh dấu yêu cầu hoàn tất.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Đánh dấu đã xử lý' })).toBeNull());
});
test('a ticket assigned elsewhere cannot be claimed or resolved by this operator', async () => {
  const other = ticket({ status: 'assigned', agentId: 22, delivered: true });
  supportRequest.mockImplementation(path => Promise.resolve(path === '/handoffs' ? [other] : { ...other, messages }));
  show(); fireEvent.click(await screen.findByRole('button', { name: /Không tải được hồ sơ/ }));
  await screen.findByText(messages[0].text);
  const detail = within(screen.getByRole('region', { name: 'Chi tiết yêu cầu' }));
  expect(detail.queryByRole('button', { name: /Tiếp nhận|Đánh dấu|Thử chuyển/ })).toBeNull();
  expect(detail.queryByRole('link', { name: /Mở tin nhắn/ })).toBeNull();
});
test('failed delivery offers a retry and cannot appear ready to resolve', async () => {
  const pending = ticket({ status: 'assigned', agentId: 21, delivered: false });
  supportRequest.mockImplementation(path => Promise.resolve(path === '/handoffs' ? [pending] : { ...pending, messages }));
  show(); fireEvent.click(await screen.findByRole('button', { name: /Không tải được hồ sơ/ }));
  expect(await screen.findByRole('button', { name: 'Thử chuyển lại hội thoại' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Đánh dấu đã xử lý' })).toBeNull();
});
test('a late detail response cannot replace a newly selected request', async () => {
  let first;
  const second = ticket({ id: 'ticket-2', title: 'Yêu cầu mới' });
  supportRequest.mockImplementation(path => path === '/handoffs' ? Promise.resolve([ticket(), second]) : path.endsWith('ticket-1') ? new Promise(resolve => { first = resolve; }) : Promise.resolve({ ...second, messages }));
  show(); fireEvent.click(await screen.findByRole('button', { name: /Không tải được hồ sơ/ }));
  fireEvent.click(rowButton('Yêu cầu mới'));
  await screen.findByText(messages[0].text);
  await act(async () => first({ ...ticket(), messages: [{ ...messages[0], text: 'Old result' }] }));
  expect(screen.queryByText('Old result')).toBeNull();
});
test('refreshes the visible queue without overlapping requests and stops on unmount', async () => {
  jest.useFakeTimers();
  const view = show(); await act(async () => {});
  expect(supportRequest).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(supportRequest).toHaveBeenCalledTimes(2);
  view.unmount(); await act(async () => { jest.advanceTimersByTime(60000); });
  expect(supportRequest).toHaveBeenCalledTimes(2);
});
