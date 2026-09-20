import axios from 'axios';
const baseURL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';
const api = axios.create({ baseURL, withCredentials: true, timeout: 15000 });
let accessToken = null;
let accessExpiresAt = 0;
let pendingRefresh = null;
export const isManagedSession = (marker = localStorage.getItem('token_user')) => Boolean(marker && marker.startsWith('jf-session:'));
export const getAccessTokenSync = () => accessToken || (isManagedSession() ? null : localStorage.getItem('token_user'));
const assignAccess = (token) => {
  accessToken = token;
  try { accessExpiresAt = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
  catch { accessExpiresAt = Date.now() + 5 * 60 * 1000; }
};
export const establishSession = ({ token, user }) => {
  if (!token || !user) throw new Error('Invalid authentication response');
  assignAccess(token);
  localStorage.setItem('userData', JSON.stringify(user));
  // A public, non-secret marker preserves existing route guards and cross-tab events.
  localStorage.setItem('token_user', `jf-session:${(window.crypto?.randomUUID?.() || Date.now().toString(36))}`);
};
export const forgetAccess = () => { accessToken = null; accessExpiresAt = 0; };
export const refreshSession = async () => {
  if (pendingRefresh) return pendingRefresh;
  const marker = localStorage.getItem('token_user');
  const task = async () => {
    // Web Locks serialize cookie rotations across tabs (where supported).
    const refresh = async () => {
      const result = await api.post('/api/auth/refresh', {});
      if (result.data?.errCode !== 0 || !result.data.token) throw new Error('Invalid refresh response');
      // A late response after logout must never restore a removed session.
      if (marker && localStorage.getItem('token_user') !== marker) throw new Error('Session changed');
      assignAccess(result.data.token);
      if (result.data.user) localStorage.setItem('userData', JSON.stringify(result.data.user));
      return result.data;
    };
    return navigator.locks?.request ? navigator.locks.request('jobfind-refresh', refresh) : refresh();
  };
  pendingRefresh = task().catch(error => {
    if (error?.response?.status === 401 && isManagedSession(marker)
        && localStorage.getItem('token_user') === marker) {
      localStorage.removeItem('token_user');
      localStorage.removeItem('userData');
      forgetAccess();
      window.dispatchEvent(new Event('jobfind:session-ended'));
    }
    throw error;
  }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
};
export const getAccessToken = async () => {
  if (!isManagedSession()) return getAccessTokenSync();
  if (!accessToken || accessExpiresAt - Date.now() < 45_000) await refreshSession();
  return accessToken;
};
export const logoutServer = async () => {
  try {
    const token = getAccessTokenSync();
    await api.post('/api/auth/logout', {}, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  }
  finally { forgetAccess(); }
};
export const startGoogleLink = async () => {
  const bearer = await getAccessToken();
  if (!bearer) throw new Error('Login required');
  const res = await api.post('/api/auth/sso/google/link/start', {}, { headers: { Authorization: `Bearer ${bearer}` } });
  if (res.data?.errCode !== 0 || !res.data.redirect) throw new Error('SSO unavailable');
  window.location.assign(res.data.redirect);
};
export const startGoogleLogin = () => window.location.assign(`${baseURL.replace(/\/$/, '')}/api/auth/sso/google/start`);
