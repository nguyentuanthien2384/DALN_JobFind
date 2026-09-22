// Exercise the real GitHub adapter and application HTTP routes against a local
// provider fixture. No requests are sent to GitHub or another external service.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

module.exports = async ({ db, base, user, headers, password }) => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const sessions = require('../../src/services/authSessionService');
  const clientId = 'disposable-github-client';
  const clientSecret = crypto.randomBytes(24).toString('base64url');
  const callback = base + '/api/auth/sso/github/callback';
  const privateEmail = 'jobfind.github.private.fixture@gmail.com';
  const codes = new Map(), tokens = new Map();
  const provider = express();
  let mode = 'valid', providerId = 73123456, username = 'original-username', tokenRequests = 0;
  provider.use(express.urlencoded({ extended: false }));
  provider.get('/login/oauth/authorize', (req, res) => {
    if (req.query.client_id !== clientId || req.query.redirect_uri !== callback
      || req.query.scope !== 'read:user user:email' || req.query.code_challenge_method !== 'S256'
      || !/^[A-Za-z0-9_-]{43}$/.test(req.query.code_challenge || '')
      || !/^[A-Za-z0-9_-]{32,100}$/.test(req.query.state || '')) return res.status(400).json({ error: 'invalid_request' });
    const address = new URL(callback);
    address.searchParams.set('state', req.query.state);
    if (mode === 'cancelled') address.searchParams.set('error', 'access_denied');
    else {
      const code = crypto.randomBytes(24).toString('base64url');
      codes.set(code, { mode, id: providerId, username, challenge: req.query.code_challenge });
      address.searchParams.set('code', code);
    }
    return res.redirect(302, address.href);
  });
  provider.post('/login/oauth/access_token', (req, res) => {
    tokenRequests += 1;
    const record = codes.get(req.body.code);
    codes.delete(req.body.code);
    if (!record || req.body.client_id !== clientId || req.body.client_secret !== clientSecret
      || req.body.redirect_uri !== callback
      || crypto.createHash('sha256').update(req.body.code_verifier || '').digest('base64url') !== record.challenge) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    if (record.mode === 'invalid-token') return res.json({ access_token: '', token_type: 'bearer' });
    const accessToken = crypto.randomBytes(24).toString('base64url');
    tokens.set(accessToken, record);
    return res.json({ access_token: accessToken, token_type: 'bearer', scope: 'read:user,user:email' });
  });
  const authenticateProvider = (req, res, next) => {
    const bearer = req.get('Authorization');
    const record = bearer?.startsWith('Bearer ') && tokens.get(bearer.slice(7));
    if (!record) return res.status(401).json({ message: 'Bad credentials' });
    if (req.get('X-GitHub-Api-Version') !== '2022-11-28' || req.get('User-Agent') !== 'JobFind') return res.status(400).json({ message: 'Missing API headers' });
    req.fixture = record;
    next();
  };
  provider.get('/user', authenticateProvider, (req, res) => res.json({
    id: req.fixture.mode === 'invalid-id' ? 'mutable-id' : req.fixture.id,
    login: req.fixture.username, name: 'GitHub Fixture', email: null, role: 'ADMIN',
  }));
  provider.get('/user/emails', authenticateProvider, (req, res) => {
    if (req.query.per_page !== '100') return res.status(400).json({ message: 'Email page must be bounded' });
    const email = req.fixture.mode === 'existing-email' ? user.email : privateEmail;
    return res.json([
      { email: 'unverified.public@gmail.com', verified: false, primary: true, visibility: 'public' },
      { email, verified: req.fixture.mode !== 'unverified', primary: true, visibility: null },
    ]);
  });
  const server = await new Promise(resolve => { const value = provider.listen(0, '127.0.0.1', () => resolve(value)); });
  const providerBase = 'http://127.0.0.1:' + server.address().port;
  const allowedPaths = new Map([
    ['https://github.com', new Set(['/login/oauth/authorize', '/login/oauth/access_token'])],
    ['https://api.github.com', new Set(['/user', '/user/emails'])],
  ]);
  global.fetch = (input, options) => {
    const address = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const paths = allowedPaths.get(address.origin);
    if (paths) {
      assert.ok(paths.has(address.pathname), 'The GitHub fixture rejects unexpected endpoint paths');
      return originalFetch(providerBase + address.pathname + address.search, options);
    }
    assert.equal(address.origin, new URL(base).origin, 'The GitHub acceptance test may only contact the local application');
    return originalFetch(input, options);
  };
  Object.assign(process.env, {
    OAUTH_GITHUB_ENABLED: 'true', OAUTH_GITHUB_CLIENT_ID: clientId, OAUTH_GITHUB_CLIENT_SECRET: clientSecret,
    OAUTH_GITHUB_REDIRECT_URI: callback, AUTH_FRONTEND_ORIGIN: base, URL_REACT: base,
  });
  const localHeaders = { ...headers, Origin: base };
  const findCookie = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(name + '='));
  const cookiePair = (response, name) => findCookie(response, name)?.split(';')[0];
  const begin = async (rememberMe = true) => {
    const started = await fetch(base + '/api/auth/sso/github/start?rememberMe=' + rememberMe, { redirect: 'manual' });
    assert.equal(started.status, 302);
    const authorizationUrl = new URL(started.headers.get('location'));
    assert.equal(authorizationUrl.origin + authorizationUrl.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(authorizationUrl.searchParams.get('redirect_uri'), callback);
    assert.equal(authorizationUrl.searchParams.get('client_secret'), null);
    const state = authorizationUrl.searchParams.get('state');
    const txCookie = cookiePair(started, 'jobfind_oidc_tx');
    assert.ok(txCookie);
    const stored = await db.OidcTransaction.findByPk(sessions.hashOpaque(state), { raw: true });
    assert.ok(stored);
    assert.equal(Boolean(stored.rememberMe), rememberMe);
    assert.equal(stored.browserHash, sessions.hashOpaque(txCookie.slice('jobfind_oidc_tx='.length)));
    assert.equal(authorizationUrl.searchParams.get('code_challenge'), crypto.createHash('sha256').update(stored.verifier).digest('base64url'));
    const consent = await fetch(authorizationUrl, { redirect: 'manual' });
    assert.equal(consent.status, 302);
    return { txCookie, state, callbackUrl: consent.headers.get('location') };
  };
  const complete = flow => fetch(flow.callbackUrl, { headers: { Cookie: flow.txCookie }, redirect: 'manual' });
  const countAccounts = () => db.User.count();
  try {
    const before = await countAccounts();
    // A guessed state or different browser must fail before the token exchange.
    const invalidState = await begin();
    const beforeRequests = tokenRequests;
    const changed = new URL(invalidState.callbackUrl); changed.searchParams.set('state', 'wrong-state');
    assert.equal((await complete({ ...invalidState, callbackUrl: changed.href })).headers.get('location'), base + '/login?sso=failed');
    assert.equal((await complete({ ...invalidState, txCookie: 'jobfind_oidc_tx=' + 'x'.repeat(43) })).headers.get('location'), base + '/login?sso=failed');
    assert.equal(tokenRequests, beforeRequests);
    assert.equal(await countAccounts(), before);
    const badPkce = await begin();
    await db.OidcTransaction.update({ verifier: 'x'.repeat(43) }, { where: { stateHash: sessions.hashOpaque(badPkce.state) } });
    assert.equal((await complete(badPkce)).headers.get('location'), base + '/login?sso=failed');
    // Provider failures and unverified emails never provision an account.
    for (const variant of ['cancelled', 'invalid-token', 'invalid-id', 'unverified', 'existing-email']) {
      mode = variant;
      const rejected = await complete(await begin());
      const reason = variant === 'cancelled' ? 'cancelled' : variant === 'unverified' ? 'email-unverified' : variant === 'existing-email' ? 'account-exists' : 'failed';
      assert.equal(rejected.headers.get('location'), base + '/login?sso=' + reason, variant);
      assert.equal(cookiePair(rejected, 'jobfind_rt'), undefined);
      assert.equal(cookiePair(rejected, 'jobfind_signup'), undefined);
      assert.equal(await countAccounts(), before);
      assert.equal(await db.AuthIdentity.count({ where: { issuer: 'https://github.com', subject: String(providerId) } }), 0);
    }
    mode = 'valid';
    const flow = await begin(true);
    const callbackAddress = new URL(flow.callbackUrl);
    callbackAddress.searchParams.set('rememberMe', 'false'); // Stored state wins over callback tampering.
    const onboarding = await complete({ ...flow, callbackUrl: callbackAddress.href });
    assert.equal(onboarding.headers.get('location'), base + '/register?sso=complete');
    assert.equal(cookiePair(onboarding, 'jobfind_rt'), undefined);
    const signupCookie = cookiePair(onboarding, 'jobfind_signup');
    assert.ok(signupCookie);
    assert.equal(await countAccounts(), before);
    const profile = await (await fetch(base + '/api/auth/sso/signup', { headers: { Cookie: signupCookie } })).json();
    assert.equal(profile.profile.email, privateEmail);
    assert.equal(profile.profile.provider, 'github');
    assert.equal(profile.rememberMe, true);
    const signupData = { firstName: 'GitHub', lastName: 'Fixture', phonenumber: '0980000002', password,
      roleCode: 'CANDIDATE', email: user.email, companyId: 9999, rememberMe: false };
    const signup = body => fetch(base + '/api/auth/sso/signup', {
      method: 'POST', headers: { ...localHeaders, Cookie: signupCookie }, body: JSON.stringify(body),
    });
    assert.equal((await signup({ ...signupData, roleCode: 'ADMIN' })).status, 400);
    assert.equal(await countAccounts(), before);
    const created = await signup(signupData);
    assert.equal(created.status, 200);
    assert.match(findCookie(created, 'jobfind_rt'), /Max-Age=\d+/);
    assert.match(findCookie(created, 'jobfind_rt'), /HttpOnly/);
    const body = await created.json();
    assert.equal(body.user.email, privateEmail);
    assert.equal(body.user.roleCode, 'CANDIDATE');
    assert.equal(body.user.companyId, null);
    assert.equal(await countAccounts(), before + 1);
    const saved = await db.AuthIdentity.findOne({ where: { issuer: 'https://github.com', subject: String(providerId) }, raw: true });
    assert.equal(saved.userId, body.user.id);
    assert.equal(saved.emailAtLink, privateEmail);
    assert.equal(Boolean(saved.emailVerifiedAtLink), true);
    const savedSession = await db.AuthSession.findOne({ where: { familyId: jwt.decode(body.token).sid, rotatedAt: null }, raw: true });
    assert.equal(Boolean(savedSession.rememberMe), true);
    assert.ok(new Date(savedSession.expiresAt).getTime() - Date.now() > 13 * 86400000);
    assert.equal((await signup(signupData)).status, 410);
    assert.equal((await complete(flow)).headers.get('location'), base + '/login?sso=failed');
    // A changed mutable username still resolves the same numeric provider ID.
    username = 'renamed-username';
    const repeat = await complete(await begin(true));
    assert.equal(repeat.headers.get('location'), base + '/login?sso=success');
    assert.match(findCookie(repeat, 'jobfind_rt'), /Max-Age=\d+/);
    assert.equal(await countAccounts(), before + 1);
    const refreshed = await fetch(base + '/api/auth/refresh', {
      method: 'POST', headers: { ...localHeaders, Cookie: cookiePair(repeat, 'jobfind_rt') }, body: '{}',
    });
    assert.equal(refreshed.status, 200);
    assert.match(findCookie(refreshed, 'jobfind_rt'), /Max-Age=\d+/);
    const refreshedBody = await refreshed.json();
    assert.equal(refreshedBody.user.id, body.user.id);
    assert.equal(refreshedBody.user.email, privateEmail);
    assert.equal((await fetch(base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + refreshedBody.token } })).status, 200);
    console.log('PASS: local HTTP GitHub authorization/PKCE/token/profile/private email, one-use browser state, safe new-account onboarding, remembered sessions, stable-ID relogin and rejected provider/identity failures.');
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
    await new Promise(resolve => server.close(resolve));
  }
};
