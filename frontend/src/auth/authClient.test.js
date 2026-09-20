import { establishSession, forgetAccess, getAccessTokenSync, refreshSession, logoutServer } from './authClient';
import axios from 'axios';
jest.mock('axios', () => ({ create: jest.fn(() => ({ post: jest.fn() })) }));
const instance = axios.create.mock.results[0].value;
beforeEach(() => { localStorage.clear(); forgetAccess(); instance.post.mockReset(); });
test('new login stores a public marker, not JWT or refresh credentials', () => {
  establishSession({ token: 'access-jwt-test', user: { id: 7, roleCode: 'CANDIDATE' } });
  expect(localStorage.getItem('token_user')).toMatch(/^jf-session:/);
  expect(localStorage.getItem('token_user')).not.toContain('access-jwt-test');
  expect(getAccessTokenSync()).toBe('access-jwt-test');
});
test('refresh sends cookies and rotates access in memory', async () => {
  establishSession({ token: 'initial-access', user: { id: 7 } });
  instance.post.mockResolvedValue({ data: { errCode: 0, token: 'rotated-access', user: { id: 7 } } });
  const rotated = await refreshSession();
  expect(instance.post).toHaveBeenCalledWith('/api/auth/refresh', {});
  expect(rotated.token).toBe('rotated-access');
  expect(getAccessTokenSync()).toBe('rotated-access');
  expect(localStorage.getItem('token_user')).not.toBe('rotated-access');
});


test('deduplicates concurrent refreshes in the same tab', async () => {
  establishSession({ token: 'initial', user: { id: 7 } });
  let complete;
  instance.post.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const first = refreshSession(); const second = refreshSession();
  expect(instance.post).toHaveBeenCalledTimes(1);
  complete({ data: { errCode: 0, token: 'next', user: { id: 7 } } });
  await Promise.all([first, second]);
});
test('late refresh never overwrites a newer account or restores a removed marker', async () => {
  establishSession({ token: 'old', user: { id: 7 } });
  let complete;
  instance.post.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const pending = refreshSession();
  establishSession({ token: 'new-account', user: { id: 8 } });
  complete({ data: { errCode: 0, token: 'stale', user: { id: 7 } } });
  await expect(pending).rejects.toThrow('Session changed');
  expect(getAccessTokenSync()).toBe('new-account');
  expect(JSON.parse(localStorage.getItem('userData')).id).toBe(8);
});
test('logout waits for in-flight rotation and never lets it restore authentication', async () => {
  establishSession({ token: 'old', user: { id: 7 } });
  let complete;
  instance.post.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
    .mockResolvedValueOnce({ status: 204 });
  const pending = refreshSession();
  const stopped = logoutServer();
  complete({ data: { errCode: 0, token: 'stale', user: { id: 7 } } });
  await expect(pending).rejects.toThrow('Session changed');
  await stopped;
  expect(localStorage.getItem('token_user')).toBeNull();
  expect(getAccessTokenSync()).toBeNull();
  expect(instance.post.mock.calls[1][0]).toBe('/api/auth/logout');
});
test('temporary refresh failure retains session marker', async () => {
  establishSession({ token: 'old', user: { id: 7 } });
  const marker = localStorage.getItem('token_user');
  instance.post.mockRejectedValue({ response: { status: 503 } });
  await expect(refreshSession()).rejects.toEqual({ response: { status: 503 } });
  expect(localStorage.getItem('token_user')).toBe(marker);
});
test('an account marker change immediately hides the previous memory token', () => {
  establishSession({ token: 'old', user: { id: 7 } });
  localStorage.setItem('token_user', 'jf-session:another-account');
  expect(getAccessTokenSync()).toBeNull();
});
