import crypto from 'crypto';
import db from '../models/index';
import { hashOpaque } from './authSessionService';
import { createRegisteredAccount } from './userService';
import { normalizeEmail, isValidRecipientEmail } from '../utils/accountValidation';
import { recordSecurityEvent } from './authAuditService';

const COOKIE = 'jobfind_signup';
const TTL = 10 * 60 * 1000;
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/sso' });
export const clearSignupCookie = res => res.clearCookie(COOKIE, cookieOptions());
const signupHash = req => {
  const part = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  const raw = part?.slice(COOKIE.length + 1);
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{64}$/.test(raw) ? hashOpaque(raw) : null;
};
const signupExpired = () => Object.assign(new Error('Yêu cầu đăng ký đã hết hạn. Vui lòng xác thực lại tài khoản liên kết.'), { status: 410 });
export const prepareSignup = async (provider, claims, rememberMe, res) => {
  const email = normalizeEmail(claims.email);
  if (claims.email_verified !== true || !isValidRecipientEmail(email)) throw new Error('OIDC_EMAIL_UNVERIFIED');
  // A verified external email is sufficient to prefill a NEW account, never to merge an existing one.
  const existing = await db.User.findOne({ where: db.Sequelize.where(db.Sequelize.fn('LOWER', db.Sequelize.fn('TRIM', db.Sequelize.col('email'))), email), attributes: ['id'] });
  if (existing) throw new Error('OIDC_ACCOUNT_EXISTS');
  const parts = typeof claims.name === 'string' ? claims.name.trim().split(/\s+/) : [];
  const firstName = (typeof claims.given_name === 'string' ? claims.given_name : parts.shift() || '').trim().slice(0, 100);
  const lastName = (typeof claims.family_name === 'string' ? claims.family_name : parts.join(' ')).trim().slice(0, 100);
  const raw = crypto.randomBytes(48).toString('base64url');
  await db.AuthSignupRequest.destroy({ where: { expiresAt: { [db.Sequelize.Op.lt]: new Date() } } });
  await db.AuthSignupRequest.create({ tokenHash: hashOpaque(raw), provider, issuer: claims.iss, subject: claims.sub,
    email, firstName, lastName, rememberMe, expiresAt: new Date(Date.now() + TTL) });
  res.cookie(COOKIE, raw, { ...cookieOptions(), maxAge: TTL });
  return { pendingSignup: true };
};
export const signupProfile = async req => {
  const hash = signupHash(req);
  const pending = hash && await db.AuthSignupRequest.findByPk(hash, { raw: false });
  if (!pending || pending.expiresAt <= new Date()) throw signupExpired();
  return { profile: { provider: pending.provider, email: pending.email, firstName: pending.firstName || '', lastName: pending.lastName || '' }, rememberMe: pending.rememberMe };
};
export const completeSignup = async req => {
  const hash = signupHash(req);
  if (!hash) throw signupExpired();
  return db.sequelize.transaction(async transaction => {
    const pending = await db.AuthSignupRequest.findByPk(hash, { raw: false, transaction, lock: transaction.LOCK.UPDATE });
    if (!pending || pending.expiresAt <= new Date()) throw signupExpired();
    const identity = await db.AuthIdentity.findOne({ where: { issuer: pending.issuer, subject: pending.subject }, transaction });
    if (identity) throw Object.assign(new Error('Tài khoản liên kết đã được sử dụng. Vui lòng đăng nhập.'), { status: 409 });
    const data = req.body || {};
    // Only these user-editable fields are accepted. Provider identity/email and persistence come from the server-side transaction.
    const user = await createRegisteredAccount({ firstName: data.firstName, lastName: data.lastName,
      phonenumber: data.phonenumber, password: data.password, roleCode: data.roleCode,
      email: pending.email }, { transaction });
    const linked = await db.AuthIdentity.create({ userId: user.id, provider: pending.provider,
      issuer: pending.issuer, subject: pending.subject, emailAtLink: pending.email, emailVerifiedAtLink: true,
      displayNameAtLink: `${user.firstName} ${user.lastName}`.trim().slice(0, 120), lastLoginAt: new Date() }, { transaction });
    await pending.destroy({ transaction });
    await recordSecurityEvent({ event: 'identity_linked', userId: user.id }, transaction);
    return { userId: user.id, identityId: linked.id, method: `oidc:${pending.provider}`, rememberMe: pending.rememberMe };
  });
};
