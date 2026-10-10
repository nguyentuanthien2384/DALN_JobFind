import crypto from 'crypto';
import db from '../models/index';
import { hashOpaque, loadUser, activeFamily, readRefreshCookie, lockAccount } from './authSessionService';
import { recordSecurityEvent } from './authAuditService';
import { providerSettings, providerAvailable, availableProviders, loginRoute, identityProvider, githubAuthorizationUrl, githubClaims } from './socialProviders';
import { prepareSignup, clearSignupCookie, linkVerifiedEmail } from './socialRegistrationService';
// openid-client v6 verifies ID token signature, issuer, audience, expiry and nonce.
// Install on the backend only: npm install openid-client@^6
//
// ===== DANG NHAP MANG XA HOI: OAuth 2.0 / OpenID Connect (openid-client, Auth0) =====
// Nut Google/GitHub/Facebook deu di qua Auth0 (mot "identity broker"): JobFind chi tich
// hop MOT nha cung cap OIDC, Auth0 lo phan rieng cua tung mang xa hoi (tham so
// `connection` chon nut nao). Luong Authorization Code + PKCE:
// 1. begin(): sinh state, nonce, code_verifier (PKCE) va mot "browser binding" cookie;
//    luu ban bam vao OidcTransaction (het han 5 phut) roi chuyen nguoi dung sang Auth0.
// 2. Nguoi dung dang nhap o Auth0/Google... -> quay ve callback kem `code` + `state`.
// 3. complete(): kiem tra state khop VA cookie cung trinh duyet (chong CSRF dang nhap
//    gia), xoa giao dich ngay trong mot transaction (dung mot lan, chong replay), roi doi
//    `code` lay token kem code_verifier (PKCE: ke chan duoc `code` cung khong doi duoc).
// 4. openid-client kiem tra ID token: chu ky theo JWKS cua nha cung cap, issuer,
//    audience, han dung, nonce. Issuer va redirect_uri lay tu cau hinh, khong tu request.
// Lien ket tai khoan: tim theo (issuer, subject); chua co thi chi tu dong noi vao tai
// khoan san co khi email DA DUOC nha cung cap xac minh, nguoc lai chuyen sang dang ky
// (prepareSignup). Vai tro KHONG BAO GIO lay tu claim cua nha cung cap.
const OIDC_COOKIE = 'jobfind_oidc_tx';
const cookieOpts = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/sso', maxAge: 5 * 60 * 1000 });
export const googleAvailable = () => providerAvailable('google');
export { availableProviders };
// Identity discovery is pinned to operator-configured issuer; never take issuer or redirect from a request.
const clientFor = async (settings) => {
  const client = require('openid-client'); // v6 with Node >=22.12 (supports require(esm))
  const config = await client.discovery(new URL(settings.issuer), settings.id, settings.secret);
  if (config.serverMetadata().issuer !== settings.issuer) throw new Error('OIDC_ISSUER');
  // Require ID-token JWS verification against the provider's JWKS in addition
  // to the authenticated TLS token endpoint and standard claim validation.
  client.enableNonRepudiationChecks(config);
  return { client, config };
};
export const begin = async (method, res, linkUserId = null, linkSessionId = null, rememberMe = false) => {
  if (linkUserId && !await activeFamily(linkSessionId, linkUserId)) throw new Error('OIDC_LINK_DENIED');
  const { provider: name, connection } = loginRoute(method);
  const settings = providerSettings(name);
  const { client, config } = name === 'github' ? {} : await clientFor(settings);
  const random = () => crypto.randomBytes(32).toString('base64url');
  const state = client ? client.randomState() : random();
  const nonce = client ? client.randomNonce() : random();
  const verifier = client ? client.randomPKCECodeVerifier() : random();
  const browser = crypto.randomBytes(32).toString('base64url');
  await db.OidcTransaction.destroy({ where: { expiresAt: { [db.Sequelize.Op.lt]: new Date() } } });
  await db.OidcTransaction.create({
    stateHash: hashOpaque(state), browserHash: hashOpaque(browser), provider: name,
    nonce, verifier, linkUserId, linkSessionId, rememberMe, expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  clearSignupCookie(res);
  res.cookie(OIDC_COOKIE, browser, cookieOpts());
  if (name === 'github') return githubAuthorizationUrl(settings, state, verifier);
  return client.buildAuthorizationUrl(config, {
    redirect_uri: settings.redirect, response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256', ...(connection ? { connection } : {}),
  }).href;
};
const parseCookie = (req) => {
  const entry = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${OIDC_COOKIE}=`));
  if (!entry) return null;
  try { return decodeURIComponent(entry.slice(OIDC_COOKIE.length + 1)); } catch { return null; }
};
export const complete = async (name, req, res) => {
  const { maxAge: ignoredMaxAge, ...clearOpts } = cookieOpts();
  res.clearCookie(OIDC_COOKIE, clearOpts);
  const state = req.query.state;
  const browser = parseCookie(req);
  if (typeof state !== 'string' || state.length > 256 || !browser || !/^[A-Za-z0-9_-]{32,100}$/.test(browser)) throw new Error('OIDC_STATE');
  // Atomic, one-time consumption prevents replay even with multiple backend replicas.
  const tx = await db.sequelize.transaction(async transaction => {
    const stored = await db.OidcTransaction.findByPk(hashOpaque(state), { raw: false, transaction, lock: transaction.LOCK.UPDATE });
    if (!stored || stored.expiresAt <= new Date() || stored.provider !== name || stored.browserHash !== hashOpaque(browser)) return null;
    const data = stored.toJSON();
    await stored.destroy({ transaction });
    return data;
  });
  if (!tx) throw new Error('OIDC_STATE');
  if (req.query.error === 'access_denied') throw new Error('OIDC_CANCELLED');
  if (typeof req.query.code !== 'string' || req.query.code.length > 4096) throw new Error('OIDC_STATE');
  const settings = providerSettings(name);
  let claims;
  if (name === 'github') {
    claims = await githubClaims(settings, req.query.code, tx.verifier);
  } else {
  const { client, config } = await clientFor(settings);
  // Use the fixed registered callback URL, never X-Forwarded-Host or an arbitrary request URL.
  const callback = new URL(settings.redirect);
  callback.search = new URLSearchParams({ code: req.query.code, state,
    ...(typeof req.query.iss === 'string' ? { iss: req.query.iss } : {}),
  }).toString();
  const tokens = await client.authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: tx.verifier, expectedState: state, expectedNonce: tx.nonce, idTokenExpected: true,
  });
  claims = tokens.claims();
  if (!claims || claims.aud !== settings.id && !(Array.isArray(claims.aud) && claims.aud.includes(settings.id))) throw new Error('OIDC_ID_TOKEN');
  }
  if (!claims || claims.iss !== settings.issuer || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('OIDC_ID_TOKEN');
  const provider = identityProvider(name, claims.sub);
  // Only a provider-verified email links to an existing account, and never grant a role from IdP claims.
  let identity = await db.AuthIdentity.findOne({ raw: false, where: { issuer: claims.iss, subject: claims.sub } });
  if (tx.linkUserId) {
    identity = await db.sequelize.transaction(async transaction => {
    await lockAccount(tx.linkUserId, transaction);
    const cookie = readRefreshCookie(req);
    const currentSession = cookie && await db.AuthSession.findOne({ where: { tokenHash: hashOpaque(cookie), familyId: tx.linkSessionId, userId: tx.linkUserId, revokedAt: null, rotatedAt: null }, transaction });
    if (!currentSession || !await activeFamily(tx.linkSessionId, tx.linkUserId, transaction)) throw new Error('OIDC_LINK_DENIED');
    let linkedIdentity = await db.AuthIdentity.findOne({ raw: false, where: { issuer: claims.iss, subject: claims.sub }, transaction });
    const current = await loadUser(tx.linkUserId, transaction);
    if (!current || (linkedIdentity && linkedIdentity.userId !== current.id)) throw new Error('OIDC_LINK_DENIED');
    if (!linkedIdentity) {
    linkedIdentity = await db.AuthIdentity.create({
      userId: current.id, provider, issuer: claims.iss, subject: claims.sub,
      emailAtLink: claims.email_verified === true ? String(claims.email || '').slice(0, 254) : null,
      emailVerifiedAtLink: claims.email_verified === true,
      displayNameAtLink: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null,
    }, { transaction });
    await recordSecurityEvent({ event: 'identity_linked', userId: current.id }, transaction);
    }
    return linkedIdentity;
    });
  }
  if (!identity) identity = await linkVerifiedEmail(provider, claims);
  if (!identity) return prepareSignup(provider, claims, tx.rememberMe !== false, res);
  const user = await loadUser(identity.userId);
  if (!user) throw new Error('INACTIVE_ACCOUNT');
  await identity.update({ lastLoginAt: new Date() });
  return { userId: user.id, method: `oidc:${provider}`, identityId: identity.id, linked: Boolean(tx.linkUserId), rememberMe: tx.rememberMe !== false };
};
