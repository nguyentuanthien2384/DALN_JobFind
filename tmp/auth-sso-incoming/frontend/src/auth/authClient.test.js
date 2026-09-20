import { establishSession, forgetAccess, getAccessTokenSync, refreshSession } from './authClient';
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
