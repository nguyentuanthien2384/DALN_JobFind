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
const emailMatch = email => db.Sequelize.where(db.Sequelize.fn('LOWER', db.Sequelize.fn('TRIM', db.Sequelize.col('email'))), email);
const providerEmail = claims => {
  const email = normalizeEmail(claims.email);
  return isValidRecipientEmail(email) ? email : null;
};
// Social strategies whose email_verified claim comes from the upstream provider (not Auth0 database users).
const EMAIL_LINK_PROVIDERS = ['google', 'github', 'auth0:google', 'auth0:github', 'auth0:facebook'];
// A provider-verified email signs in to the JobFind account that already owns it, linking the identity once.
export const linkVerifiedEmail = async (provider, claims) => {
  const email = providerEmail(claims);
  if (!email || claims.email_verified !== true || !EMAIL_LINK_PROVIDERS.includes(provider)) return null;
  return db.sequelize.transaction(async transaction => {
    const users = await db.User.findAll({ where: emailMatch(email), attributes: ['id'], limit: 2, transaction });
    if (!users.length) return null;
    // Legacy duplicate emails are ambiguous; those owners link from their security settings instead.
    if (users.length > 1) throw new Error('OIDC_ACCOUNT_EXISTS');
    const [user] = users;
    const existing = await db.AuthIdentity.findOne({ raw: false, where: { issuer: claims.iss, subject: claims.sub }, transaction });
    if (existing) return existing;
    const identity = await db.AuthIdentity.create({ userId: user.id, provider, issuer: claims.iss, subject: claims.sub,
      emailAtLink: email, emailVerifiedAtLink: true,
      displayNameAtLink: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null }, { transaction });
    await recordSecurityEvent({ event: 'identity_linked', userId: user.id }, transaction);
    return identity;
  });
};
export const prepareSignup = async (provider, claims, rememberMe, res) => {
  // Without a provider-verified email the user types their own email on the form, as in normal registration.
  const email = providerEmail(claims);
  const verified = Boolean(email) && claims.email_verified === true;
  const parts = typeof claims.name === 'string' ? claims.name.trim().split(/\s+/) : [];
  const firstName = (typeof claims.given_name === 'string' ? claims.given_name : parts.shift() || '').trim().slice(0, 100);
  const lastName = (typeof claims.family_name === 'string' ? claims.family_name : parts.join(' ')).trim().slice(0, 100);
  const raw = crypto.randomBytes(48).toString('base64url');
  await db.AuthSignupRequest.destroy({ where: { expiresAt: { [db.Sequelize.Op.lt]: new Date() } } });
  await db.AuthSignupRequest.create({ tokenHash: hashOpaque(raw), provider, issuer: claims.iss, subject: claims.sub,
    email, emailVerified: verified, firstName, lastName, rememberMe, expiresAt: new Date(Date.now() + TTL) });
  res.cookie(COOKIE, raw, { ...cookieOptions(), maxAge: TTL });
  return { pendingSignup: true };
};
export const signupProfile = async req => {
  const hash = signupHash(req);
  const pending = hash && await db.AuthSignupRequest.findByPk(hash, { raw: false });
  if (!pending || pending.expiresAt <= new Date()) throw signupExpired();
  return { profile: { provider: pending.provider, email: pending.email || '', emailVerified: pending.emailVerified === true,
    firstName: pending.firstName || '', lastName: pending.lastName || '' }, rememberMe: pending.rememberMe };
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
    // Only these user-editable fields are accepted. Provider identity and persistence come from the server-side transaction;
    // a provider-verified email is fixed, otherwise the typed email is validated like normal registration.
    const verified = pending.emailVerified === true;
    const user = await createRegisteredAccount({ firstName: data.firstName, lastName: data.lastName,
      phonenumber: data.phonenumber, password: data.password, roleCode: data.roleCode,
      email: verified ? pending.email : data.email }, { transaction });
    const linked = await db.AuthIdentity.create({ userId: user.id, provider: pending.provider,
      issuer: pending.issuer, subject: pending.subject, emailAtLink: verified ? pending.email : null, emailVerifiedAtLink: verified,
      displayNameAtLink: `${user.firstName} ${user.lastName}`.trim().slice(0, 120), lastLoginAt: new Date() }, { transaction });
    await pending.destroy({ transaction });
    await recordSecurityEvent({ event: 'identity_linked', userId: user.id }, transaction);
    return { userId: user.id, identityId: linked.id, method: `oidc:${pending.provider}`, rememberMe: pending.rememberMe };
  });
};
