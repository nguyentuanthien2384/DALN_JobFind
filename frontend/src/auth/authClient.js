import axios from 'axios';
const baseURL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';
const api = axios.create({ baseURL, withCredentials: true, timeout: 15000 });
let accessToken = null;
let accessOwner = null;
let accessExpiresAt = 0;
let pendingRefresh = null;
let revision = 0;
let loggingOut = false;
const withSessionLock = task => navigator.locks?.request ? navigator.locks.request('jobfind-refresh', task) : task();
export const isManagedSession = (marker = localStorage.getItem('token_user')) => Boolean(marker && marker.startsWith('jf-session:'));
export const getAccessTokenSync = () => {
  const marker = localStorage.getItem('token_user');
  return (accessOwner === marker ? accessToken : null) || (isManagedSession(marker) ? null : marker);
};
const assignAccess = (token) => {
  accessToken = token;
  accessOwner = localStorage.getItem('token_user');
  try { accessExpiresAt = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; }
  catch { accessExpiresAt = Date.now() + 5 * 60 * 1000; }
};
export const establishSession = ({ token, user }) => {
  if (!token || !user) throw new Error('Invalid authentication response');
  revision += 1;
  localStorage.setItem('userData', JSON.stringify(user));
  // A public, non-secret marker preserves existing route guards and cross-tab events.
  localStorage.setItem('token_user', `jf-session:${(window.crypto?.randomUUID?.() || Date.now().toString(36))}`);
  assignAccess(token);
};
export const forgetAccess = () => { accessToken = null; accessOwner = null; accessExpiresAt = 0; revision += 1; };
export const endLocalSession = () => {
  localStorage.removeItem('token_user');
  localStorage.removeItem('userData');
  forgetAccess();
  window.dispatchEvent(new Event('jobfind:session-ended'));
};
export const refreshSession = async () => {
  if (pendingRefresh) return pendingRefresh;
  const marker = localStorage.getItem('token_user');
  const startedRevision = revision;
  const task = async () => {
    // Web Locks serialize cookie rotations across tabs (where supported).
    const refresh = async () => {
      if (loggingOut || startedRevision !== revision || localStorage.getItem('token_user') !== marker) throw new Error('Session changed');
      const result = await api.post('/api/auth/refresh', {});
      if (result.data?.errCode !== 0 || !result.data.token) throw new Error('Invalid refresh response');
      // A late response after logout must never restore a removed session.
      if (loggingOut || startedRevision !== revision || localStorage.getItem('token_user') !== marker) throw new Error('Session changed');
      assignAccess(result.data.token);
      if (result.data.user) localStorage.setItem('userData', JSON.stringify(result.data.user));
      return result.data;
    };
    return withSessionLock(refresh);
  };
  pendingRefresh = task().catch(error => {
    if (error?.response?.status === 401 && isManagedSession(marker)
        && localStorage.getItem('token_user') === marker) {
      endLocalSession();
    }
    throw error;
  }).finally(() => { pendingRefresh = null; });
  return pendingRefresh;
};
export const getAccessToken = async () => {
  if (!isManagedSession()) return getAccessTokenSync();
  if (!getAccessTokenSync() || accessExpiresAt - Date.now() < 45_000) await refreshSession();
  return getAccessTokenSync();
};
export const logoutServer = async () => {
  loggingOut = true;
  revision += 1;
  try {
    await pendingRefresh?.catch(() => {});
    const token = getAccessTokenSync();
    await withSessionLock(() => api.post('/api/auth/logout', {}, token ? { headers: { Authorization: `Bearer ${token}` } } : {}));
    endLocalSession();
  }
  finally { loggingOut = false; forgetAccess(); }
};
const assertProvider = provider => {
  if (!['google', 'github', 'auth0'].includes(provider)) throw new Error('Unsupported provider');
  return provider;
};
export const startSocialLink = async (provider, password) => {
  assertProvider(provider);
  const bearer = await getAccessToken();
  if (!bearer) throw new Error('Login required');
  const res = await api.post(`/api/auth/sso/${provider}/link/start`, { password }, { headers: { Authorization: `Bearer ${bearer}` } });
  if (res.data?.errCode !== 0 || !res.data.redirect) throw new Error('SSO unavailable');
  window.location.assign(res.data.redirect);
};
export const startSocialLogin = (provider, { rememberMe = false } = {}) => window.location.assign(`${baseURL.replace(/\/$/, '')}/api/auth/sso/${assertProvider(provider)}/start?rememberMe=${rememberMe === true}`);
export const startGoogleLink = password => startSocialLink('google', password);
export const startGoogleLogin = options => startSocialLogin('google', options);
export const getProviders = async () => (await api.get('/api/auth/providers')).data;
export const getSocialSignup = async () => (await api.get('/api/auth/sso/signup')).data;
export const completeSocialSignup = async values => (await api.post('/api/auth/sso/signup', values)).data;
