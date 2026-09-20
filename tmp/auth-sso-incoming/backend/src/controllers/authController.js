import userService from '../services/userService';
import * as sessions from '../services/authSessionService';
import * as oidc from '../services/oidcService';
const allowedOrigins = () => (process.env.URL_REACT || 'http://localhost:3000,http://localhost:3001')
  .split(',').map(x => x.trim()).filter(Boolean);
const validOrigin = (req) => {
  const origin = req.get('Origin');
  // Browser cross-origin POSTs carry Origin. Block missing Origin on cookie endpoints.
  return typeof origin === 'string' && allowedOrigins().includes(origin);
};
export const cookieOrigin = (req, res, next) => validOrigin(req) ? next() : res.status(403).json({ errCode: 403, errMessage: 'Invalid request origin' });
const failed = (res) => res.status(401).json({ errCode: 401, errMessage: 'Phiên đăng nhập không hợp lệ', refresh: true });
export const login = async (req, res) => {
  if (!validOrigin(req)) return res.status(403).json({ errCode: 403, errMessage: 'Invalid request origin' });
  try {
    const result = await userService.handleLogin(req.body || {});
    if (result.errCode !== 0) return res.status(401).json({ errCode: result.errCode, errMessage: result.errMessage });
    const issued = await sessions.createSession(result.user.id);
    sessions.setRefreshCookie(res, issued.refreshToken);
    return res.json({ errCode: 0, user: issued.user, token: issued.token });
  } catch (err) {
    console.error('Authentication login error:', err.message);
    return res.status(503).json({ errCode: -1, errMessage: 'Authentication service unavailable' });
  }
};
export const refresh = async (req, res) => {
  try {
    const result = await sessions.rotateSession(sessions.readRefreshCookie(req));
    if (!result) { sessions.clearRefreshCookie(res); return failed(res); }
    sessions.setRefreshCookie(res, result.refreshToken);
    res.set('Cache-Control', 'no-store');
    return res.json({ errCode: 0, token: result.token, user: result.user });
  } catch (err) {
    console.error('Authentication refresh error:', err.message);
    return res.status(503).json({ errCode: -1, errMessage: 'Authentication service unavailable' });
  }
};
export const logout = async (req, res) => {
  try {
    await sessions.revokeByRefresh(sessions.readRefreshCookie(req));
    if (req.auth?.sid) await sessions.revokeFamily(req.auth.sid);
    sessions.clearRefreshCookie(res);
    return res.status(204).end();
  } catch (err) {
    return res.status(503).json({ errCode: -1, errMessage: 'Logout unavailable' });
  }
};
export const logoutAll = async (req, res) => {
  try {
    await sessions.revokeAll(req.user.id);
    sessions.clearRefreshCookie(res);
    return res.status(204).end();
  } catch { return res.status(503).json({ errCode: -1, errMessage: 'Logout unavailable' }); }
};
export const ssoStart = async (req, res) => {
  try {
    const redirect = await oidc.begin(req.params.provider, res, req.user?.id || null);
    return req.method === 'POST' ? res.json({ errCode: 0, redirect }) : res.redirect(302, redirect);
  } catch (err) {
    console.error('SSO configuration/start error:', err.message);
    return res.status(503).json({ errCode: -1, errMessage: 'SSO chưa được cấu hình hoặc tạm thời không khả dụng' });
  }
};
export const ssoCallback = async (req, res) => {
  const frontend = allowedOrigins()[0];
  try {
    const result = await oidc.complete(req.params.provider, req, res);
    const issued = await sessions.createSession(result.userId, result.method);
    sessions.setRefreshCookie(res, issued.refreshToken);
    res.set('Cache-Control', 'no-store');
    return res.redirect(303, `${frontend}/login?sso=success`);
  } catch (err) {
    console.error('SSO callback rejected:', err.message);
    const reason = err.message === 'OIDC_NOT_LINKED' ? 'not-linked' : 'failed';
    return res.redirect(303, `${frontend}/login?sso=${reason}`);
  }
};
