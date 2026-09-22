import crypto from 'crypto';
import db from '../models/index';
import { hashOpaque, loadUser, activeFamily, readRefreshCookie, lockAccount } from './authSessionService';
import { recordSecurityEvent } from './authAuditService';
import { providerSettings, providerAvailable, availableProviders, githubAuthorizationUrl, githubClaims } from './socialProviders';
import { prepareSignup, clearSignupCookie } from './socialRegistrationService';
// openid-client v6 verifies ID token signature, issuer, audience, expiry and nonce.
// Install on the backend only: npm install openid-client@^6
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
export const begin = async (name, res, linkUserId = null, linkSessionId = null, rememberMe = false) => {
  if (linkUserId && !await activeFamily(linkSessionId, linkUserId)) throw new Error('OIDC_LINK_DENIED');
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
    code_challenge_method: 'S256',
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
  // Never trust email alone to merge accounts, and never grant a role from IdP claims.
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
      userId: current.id, provider: name, issuer: claims.iss, subject: claims.sub,
      emailAtLink: claims.email_verified === true ? String(claims.email || '').slice(0, 254) : null,
      emailVerifiedAtLink: claims.email_verified === true,
      displayNameAtLink: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null,
    }, { transaction });
    await recordSecurityEvent({ event: 'identity_linked', userId: current.id }, transaction);
    }
    return linkedIdentity;
    });
  }
  if (!identity) return prepareSignup(name, claims, tx.rememberMe !== false, res);
  const user = await loadUser(identity.userId);
  if (!user) throw new Error('INACTIVE_ACCOUNT');
  await identity.update({ lastLoginAt: new Date() });
  return { userId: user.id, method: `oidc:${name}`, identityId: identity.id, linked: Boolean(tx.linkUserId), rememberMe: tx.rememberMe !== false };
};
