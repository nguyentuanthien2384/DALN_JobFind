const mockSessions = { createSession: jest.fn(), setRefreshCookie: jest.fn(), clearRefreshCookie: jest.fn(), rotateSession: jest.fn(), readRefreshCookie: jest.fn(), revokeByRefresh: jest.fn(), revokeFamily: jest.fn(), revokeAll: jest.fn(), lockAccount: jest.fn() };
const mockDb = { Sequelize: { Op: { gt: Symbol('gt') } }, Account: { findOne: jest.fn() }, AuthSession: { findOne: jest.fn(), findAll: jest.fn() }, AuthIdentity: { findAll: jest.fn(), destroy: jest.fn() }, sequelize: { transaction: jest.fn(fn => fn({})) } };
const mockOidc = { googleAvailable: jest.fn(), begin: jest.fn(), complete: jest.fn() };
const mockUserService = { handleLogin: jest.fn() };
const mockCompare = jest.fn();
jest.mock('../../src/services/authSessionService', () => mockSessions);
jest.mock('../../src/services/userService', () => mockUserService);
jest.mock('../../src/services/oidcService', () => mockOidc);
jest.mock('../../src/models/index', () => mockDb);
jest.mock('bcryptjs', () => ({ compare: mockCompare }));
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
  mockSessions.createSession.mockResolvedValue({ user: { id: 7 }, token: 'access', refreshToken: 'private-refresh' });
  const response = res(); await controller.login(request(), response);
  expect(mockSessions.createSession).toHaveBeenCalledWith(7, 'password', { password: 'fixture' });
  expect(response.json).toHaveBeenCalledWith({ errCode: 0, user: { id: 7 }, token: 'access' });
  expect(mockSessions.setRefreshCookie).toHaveBeenCalledWith(response, 'private-refresh');
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
