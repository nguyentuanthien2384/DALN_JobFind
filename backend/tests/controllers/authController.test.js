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
const res = () => { const r = {}; for (const name of ['status', 'json', 'end', 'set', 'redirect']) r[name] = jest.fn(() => r); return r; };
const request = () => ({ get: key => key === 'Origin' ? 'http://localhost:3001' : undefined, body: { password: 'fixture' }, user: { id: 7 }, auth: { sid: 'own-family' }, params: { familyId: 'foreign-family', identityId: '42', provider: 'google' } });
beforeEach(() => { jest.clearAllMocks(); process.env.URL_REACT = 'http://localhost:3001'; mockDb.Account.findOne.mockResolvedValue({ password: 'hash' }); mockCompare.mockResolvedValue(true); });

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
