// Real HTTP discovery, authorization, token and JWKS endpoints with RSA-signed
// ID tokens. Only transport is redirected locally; openid-client validates the
// actual protocol, claims and signatures. No production issuer override exists.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

module.exports = async ({ db, app, base, user, headers, password }) => {
  const controller = require('../../src/controllers/authController');
  const middleware = require('../../src/middlewares/jwtVerify');
  const sessions = require('../../src/services/authSessionService');
  const { authorize, PERMISSIONS } = require('../../src/middlewares/authorize');
  const library = require('openid-client');
  const modulePath = require.resolve('openid-client');
  const originalLibrary = require.cache[modulePath].exports;
  const originalEnv = { ...process.env };
  const issuer = 'https://accounts.google.com';
  const clientId = 'disposable-oidc-client';
  const clientSecret = crypto.randomBytes(24).toString('hex');
  const callback = base + '/api/auth/sso/google/callback';
  const good = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rogue = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  let mode = 'valid', subject = 'http-oidc-subject', tokenRequests = 0, jwksRequests = 0;
  const provider = express();
  provider.use(express.urlencoded({ extended: false }));
  provider.get('/.well-known/openid-configuration', (_req, res) => res.json({
    issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks',
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post'], code_challenge_methods_supported: ['S256'],
  }));
  provider.get('/jwks', (_req, res) => { jwksRequests++; res.json({ keys: [jwk] }); });
  provider.get('/authorize', (req, res) => {
    if (req.query.client_id !== clientId || req.query.redirect_uri !== callback || req.query.response_type !== 'code'
      || req.query.code_challenge_method !== 'S256' || !req.query.code_challenge || !req.query.nonce || !req.query.state) {
      return res.status(400).json({ error: 'invalid_request' });
    }
    const next = new URL(callback); next.searchParams.set('state', req.query.state);
    if (mode === 'cancelled') next.searchParams.set('error', 'access_denied');
    else {
      const code = crypto.randomBytes(24).toString('base64url');
      codes.set(code, { challenge: req.query.code_challenge, nonce: req.query.nonce, mode, subject });
      next.searchParams.set('code', code);
    }
    res.redirect(302, next.href);
  });
  provider.post('/token', (req, res) => {
    tokenRequests++;
    const record = codes.get(req.body.code); codes.delete(req.body.code);
    if (!record || req.body.client_id !== clientId || req.body.client_secret !== clientSecret
      || req.body.redirect_uri !== callback || req.body.grant_type !== 'authorization_code'
      || crypto.createHash('sha256').update(req.body.code_verifier || '').digest('base64url') !== record.challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: issuer, aud: clientId, sub: record.subject, iat: now, exp: now + 300, nonce: record.nonce,
      email: user.email, email_verified: true, name: 'OIDC Test', role: 'ADMIN', groups: ['ADMIN'] };
    if (record.mode === 'nonce') claims.nonce = 'wrong-nonce';
    if (record.mode === 'issuer') claims.iss = 'https://evil.invalid';
    if (record.mode === 'audience') claims.aud = 'another-client';
    if (record.mode === 'expired') claims.exp = now - 120;
    if (record.mode === 'missing-expiry') delete claims.exp;
    if (record.mode === 'unverified') claims.email_verified = false;
    const idToken = jwt.sign(claims, record.mode === 'signature' ? rogue.privateKey : good.privateKey,
      { algorithm: 'RS256', keyid: record.mode === 'unknown-key' ? 'unknown-key' : 'fixture-key' });
    return res.json({ access_token: 'disposable-provider-token', token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });
  const server = await new Promise(resolve => { const s = provider.listen(0, '127.0.0.1', () => resolve(s)); });
  const providerBase = 'http://127.0.0.1:' + server.address().port;
  const transport = (url, options) => {
    const address = new URL(url);
    assert.equal(address.origin, issuer, 'All IdP traffic must remain in this local fixture');
    return fetch(providerBase + address.pathname + address.search, options);
  };
  require.cache[modulePath].exports = { ...library,
    discovery: (url, id, secret) => library.discovery(url, id, secret, undefined, { [library.customFetch]: transport }),
  };
  Object.assign(process.env, { OIDC_GOOGLE_ENABLED: 'true', OIDC_GOOGLE_ISSUER: issuer,
    OIDC_GOOGLE_CLIENT_ID: clientId, OIDC_GOOGLE_CLIENT_SECRET: clientSecret, OIDC_GOOGLE_REDIRECT_URI: callback,
    AUTH_FRONTEND_ORIGIN: base, URL_REACT: base });
  const localHeaders = { ...headers, Origin: base };
  app.get('/api/auth/sso/:provider/start', controller.ssoStart);
  app.get('/api/auth/sso/:provider/callback', controller.ssoCallback);
  app.post('/api/auth/sso/:provider/link/start', controller.cookieOrigin, middleware.verifyTokenUser, controller.ssoStart);
  app.post('/api/auth/identities/:identityId/unlink', controller.cookieOrigin, middleware.verifyTokenUser, controller.unlinkIdentity);
  app.get('/api/auth/security/events', middleware.verifyTokenUser, controller.securityEvents);
  app.get('/fixture/jobs', middleware.verifyTokenUser, authorize(PERMISSIONS.JOB_MANAGE), (_req, res) => res.json({ allowed: true }));
  app.get('/fixture/admin', middleware.verifyTokenUser, authorize(PERMISSIONS.ADMINISTRATION), (_req, res) => res.json({ allowed: true }));
  const cookie = response => response.headers.getSetCookie().find(c => c.startsWith('jobfind_rt='))?.split(';')[0];
  const begin = async (link) => {
    const response = link ? await fetch(base + '/api/auth/sso/google/link/start', { method: 'POST',
      headers: { ...localHeaders, Authorization: 'Bearer ' + link.token, Cookie: 'jobfind_rt=' + link.refreshToken }, body: JSON.stringify({ password }), redirect: 'manual' })
      : await fetch(base + '/api/auth/sso/google/start?returnTo=https://evil.invalid', { redirect: 'manual' });
    assert.equal(response.status, link ? 200 : 302);
    const url = link ? (await response.json()).redirect : response.headers.get('location');
    const txCookie = response.headers.getSetCookie().find(c => c.startsWith('jobfind_oidc_tx='))?.split(';')[0];
    const consent = await transport(url, { redirect: 'manual' });
    assert.equal(consent.status, 302);
    return { callbackUrl: consent.headers.get('location'), txCookie: txCookie + (link ? '; jobfind_rt=' + link.refreshToken : '') };
  };
  const complete = flow => fetch(flow.callbackUrl, { headers: { Cookie: flow.txCookie }, redirect: 'manual' });
  const refresh = rawCookie => fetch(base + '/api/auth/refresh', { method: 'POST', headers: { ...localHeaders, Cookie: rawCookie }, body: '{}' });
  const access = token => ({ Authorization: 'Bearer ' + token });
  try {
    // Existing local email never auto-merges or auto-provisions, verified or not.
    for (const variant of ['valid', 'unverified']) {
      mode = variant;
      const rejected = await complete(await begin());
      assert.equal(rejected.headers.get('location'), base + '/login?sso=not-linked');
      assert.equal(cookie(rejected), undefined);
      assert.equal(await db.AuthIdentity.count({ where: { issuer, subject } }), 0);
    }
    mode = 'valid';
    const localSession = await sessions.createSession(user.id);
    const linked = await complete(await begin(localSession));
    assert.equal(linked.headers.get('location'), base + '/account/security?sso=linked');
    assert.equal(cookie(linked), undefined);
    const identity = await db.AuthIdentity.findOne({ where: { issuer, subject }, raw: true });
    assert.equal(identity.userId, user.id); assert.equal(identity.emailVerifiedAtLink, 1);
    assert.equal(identity.displayNameAtLink, 'OIDC Test');
    const validFlow = await begin();
    const accepted = await complete(validFlow);
    assert.equal(accepted.headers.get('location'), base + '/login?sso=success');
    assert.ok(cookie(accepted)); assert.ok(jwksRequests > 0, 'Signature validation must fetch real JWKS');
    assert.equal(accepted.headers.get('location').includes('token='), false);
    const refreshed = await refresh(cookie(accepted)); assert.equal(refreshed.status, 200);
    const payload = await refreshed.json();
    assert.equal(payload.user.roleCode, 'CANDIDATE');
    assert.equal((await fetch(base + '/fixture/admin', { headers: access(payload.token) })).status, 403);
    assert.equal((await complete(validFlow)).headers.get('location'), base + '/login?sso=failed');
    const replayCode = await transport(issuer + '/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: new URL(validFlow.callbackUrl).searchParams.get('code') }) });
    assert.equal(replayCode.status, 400);
    // Negative cryptographic tests use actual malformed/signed ID tokens.
    for (const variant of ['nonce', 'issuer', 'audience', 'expired', 'missing-expiry', 'signature', 'unknown-key']) {
      mode = variant;
      const rejected = await complete(await begin());
      assert.equal(rejected.headers.get('location'), base + '/login?sso=failed', variant);
      assert.equal(cookie(rejected), undefined, variant + ' must not issue refresh');
    }
    mode = 'valid';
    const badState = await begin(); const address = new URL(badState.callbackUrl);
    const requestsBefore = tokenRequests;
    address.searchParams.set('state', 'nonexistent');
    assert.equal((await complete({ ...badState, callbackUrl: address.href })).headers.get('location'), base + '/login?sso=failed');
    assert.equal(tokenRequests, requestsBefore);
    assert.equal((await complete({ ...badState, txCookie: 'jobfind_oidc_tx=' + 'x'.repeat(43) })).headers.get('location'), base + '/login?sso=failed');
    assert.equal(tokenRequests, requestsBefore);
    const pkceFlow = await begin();
    await db.OidcTransaction.update({ verifier: 'x'.repeat(43) }, { where: { stateHash: sessions.hashOpaque(new URL(pkceFlow.callbackUrl).searchParams.get('state')) } });
    assert.equal((await complete(pkceFlow)).headers.get('location'), base + '/login?sso=failed');
    mode = 'cancelled';
    assert.equal((await complete(await begin())).headers.get('location'), base + '/login?sso=cancelled');
    mode = 'valid';
    // The SAME SSO JWT observes all four current database roles and company state.
    const company = await db.Company.create({ statusCode: 'S1', censorCode: 'CS1' });
    await db.User.update({ companyId: company.id }, { where: { id: user.id } });
    for (const roleCode of ['CANDIDATE', 'EMPLOYER', 'COMPANY', 'ADMIN']) {
      await db.Account.update({ roleCode }, { where: { userId: user.id } });
      assert.equal((await fetch(base + '/api/auth/me', { headers: access(payload.token) })).status, 200);
      assert.equal((await fetch(base + '/fixture/admin', { headers: access(payload.token) })).status, roleCode === 'ADMIN' ? 200 : 403);
      assert.equal((await fetch(base + '/fixture/jobs', { headers: access(payload.token) })).status, ['EMPLOYER', 'COMPANY'].includes(roleCode) ? 200 : 403);
    }
    await db.Account.update({ roleCode: 'EMPLOYER' }, { where: { userId: user.id } });
    for (const status of [{ statusCode: 'S2', censorCode: 'CS1' }, { statusCode: 'S1', censorCode: 'CS2' }]) {
      await company.update(status);
      assert.equal((await fetch(base + '/fixture/jobs', { headers: access(payload.token) })).status, 403);
    }
    await db.Account.update({ statusCode: 'S2' }, { where: { userId: user.id } });
    assert.equal((await fetch(base + '/api/auth/me', { headers: access(payload.token) })).status, 403);
    assert.equal((await complete(await begin())).headers.get('location'), base + '/login?sso=failed');
    await db.Account.update({ statusCode: 'S1', roleCode: 'CANDIDATE' }, { where: { userId: user.id } });
    await db.User.update({ companyId: null }, { where: { id: user.id } });
    const overview = await (await fetch(base + '/api/auth/security', { headers: access(payload.token) })).json();
    assert.ok(overview.events.some(e => e.event === 'identity_linked'));
    assert.ok(overview.events.every(e => !('userId' in e) && !('tokenHash' in e)));
    const other = await db.User.create({ firstName: 'Other' });
    await db.AuthSecurityEvent.create({ userId: other.id, event: 'login_succeeded', deviceLabel: 'PRIVATE OTHER USER' });
    const history = await (await fetch(base + '/api/auth/security/events?userId=' + other.id, { headers: access(payload.token) })).json();
    assert.ok(history.events.every(e => e.deviceLabel !== 'PRIVATE OTHER USER'));
    assert.equal((await fetch(base + '/api/auth/security/events?before=invalid', { headers: access(payload.token) })).status, 400);
    // Unknown/foreign identity IDs cannot revoke the caller's sessions.
    const unlinkHeaders = { ...localHeaders, ...access(payload.token) };
    const missing = await fetch(base + '/api/auth/identities/999999/unlink', { method: 'POST', headers: unlinkHeaders, body: JSON.stringify({ password }) });
    assert.equal(missing.status, 404);
    assert.equal(await sessions.activeFamily(jwt.decode(payload.token).sid, user.id), true);
    const removed = await fetch(base + '/api/auth/identities/' + identity.id + '/unlink', { method: 'POST', headers: unlinkHeaders, body: JSON.stringify({ password }) });
    assert.equal(removed.status, 200);
    assert.equal(await sessions.activeFamily(jwt.decode(payload.token).sid, user.id), false);
    assert.equal((await refresh(cookie(refreshed))).status, 401);
    console.log('PASS: real HTTP OIDC/PKCE/JWKS/signatures, negative claims, one-use state/code, safe link/unlink, no email merge/role elevation/open redirect, live RBAC for four roles and company/account changes, private security history.');
  } finally {
    require.cache[modulePath].exports = originalLibrary;
    process.env = originalEnv;
    await new Promise(resolve => server.close(resolve));
  }
};
