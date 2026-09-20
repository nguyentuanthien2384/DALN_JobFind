import userService from '../services/userService';
import * as sessions from '../services/authSessionService';
import * as oidc from '../services/oidcService';
import db from '../models/index';
import bcrypt from 'bcryptjs';
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
    const issued = await sessions.createSession(result.user.id, 'password', { password: req.body.password });
    sessions.setRefreshCookie(res, issued.refreshToken);
    res.set('Cache-Control', 'no-store');
    return res.json({ errCode: 0, user: issued.user, token: issued.token });
  } catch (err) {
    console.error('Authentication login unavailable');
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
    console.error('Authentication refresh unavailable');
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
    if (req.user && !await confirmPassword(req)) return res.status(403).json({ errCode: 403, errMessage: 'Mật khẩu hiện tại không chính xác' });
    const redirect = await oidc.begin(req.params.provider, res, req.user?.id || null, req.auth?.sid);
    return req.method === 'POST' ? res.json({ errCode: 0, redirect }) : res.redirect(302, redirect);
  } catch (err) {
    console.error('SSO configuration/start unavailable');
    return res.status(503).json({ errCode: -1, errMessage: 'SSO chưa được cấu hình hoặc tạm thời không khả dụng' });
  }
};
export const ssoCallback = async (req, res) => {
  const origins = allowedOrigins();
  const frontend = origins.includes(process.env.AUTH_FRONTEND_ORIGIN) ? process.env.AUTH_FRONTEND_ORIGIN : origins[0];
  try {
    const result = await oidc.complete(req.params.provider, req, res);
    if (result.linked) return res.redirect(303, `${frontend}/account/security?sso=linked`);
    const issued = await sessions.createSession(result.userId, result.method, { identityId: result.identityId });
    sessions.setRefreshCookie(res, issued.refreshToken);
    res.set('Cache-Control', 'no-store');
    return res.redirect(303, `${frontend}/login?sso=success`);
  } catch (err) {
    console.error('SSO callback rejected');
    const reason = err.message === 'OIDC_NOT_LINKED' ? 'not-linked' : 'failed';
    return res.redirect(303, `${frontend}/login?sso=${reason}`);
  }
};

const confirmPassword = async (req) => {
  if (typeof req.body?.password !== 'string' || req.body.password.length > 256) return false;
  const account = await db.Account.findOne({ where: { userId: req.user.id, statusCode: 'S1' } });
  return Boolean(account && await bcrypt.compare(req.body.password, account.password));
};
export const providers = (_req, res) => res.json({ errCode: 0, google: oidc.googleAvailable() });
export const securityOverview = async (req, res) => {
  try {
    const [active, identities] = await Promise.all([
      db.AuthSession.findAll({ raw: false, where: { userId: req.user.id, revokedAt: null, rotatedAt: null,
        expiresAt: { [db.Sequelize.Op.gt]: new Date() } }, attributes: ['familyId', 'method', 'createdAt', 'expiresAt'], order: [['createdAt', 'DESC']] }),
      db.AuthIdentity.findAll({ where: { userId: req.user.id }, attributes: ['id', 'provider', 'emailAtLink', 'createdAt', 'lastLoginAt'] }),
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json({ errCode: 0, sessions: active.map(row => ({ ...row.toJSON(), current: row.familyId === req.auth.sid })), identities, google: oidc.googleAvailable() });
  } catch { return res.status(503).json({ errCode: 503, errMessage: 'Không tải được thông tin bảo mật' }); }
};
export const revokeSession = async (req, res) => {
  try {
    const own = await db.AuthSession.findOne({ where: { familyId: req.params.familyId, userId: req.user.id }, attributes: ['familyId'] });
    if (!own) return res.status(404).json({ errCode: 404, errMessage: 'Không tìm thấy phiên' });
    await sessions.revokeFamily(own.familyId);
    if (own.familyId === req.auth.sid) sessions.clearRefreshCookie(res);
    return res.json({ errCode: 0 });
  } catch { return res.status(503).json({ errCode: 503, errMessage: 'Không thu hồi được phiên' }); }
};
export const unlinkIdentity = async (req, res) => {
  try {
    if (!await confirmPassword(req)) return res.status(403).json({ errCode: 403, errMessage: 'Mật khẩu hiện tại không chính xác' });
    await db.sequelize.transaction(async transaction => {
      await sessions.lockAccount(req.user.id, transaction);
      await db.AuthIdentity.destroy({ where: { id: req.params.identityId, userId: req.user.id }, transaction });
      await sessions.revokeAll(req.user.id, transaction);
    });
    sessions.clearRefreshCookie(res);
    return res.json({ errCode: 0 });
  } catch { return res.status(503).json({ errCode: 503, errMessage: 'Không hủy được liên kết' }); }
};
