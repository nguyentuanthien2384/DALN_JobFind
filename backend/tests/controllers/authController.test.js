const mockSessions = { createSession: jest.fn(), setRefreshCookie: jest.fn(), clearRefreshCookie: jest.fn(), rotateSession: jest.fn(), readRefreshCookie: jest.fn(), revokeByRefresh: jest.fn(), revokeFamily: jest.fn(), revokeAll: jest.fn(), lockAccount: jest.fn(), activeFamily: jest.fn() };
const mockDb = { Sequelize: { Op: { gt: Symbol('gt') } }, Account: { findOne: jest.fn() }, AuthSession: { findOne: jest.fn(), findAll: jest.fn() }, AuthIdentity: { findAll: jest.fn(), destroy: jest.fn() }, sequelize: { transaction: jest.fn(fn => fn({})) } };
const mockOidc = { googleAvailable: jest.fn(), availableProviders: jest.fn(), begin: jest.fn(), complete: jest.fn() };
const mockRegistration = { signupProfile: jest.fn(), completeSignup: jest.fn(), clearSignupCookie: jest.fn() };
const mockUserService = { handleLogin: jest.fn() };
const mockCompare = jest.fn();
jest.mock('../../src/services/authSessionService', () => mockSessions);
jest.mock('../../src/services/userService', () => mockUserService);
jest.mock('../../src/services/oidcService', () => mockOidc);
jest.mock('../../src/services/socialRegistrationService', () => mockRegistration);
jest.mock('../../src/models/index', () => mockDb);
jest.mock('bcryptjs', () => ({ compare: mockCompare }));
jest.mock('../../src/services/authAuditService', () => ({ deviceLabel: () => 'Trình duyệt khác · Thiết bị khác', recordSecurityEvent: jest.fn(), recentSecurityEvents: jest.fn() }));
const controller = require('../../src/controllers/authController');
const mockAudit = require('../../src/services/authAuditService');
const res = () => { const r = {}; for (const name of ['status', 'json', 'end', 'set', 'redirect']) r[name] = jest.fn(() => r); return r; };
const request = () => ({ get: key => key === 'Origin' ? 'http://localhost:3001' : undefined, body: { password: 'fixture' }, user: { id: 7 }, auth: { sid: 'own-family' }, params: { familyId: 'foreign-family', identityId: '42', provider: 'google' } });
beforeEach(() => {
  jest.resetAllMocks();
  process.env.URL_REACT = 'http://localhost:3001';
  mockDb.sequelize.transaction.mockImplementation(fn => fn({}));
  mockDb.Account.findOne.mockResolvedValue({ password: 'hash' });
  mockCompare.mockResolvedValue(true);
});

test('cookie endpoints reject missing or untrusted Origin', () => {
  for (const origin of [undefined, 'null', 'http://localhost:3001.evil.invalid']) {
    const response = res(), next = jest.fn();
    controller.cookieOrigin({ get: () => origin }, response, next);
    expect(response.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  }
});
test('login passes password proof into the locked session issuance and never exposes refresh credential', async () => {
  mockUserService.handleLogin.mockResolvedValue({ errCode: 0, user: { id: 7 } });
  mockSessions.createSession.mockResolvedValue({ user: { id: 7 }, token: 'access', refreshToken: 'private-refresh', rememberMe: false });
  const response = res(); await controller.login(request(), response);
  expect(mockSessions.createSession).toHaveBeenCalledWith(7, 'password', { password: 'fixture', deviceLabel: 'Trình duyệt khác · Thiết bị khác', rememberMe: false });
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, user: { id: 7 }, token: 'access' });
  expect(mockSessions.setRefreshCookie).toHaveBeenCalledWith(response, 'private-refresh', undefined, false);
  expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
});
test('revoking another user session fails without any mutation', async () => {
  mockDb.AuthSession.findOne.mockResolvedValue(null);
  const response = res(); await controller.revokeSession(request(), response);
  expect(mockDb.AuthSession.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: 'foreign-family', userId: 7 } }));
  expect(response.status).toHaveBeenCalledWith(404);
  expect(mockSessions.revokeFamily).not.toHaveBeenCalled();
});
test('revoking the current session clears the refresh cookie', async () => {
  mockDb.AuthSession.findOne.mockResolvedValue({ familyId: 'own-family' });
  const req = request(); req.params.familyId = 'own-family';
  const response = res(); await controller.revokeSession(req, response);
  expect(mockSessions.revokeFamily).toHaveBeenCalledWith('own-family');
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledWith(response);
});
test('wrong password blocks Google linking and unlinking', async () => {
  mockCompare.mockResolvedValue(false);
  for (const action of [controller.ssoStart, controller.unlinkIdentity]) {
    const response = res(); await action(request(), response);
    expect(response.status).toHaveBeenCalledWith(403);
  }
  expect(mockOidc.begin).not.toHaveBeenCalled();
  expect(mockDb.AuthIdentity.destroy).not.toHaveBeenCalled();
});
test('successful linking returns to security settings without replacing the current session', async () => {
  mockOidc.complete.mockResolvedValue({ linked: true, userId: 7 });
  const response = res(); await controller.ssoCallback(request(), response);
  expect(response.redirect).toHaveBeenCalledWith(303, 'http://localhost:3001/account/security?sso=linked');
  expect(mockSessions.createSession).not.toHaveBeenCalled();
});
test('logout-all always derives the user id from the authenticated account', async () => {
  const req = request(); req.body.userId = 99;
  await controller.logoutAll(req, res());
  expect(mockSessions.revokeAll).toHaveBeenCalledWith(7);
});

test.each(['password-changed', 'session-revoked'])('unlink rechecks %s inside the account lock', async kind => {
  mockSessions.lockAccount.mockResolvedValue({ statusCode: 'S1', password: 'latest-hash' });
  mockSessions.activeFamily.mockResolvedValue(kind !== 'session-revoked');
  if (kind === 'password-changed') mockCompare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const response = res(); await controller.unlinkIdentity(request(), response);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(mockDb.AuthIdentity.destroy).not.toHaveBeenCalled();
  expect(mockSessions.revokeAll).not.toHaveBeenCalled();
});
test('a missing/foreign identity does not revoke sessions or clear the caller cookie', async () => {
  mockSessions.lockAccount.mockResolvedValue({ statusCode: 'S1', password: 'latest-hash' });
  mockSessions.activeFamily.mockResolvedValue(true);
  mockDb.AuthIdentity.destroy.mockResolvedValue(0);
  const response = res(); await controller.unlinkIdentity(request(), response);
  expect(response.status).toHaveBeenCalledWith(404);
  expect(mockSessions.revokeAll).not.toHaveBeenCalled();
  expect(mockSessions.clearRefreshCookie).not.toHaveBeenCalled();
});

test.each([true, false, 'true', undefined])('password login accepts rememberMe only as Boolean true: %s', async rememberMe => {
  const req = request(); req.body.rememberMe = rememberMe;
  mockUserService.handleLogin.mockResolvedValue({ errCode: 0, user: { id: 7 } });
  mockSessions.createSession.mockResolvedValue({ user: { id: 7 }, token: 'access', refreshToken: 'private', rememberMe: rememberMe === true });
  const response = res(); await controller.login(req, response);
  expect(mockSessions.createSession.mock.calls[0][2].rememberMe).toBe(rememberMe === true);
  expect(mockSessions.setRefreshCookie).toHaveBeenCalledWith(response, 'private', undefined, rememberMe === true);
});

test('refresh forwards the persisted remember choice instead of a posted preference', async () => {
  mockSessions.readRefreshCookie.mockReturnValue('old');
  const expiresAt = new Date(Date.now() + 60000);
  mockSessions.rotateSession.mockResolvedValue({ token: 'access', user: { id: 7 }, refreshToken: 'rotated', rememberMe: false, expiresAt });
  const req = request(); req.body.rememberMe = true;
  const response = res(); await controller.refresh(req, response);
  expect(mockSessions.setRefreshCookie).toHaveBeenCalledWith(response, 'rotated', expiresAt, false);
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, token: 'access', user: { id: 7 } });
});

test('SSO start stores the explicit preference and uses only the service redirect', async () => {
  const req = request(); delete req.user; delete req.auth;
  req.method = 'GET'; req.query = { rememberMe: 'true', redirect: 'https://attacker.invalid/' };
  mockOidc.begin.mockResolvedValue('https://accounts.google.com/safe-authorization');
  const response = res(); await controller.ssoStart(req, response);
  expect(mockOidc.begin).toHaveBeenCalledWith('google', response, null, undefined, true);
  expect(response.redirect).toHaveBeenCalledWith(302, 'https://accounts.google.com/safe-authorization');
});

test('new social identity returns to signup without creating a login session', async () => {
  mockOidc.complete.mockResolvedValue({ pendingSignup: true });
  const response = res(); await controller.ssoCallback(request(), response);
  expect(response.redirect).toHaveBeenCalledWith(303, 'http://localhost:3001/register?sso=complete');
  expect(mockSessions.createSession).not.toHaveBeenCalled();
  expect(mockSessions.setRefreshCookie).not.toHaveBeenCalled();
});

test('social login forwards server-bound identity and remember preference', async () => {
  mockOidc.complete.mockResolvedValue({ userId: 7, identityId: 9, method: 'oidc:auth0', rememberMe: false });
  mockSessions.createSession.mockResolvedValue({ token: 'access', refreshToken: 'private', rememberMe: false });
  const req = request(); req.query = { rememberMe: 'true' };
  const response = res(); await controller.ssoCallback(req, response);
  expect(mockSessions.createSession).toHaveBeenCalledWith(7, 'oidc:auth0', { identityId: 9, deviceLabel: 'Trình duyệt khác · Thiết bị khác', rememberMe: false });
  expect(mockSessions.setRefreshCookie).toHaveBeenCalledWith(response, 'private', undefined, false);
  expect(response.redirect).toHaveBeenCalledWith(303, 'http://localhost:3001/login?sso=success');
});

test('public provider metadata contains only the configured availability flags', () => {
  mockOidc.availableProviders.mockReturnValue({ google: false, github: true, auth0: false });
  const response = res(); controller.providers({}, response);
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, google: false, github: true, auth0: false });
});

test('successful social signup consumes its cookie and issues the new account session', async () => {
  mockRegistration.completeSignup.mockResolvedValue({ userId: 7, identityId: 9, method: 'oidc:google', rememberMe: false });
  mockSessions.createSession.mockResolvedValue({ token: 'access', refreshToken: 'private', user: { id: 7 }, rememberMe: false });
  const response = res(); await controller.completeSocialSignup(request(), response);
  expect(mockRegistration.clearSignupCookie).toHaveBeenCalledWith(response);
  expect(mockSessions.createSession).toHaveBeenCalledWith(7, 'oidc:google', expect.objectContaining({ identityId: 9, rememberMe: false }));
  expect(mockSessions.setRefreshCookie).toHaveBeenCalledWith(response, 'private', undefined, false);
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, token: 'access', user: { id: 7 } });
});

test('session failure after social account creation reports recovery and does not invite duplicate signup', async () => {
  mockRegistration.completeSignup.mockResolvedValue({ userId: 7, identityId: 9, method: 'oidc:google', rememberMe: false });
  mockSessions.createSession.mockRejectedValueOnce(new Error('session database unavailable'));
  const response = res(); await controller.completeSocialSignup(request(), response);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ accountCreated: true, errMessage: expect.stringContaining('Tài khoản đã được tạo') }));
  expect(mockRegistration.clearSignupCookie).toHaveBeenCalledWith(response);
  expect(mockSessions.setRefreshCookie).not.toHaveBeenCalled();
});

test('invalid social signup preserves the onboarding cookie and returns field errors', async () => {
  mockRegistration.completeSignup.mockRejectedValueOnce(Object.assign(new Error('Email already registered'), { errCode: 4, fieldErrors: { email: 'Email already registered' } }));
  const response = res(); await controller.completeSocialSignup(request(), response);
  expect(response.status).toHaveBeenCalledWith(409);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ accountCreated: false, fieldErrors: { email: 'Email already registered' } }));
  expect(mockSessions.createSession).not.toHaveBeenCalled();
  expect(mockRegistration.clearSignupCookie).not.toHaveBeenCalled();
});

test('trusted Origin advances cookie actions; login rejects an untrusted Origin before credential lookup', async () => {
  const next = jest.fn();
  controller.cookieOrigin(request(), res(), next);
  expect(next).toHaveBeenCalledTimes(1);
  const req = request(); req.get = () => 'https://attacker.invalid';
  const response = res(); await controller.login(req, response);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(mockUserService.handleLogin).not.toHaveBeenCalled();
  expect(mockSessions.createSession).not.toHaveBeenCalled();
});

test('default local origins accept an empty login body and pass an empty credential object to validation', async () => {
  const previous = process.env.URL_REACT;
  try {
    delete process.env.URL_REACT;
    mockUserService.handleLogin.mockResolvedValue({ errCode: 1, errMessage: 'Thiếu thông tin đăng nhập' });
    const req = request(); delete req.body;
    const response = res(); await controller.login(req, response);
    expect(mockUserService.handleLogin).toHaveBeenCalledWith({});
    expect(response.status).toHaveBeenCalledWith(401);
    expect(mockSessions.createSession).not.toHaveBeenCalled();
  } finally {
    if (previous === undefined) delete process.env.URL_REACT;
    else process.env.URL_REACT = previous;
  }
});

test('empty configured origin entries are ignored', () => {
  const previous = process.env.URL_REACT;
  try {
    process.env.URL_REACT = ' , http://localhost:3001, ';
    const next = jest.fn();
    controller.cookieOrigin(request(), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const denied = res();
    controller.cookieOrigin({ get: () => '' }, denied, jest.fn());
    expect(denied.status).toHaveBeenCalledWith(403);
  } finally {
    if (previous === undefined) delete process.env.URL_REACT;
    else process.env.URL_REACT = previous;
  }
});

test('failed password login is audited and never issues a session or cookie', async () => {
  mockUserService.handleLogin.mockResolvedValue({ errCode: 2, errMessage: 'Sai thông tin đăng nhập' });
  const response = res(); await controller.login(request(), response);
  expect(mockAudit.recordSecurityEvent).toHaveBeenCalledWith({
    event: 'login_failed', device: 'Trình duyệt khác · Thiết bị khác',
  });
  expect(response.status).toHaveBeenCalledWith(401);
  expect(response.json).toHaveBeenCalledWith({ errCode: 2, errMessage: 'Sai thông tin đăng nhập' });
  expect(mockSessions.createSession).not.toHaveBeenCalled();
  expect(mockSessions.setRefreshCookie).not.toHaveBeenCalled();
});

test.each(['credential lookup', 'session issuance'])('%s failure returns a generic service error', async stage => {
  mockUserService.handleLogin.mockResolvedValue({ errCode: 0, user: { id: 7 } });
  if (stage === 'credential lookup') mockUserService.handleLogin.mockRejectedValue(new Error('database password hash'));
  else mockSessions.createSession.mockRejectedValue(new Error('database password hash'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = res(); await controller.login(request(), response);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Authentication service unavailable' });
    expect(mockSessions.setRefreshCookie).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('password hash');
  } finally { log.mockRestore(); }
});

test('invalid or expired refresh clears the cookie and returns 401 without rotating it', async () => {
  mockSessions.readRefreshCookie.mockReturnValue(null);
  mockSessions.rotateSession.mockResolvedValue(null);
  const response = res(); await controller.refresh(request(), response);
  expect(mockSessions.rotateSession).toHaveBeenCalledWith(null);
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledWith(response);
  expect(mockSessions.setRefreshCookie).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(401);
  expect(response.json).toHaveBeenCalledWith({
    errCode: 401, errMessage: 'Phiên đăng nhập không hợp lệ', refresh: true,
  });
});

test('refresh service errors return 503 without disclosing the old refresh token', async () => {
  mockSessions.readRefreshCookie.mockReturnValue('private-old-token');
  mockSessions.rotateSession.mockRejectedValue(new Error('private-old-token database error'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = res(); await controller.refresh(request(), response);
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Authentication service unavailable' });
    expect(JSON.stringify(response.json.mock.calls)).not.toContain('private-old-token');
  } finally { log.mockRestore(); }
});

test('logout revokes both cookie and current access-token family, then clears the cookie', async () => {
  mockSessions.readRefreshCookie.mockReturnValue('private-refresh');
  const response = res(); await controller.logout(request(), response);
  expect(mockSessions.revokeByRefresh).toHaveBeenCalledWith('private-refresh');
  expect(mockSessions.revokeFamily).toHaveBeenCalledWith('own-family');
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledWith(response);
  expect(response.status).toHaveBeenCalledWith(204);
  expect(response.end).toHaveBeenCalledTimes(1);
  expect(response.json).not.toHaveBeenCalled();
});

test('cookie-only logout works without an access token; revocation failure is a sanitized 503', async () => {
  const req = request(); delete req.auth;
  await controller.logout(req, res());
  expect(mockSessions.revokeFamily).not.toHaveBeenCalled();
  mockSessions.revokeByRefresh.mockRejectedValueOnce(new Error('private database error'));
  const response = res(); await controller.logout(req, response);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Logout unavailable' });
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledTimes(1);
});

test('logout-all returns 204 on success and a generic 503 when revocation fails', async () => {
  const response = res(); await controller.logoutAll(request(), response);
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledWith(response);
  expect(response.status).toHaveBeenCalledWith(204);
  expect(response.end).toHaveBeenCalledTimes(1);
  mockSessions.revokeAll.mockRejectedValueOnce(new Error('private database error'));
  const failedResponse = res(); await controller.logoutAll(request(), failedResponse);
  expect(failedResponse.status).toHaveBeenCalledWith(503);
  expect(failedResponse.json).toHaveBeenCalledWith({ errCode: -1, errMessage: 'Logout unavailable' });
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledTimes(1);
});

test('authenticated SSO linking requires password and passes the verified user and session', async () => {
  const req = request(); req.method = 'POST'; req.body.rememberMe = true;
  mockOidc.begin.mockResolvedValue('https://accounts.google.com/safe-authorization');
  const response = res(); await controller.ssoStart(req, response);
  expect(mockDb.Account.findOne).toHaveBeenCalledWith({ where: { userId: 7, statusCode: 'S1' } });
  expect(mockCompare).toHaveBeenCalledWith('fixture', 'hash');
  expect(mockOidc.begin).toHaveBeenCalledWith('google', response, 7, 'own-family', true);
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, redirect: 'https://accounts.google.com/safe-authorization' });
  expect(response.redirect).not.toHaveBeenCalled();
});

test.each([undefined, 7, 'x'.repeat(257)])('SSO linking rejects invalid password input %p before account lookup', async password => {
  const req = request(); req.method = 'POST'; req.body.password = password;
  const response = res(); await controller.ssoStart(req, response);
  expect(response.status).toHaveBeenCalledWith(403);
  expect(mockDb.Account.findOne).not.toHaveBeenCalled();
  expect(mockOidc.begin).not.toHaveBeenCalled();
});

test('SSO start refuses a missing active account and sanitizes provider failures', async () => {
  const req = request(); req.method = 'POST';
  mockDb.Account.findOne.mockResolvedValueOnce(null);
  const denied = res(); await controller.ssoStart(req, denied);
  expect(denied.status).toHaveBeenCalledWith(403);
  expect(mockOidc.begin).not.toHaveBeenCalled();
  mockOidc.begin.mockRejectedValue(new Error('client secret leaked'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const failedResponse = res(); await controller.ssoStart(req, failedResponse);
    expect(failedResponse.status).toHaveBeenCalledWith(503);
    expect(failedResponse.json).toHaveBeenCalledWith({
      errCode: -1, errMessage: 'SSO chưa được cấu hình hoặc tạm thời không khả dụng',
    });
    expect(JSON.stringify(failedResponse.json.mock.calls)).not.toContain('client secret');
  } finally { log.mockRestore(); }
});

test('SSO callback selects only an allowed frontend origin for redirects', async () => {
  const oldReact = process.env.URL_REACT, oldFrontend = process.env.AUTH_FRONTEND_ORIGIN;
  try {
    process.env.URL_REACT = 'https://app.example.test,https://second.example.test';
    process.env.AUTH_FRONTEND_ORIGIN = 'https://attacker.invalid';
    mockOidc.complete.mockResolvedValue({ pendingSignup: true });
    const response = res(); await controller.ssoCallback(request(), response);
    expect(response.redirect).toHaveBeenCalledWith(303, 'https://app.example.test/register?sso=complete');
    process.env.AUTH_FRONTEND_ORIGIN = 'https://second.example.test';
    const allowed = res(); await controller.ssoCallback(request(), allowed);
    expect(allowed.redirect).toHaveBeenCalledWith(303, 'https://second.example.test/register?sso=complete');
  } finally {
    if (oldReact === undefined) delete process.env.URL_REACT; else process.env.URL_REACT = oldReact;
    if (oldFrontend === undefined) delete process.env.AUTH_FRONTEND_ORIGIN; else process.env.AUTH_FRONTEND_ORIGIN = oldFrontend;
  }
});

test.each([
  ['OIDC_ACCOUNT_EXISTS', 'account-exists'],
  ['OIDC_EMAIL_UNVERIFIED', 'email-unverified'],
  ['OIDC_NOT_LINKED', 'not-linked'],
  ['OIDC_CANCELLED', 'cancelled'],
  ['unexpected internal secret', 'failed'],
])('SSO callback maps %s to a safe redirect reason', async (code, reason) => {
  mockOidc.complete.mockRejectedValue(new Error(code));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = res(); await controller.ssoCallback(request(), response);
    expect(response.redirect).toHaveBeenCalledWith(303, `http://localhost:3001/login?sso=${reason}`);
    expect(mockAudit.recordSecurityEvent).toHaveBeenCalledWith({
      event: 'sso_rejected', device: 'Trình duyệt khác · Thiết bị khác',
    });
    expect(mockSessions.createSession).not.toHaveBeenCalled();
    expect(mockSessions.setRefreshCookie).not.toHaveBeenCalled();
    expect(JSON.stringify(response.redirect.mock.calls)).not.toContain('internal secret');
  } finally { log.mockRestore(); }
});

test('SSO callback still gives a safe failure redirect when audit storage is unavailable', async () => {
  mockOidc.complete.mockRejectedValue(new Error('OIDC_CANCELLED'));
  mockAudit.recordSecurityEvent.mockRejectedValue(new Error('audit database unavailable'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = res(); await controller.ssoCallback(request(), response);
    expect(response.redirect).toHaveBeenCalledWith(303, 'http://localhost:3001/login?sso=cancelled');
  } finally { log.mockRestore(); }
});

test('signup profile returns only the social registration profile', async () => {
  const profile = { email: 'candidate@example.com', displayName: 'Candidate' };
  mockRegistration.signupProfile.mockResolvedValue(profile);
  const req = request(), response = res();
  await controller.signupProfile(req, response);
  expect(mockRegistration.signupProfile).toHaveBeenCalledWith(req);
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, ...profile });
});

test.each([
  [Object.assign(new Error('Signup state expired'), { status: 400 }), 400, 'Signup state expired'],
  [new Error('database secret'), 503, 'Không tải được thông tin đăng ký.'],
])('signup profile maps a controlled %p failure to HTTP %i', async (error, status, message) => {
  mockRegistration.signupProfile.mockRejectedValue(error);
  const response = res(); await controller.signupProfile(request(), response);
  expect(response.status).toHaveBeenCalledWith(status);
  expect(response.json).toHaveBeenCalledWith({ errCode: status, errMessage: message });
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('database secret');
});

test.each([
  [Object.assign(new Error('Invalid email'), { fieldErrors: { email: 'Invalid email' }, errCode: 2 }), 400],
  [Object.assign(new Error('Signup cookie expired'), { status: 422 }), 422],
  [new Error('private database error'), 503],
])('social signup failure %p returns HTTP %i without issuing an auth session', async (error, status) => {
  mockRegistration.completeSignup.mockRejectedValue(error);
  const response = res(); await controller.completeSocialSignup(request(), response);
  expect(response.status).toHaveBeenCalledWith(status);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
    errCode: status, accountCreated: false,
  }));
  expect(mockSessions.createSession).not.toHaveBeenCalled();
  expect(mockRegistration.clearSignupCookie).not.toHaveBeenCalled();
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('private database error');
});

test('security overview reads only current user data and marks the current session', async () => {
  mockDb.AuthSession.findAll.mockResolvedValue([
    { familyId: 'own-family', toJSON: () => ({ familyId: 'own-family', method: 'password' }) },
    { familyId: 'other-family', toJSON: () => ({ familyId: 'other-family', method: 'google' }) },
  ]);
  const identities = [{ id: 3, provider: 'google', emailAtLink: 'user@example.com' }];
  mockDb.AuthIdentity.findAll.mockResolvedValue(identities);
  mockAudit.recentSecurityEvents.mockResolvedValue({ events: [{ event: 'login_succeeded' }], nextCursor: null });
  mockOidc.availableProviders.mockReturnValue({ google: true, github: false });
  const response = res(); await controller.securityOverview(request(), response);
  expect(mockDb.AuthSession.findAll).toHaveBeenCalledWith(expect.objectContaining({
    raw: false,
    where: expect.objectContaining({ userId: 7, revokedAt: null, rotatedAt: null,
      expiresAt: { [mockDb.Sequelize.Op.gt]: expect.any(Date) } }),
    attributes: expect.arrayContaining(['familyId', 'expiresAt', 'lastUsedAt']),
  }));
  expect(mockDb.AuthIdentity.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
  expect(mockAudit.recentSecurityEvents).toHaveBeenCalledWith(7);
  expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(response.json).toHaveBeenCalledWith({
    errCode: 0,
    sessions: [
      { familyId: 'own-family', method: 'password', current: true },
      { familyId: 'other-family', method: 'google', current: false },
    ],
    identities,
    events: [{ event: 'login_succeeded' }], nextCursor: null,
    google: true, github: false,
  });
});

test('security overview database failure returns a generic 503', async () => {
  mockDb.AuthSession.findAll.mockRejectedValue(new Error('private session data'));
  mockDb.AuthIdentity.findAll.mockResolvedValue([]);
  mockAudit.recentSecurityEvents.mockResolvedValue({ events: [] });
  const response = res(); await controller.securityOverview(request(), response);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.json).toHaveBeenCalledWith({ errCode: 503, errMessage: 'Không tải được thông tin bảo mật' });
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('private session data');
});

test('security events pass the caller cursor to the audit service without caching', async () => {
  const req = request(); req.query = { before: 'opaque-cursor', userId: 999 };
  mockAudit.recentSecurityEvents.mockResolvedValue({ events: [{ event: 'password_changed' }], nextCursor: null });
  const response = res(); await controller.securityEvents(req, response);
  expect(mockAudit.recentSecurityEvents).toHaveBeenCalledWith(7, 'opaque-cursor');
  expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(response.json).toHaveBeenCalledWith({
    errCode: 0, events: [{ event: 'password_changed' }], nextCursor: null,
  });
});

test.each([
  [new Error('INVALID_CURSOR'), 400],
  [new Error('private database error'), 503],
])('security events map audit error %p to HTTP %i', async (error, status) => {
  mockAudit.recentSecurityEvents.mockRejectedValue(error);
  const req = request(); req.query = { before: 'cursor' };
  const response = res(); await controller.securityEvents(req, response);
  expect(response.status).toHaveBeenCalledWith(status);
  expect(response.json).toHaveBeenCalledWith({ errCode: status, errMessage: 'Không tải được lịch sử bảo mật' });
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('database error');
});

test('revoking a different owned session keeps the current refresh cookie', async () => {
  mockDb.AuthSession.findOne.mockResolvedValue({ familyId: 'other-owned-family' });
  const response = res(); await controller.revokeSession(request(), response);
  expect(mockSessions.revokeFamily).toHaveBeenCalledWith('other-owned-family');
  expect(mockSessions.clearRefreshCookie).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalledWith({ errCode: 0 });
});

test('session revocation failure returns a generic 503 without clearing the cookie', async () => {
  mockDb.AuthSession.findOne.mockResolvedValue({ familyId: 'own-family' });
  mockSessions.revokeFamily.mockRejectedValue(new Error('private database error'));
  const response = res(); await controller.revokeSession(request(), response);
  expect(response.status).toHaveBeenCalledWith(503);
  expect(response.json).toHaveBeenCalledWith({ errCode: 503, errMessage: 'Không thu hồi được phiên' });
  expect(mockSessions.clearRefreshCookie).not.toHaveBeenCalled();
});

test('unlinking an identity deletes only the caller identity, revokes sessions and audits the event', async () => {
  mockSessions.lockAccount.mockResolvedValue({ statusCode: 'S1', password: 'latest-hash' });
  mockSessions.activeFamily.mockResolvedValue(true);
  mockDb.AuthIdentity.destroy.mockResolvedValue(1);
  const response = res(); await controller.unlinkIdentity(request(), response);
  expect(mockDb.AuthIdentity.destroy).toHaveBeenCalledWith({
    where: { id: '42', userId: 7 }, transaction: expect.any(Object),
  });
  expect(mockSessions.revokeAll).toHaveBeenCalledWith(7, expect.any(Object));
  expect(mockAudit.recordSecurityEvent).toHaveBeenCalledWith({
    event: 'identity_unlinked', userId: 7, device: 'Trình duyệt khác · Thiết bị khác',
  }, expect.any(Object));
  expect(mockSessions.clearRefreshCookie).toHaveBeenCalledWith(response);
  expect(response.json).toHaveBeenCalledWith({ errCode: 0 });
});

test.each([
  [null, 403],
  [{ statusCode: 'S2', password: 'latest-hash' }, 403],
  [{ statusCode: 'S1', password: 'latest-hash' }, 503],
])('unlink handles locked-account state %p without deleting identities', async (account, status) => {
  mockSessions.lockAccount.mockResolvedValue(account);
  if (status === 503) mockCompare.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('bcrypt unavailable'));
  const response = res(); await controller.unlinkIdentity(request(), response);
  expect(response.status).toHaveBeenCalledWith(status);
  expect(mockDb.AuthIdentity.destroy).not.toHaveBeenCalled();
  expect(mockSessions.revokeAll).not.toHaveBeenCalled();
  expect(mockSessions.clearRefreshCookie).not.toHaveBeenCalled();
});
