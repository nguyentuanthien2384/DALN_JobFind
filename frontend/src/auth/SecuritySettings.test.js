import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SecuritySettings from './SecuritySettings';
import api from '../axios';
import { startGoogleLink } from './authClient';
jest.mock('../axios', () => ({ get: jest.fn(), post: jest.fn(), delete: jest.fn() }));
jest.mock('./authClient', () => ({ startGoogleLink: jest.fn(), forgetAccess: jest.fn() }));
jest.mock('../socket', () => ({ disconnectSocket: jest.fn() }));
jest.mock('../push/webPush', () => ({ clearPushOnLogout: jest.fn() }));
const data = { errCode: 0, google: false, identities: [], sessions: [{ familyId: 'current', current: true, method: 'password', expiresAt: '2026-10-01' }] };
beforeEach(() => { api.get.mockResolvedValue(data); window.history.replaceState({}, '', '/account/security'); });
test('shows sessions and an honest disabled-provider state', async () => {
  render(<SecuritySettings />);
  expect(await screen.findByText(/Phiên hiện tại/)).toBeInTheDocument();
  expect(screen.getByText('Đăng nhập Google chưa được quản trị viên cấu hình.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Liên kết tài khoản Google' })).toBeNull();
});
test('linking requires the current password and reports provider errors', async () => {
  api.get.mockResolvedValue({ ...data, google: true });
  startGoogleLink.mockRejectedValue({ response: { data: { errMessage: 'Mật khẩu hiện tại không chính xác' } } });
  render(<SecuritySettings />);
  const button = await screen.findByRole('button', { name: 'Liên kết tài khoản Google' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Mật khẩu JobFind hiện tại'), { target: { value: 'current-password' } });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không chính xác');
  expect(startGoogleLink).toHaveBeenCalledWith('current-password');
  await waitFor(() => expect(screen.getByLabelText('Mật khẩu JobFind hiện tại')).toHaveValue(''));
});
test('cancelling revocation never submits it', async () => {
  jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<SecuritySettings />);
  fireEvent.click(await screen.findByRole('button', { name: 'Đăng xuất phiên' }));
  expect(api.delete).not.toHaveBeenCalled();
  window.confirm.mockRestore();
});
test('a failed load can be retried without losing the page', async () => {
  api.get.mockResolvedValueOnce({ errCode: 503, errMessage: 'Tạm gián đoạn' });
  render(<SecuritySettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Tạm gián đoạn');
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText(/Phiên hiện tại/)).toBeInTheDocument();
});
