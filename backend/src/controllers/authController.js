import userService from '../services/userService';
import * as sessions from '../services/authSessionService';
import * as oidc from '../services/oidcService';
import db from '../models/index';
import bcrypt from 'bcryptjs';
import { deviceLabel, recordSecurityEvent, recentSecurityEvents } from '../services/authAuditService';
import * as socialRegistration from '../services/socialRegistrationService';
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
    if (result.errCode !== 0) {
      await recordSecurityEvent({ event: 'login_failed', device: deviceLabel(req) });
      return res.status(401).json({ errCode: result.errCode, errMessage: result.errMessage });
    }
    const issued = await sessions.createSession(result.user.id, 'password', { password: req.body.password, deviceLabel: deviceLabel(req), rememberMe: req.body.rememberMe === true });
    sessions.setRefreshCookie(res, issued.refreshToken, issued.expiresAt, issued.rememberMe);
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
    sessions.setRefreshCookie(res, result.refreshToken, result.expiresAt, result.rememberMe);
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
    const rememberMe = req.method === 'POST' ? req.body?.rememberMe === true : req.query?.rememberMe === 'true';
    const redirect = await oidc.begin(req.params.provider, res, req.user?.id || null, req.auth?.sid, rememberMe);
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
    if (result.pendingSignup) return res.redirect(303, `${frontend}/register?sso=complete`);
    const issued = await sessions.createSession(result.userId, result.method, { identityId: result.identityId, deviceLabel: deviceLabel(req), rememberMe: result.rememberMe });
    sessions.setRefreshCookie(res, issued.refreshToken, issued.expiresAt, issued.rememberMe);
    res.set('Cache-Control', 'no-store');
    return res.redirect(303, `${frontend}/login?sso=success`);
  } catch (err) {
    console.error('SSO callback rejected');
    try { await recordSecurityEvent({ event: 'sso_rejected', device: deviceLabel(req) }); }
    catch { console.error('SSO rejection audit unavailable'); }
    const reason = err.message === 'OIDC_ACCOUNT_EXISTS' ? 'account-exists' : err.message === 'OIDC_EMAIL_UNVERIFIED' ? 'email-unverified'
      : err.message === 'OIDC_NOT_LINKED' ? 'not-linked' : err.message === 'OIDC_CANCELLED' ? 'cancelled' : 'failed';
    return res.redirect(303, `${frontend}/login?sso=${reason}`);
  }
};

const confirmPassword = async (req) => {
  if (typeof req.body?.password !== 'string' || req.body.password.length > 256) return false;
  const account = await db.Account.findOne({ where: { userId: req.user.id, statusCode: 'S1' } });
  return Boolean(account && await bcrypt.compare(req.body.password, account.password));
};
export const providers = (_req, res) => res.json({ errCode: 0, ...oidc.availableProviders() });
export const signupProfile = async (req, res) => {
  try { return res.json({ errCode: 0, ...await socialRegistration.signupProfile(req) }); }
  catch (err) { return res.status(err.status || 503).json({ errCode: err.status || 503, errMessage: err.status ? err.message : 'Không tải được thông tin đăng ký.' }); }
};
export const completeSocialSignup = async (req, res) => {
  let created = false;
  try {
    const result = await socialRegistration.completeSignup(req);
    created = true;
    socialRegistration.clearSignupCookie(res);
    const issued = await sessions.createSession(result.userId, result.method, { identityId: result.identityId, deviceLabel: deviceLabel(req), rememberMe: result.rememberMe });
    sessions.setRefreshCookie(res, issued.refreshToken, issued.expiresAt, issued.rememberMe);
    return res.json({ errCode: 0, token: issued.token, user: issued.user });
  } catch (err) {
    const status = err.status || (err.fieldErrors ? (err.errCode === 1 || err.errCode === 4 ? 409 : 400) : 503);
    return res.status(status).json({ errCode: status, fieldErrors: err.fieldErrors,
      accountCreated: created,
      errMessage: created ? 'Tài khoản đã được tạo. Vui lòng đăng nhập bằng email hoặc số điện thoại và mật khẩu vừa đăng ký.'
        : err.fieldErrors || err.status ? err.message : 'Chưa hoàn tất đăng ký. Vui lòng thử lại.' });
  }
};
export const securityOverview = async (req, res) => {
  try {
    const [active, identities, history] = await Promise.all([
      db.AuthSession.findAll({ raw: false, where: { userId: req.user.id, revokedAt: null, rotatedAt: null,
        expiresAt: { [db.Sequelize.Op.gt]: new Date() } }, attributes: ['familyId', 'method', 'createdAt', 'expiresAt', 'deviceLabel', 'startedAt', 'lastUsedAt', 'rememberMe'], order: [['createdAt', 'DESC']] }),
      db.AuthIdentity.findAll({ where: { userId: req.user.id }, attributes: ['id', 'provider', 'emailAtLink', 'createdAt', 'lastLoginAt'] }),
      recentSecurityEvents(req.user.id),
    ]);
    res.set('Cache-Control', 'no-store');
    return res.json({ errCode: 0, sessions: active.map(row => ({ ...row.toJSON(), current: row.familyId === req.auth.sid })), identities, ...history, ...oidc.availableProviders() });
  } catch { return res.status(503).json({ errCode: 503, errMessage: 'Không tải được thông tin bảo mật' }); }
};
export const securityEvents = async (req, res) => {
  try {
    const history = await recentSecurityEvents(req.user.id, req.query.before);
    res.set('Cache-Control', 'no-store');
    return res.json({ errCode: 0, ...history });
  } catch (err) {
    const status = err.message === 'INVALID_CURSOR' ? 400 : 503;
    return res.status(status).json({ errCode: status, errMessage: 'Không tải được lịch sử bảo mật' });
  }
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
      const account = await sessions.lockAccount(req.user.id, transaction);
      // Recheck under the same lock as password changes and session revocation.
      if (!account || account.statusCode !== 'S1' || !await bcrypt.compare(req.body.password, account.password)
        || !await sessions.activeFamily(req.auth.sid, req.user.id, transaction)) throw new Error('REAUTH_REQUIRED');
      const count = await db.AuthIdentity.destroy({ where: { id: req.params.identityId, userId: req.user.id }, transaction });
      if (!count) throw new Error('IDENTITY_NOT_FOUND');
      await sessions.revokeAll(req.user.id, transaction);
      await recordSecurityEvent({ event: 'identity_unlinked', userId: req.user.id, device: deviceLabel(req) }, transaction);
    });
    sessions.clearRefreshCookie(res);
    return res.json({ errCode: 0 });
  } catch (err) {
    const status = err.message === 'IDENTITY_NOT_FOUND' ? 404 : err.message === 'REAUTH_REQUIRED' ? 403 : 503;
    return res.status(status).json({ errCode: status, errMessage: 'Không hủy được liên kết. Hãy kiểm tra tài khoản và đăng nhập lại nếu cần.' });
  }
};
