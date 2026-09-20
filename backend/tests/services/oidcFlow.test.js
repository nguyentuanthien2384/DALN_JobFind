const mockDb = {
  Sequelize: { Op: { lt: Symbol('lt') } },
  sequelize: { transaction: jest.fn(cb => cb({ LOCK: { UPDATE: 'UPDATE' } })) },
  OidcTransaction: { findByPk: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  AuthIdentity: { findOne: jest.fn(), create: jest.fn() },
  AuthSession: { findOne: jest.fn() },
};
const mockSessions = { hashOpaque: x => x, loadUser: jest.fn(), activeFamily: jest.fn(), readRefreshCookie: jest.fn(), lockAccount: jest.fn() };
const mockConfig = { serverMetadata: () => ({ issuer: 'https://accounts.google.com' }) };
const mockClient = {
  discovery: jest.fn(), randomState: () => 'state', randomNonce: () => 'nonce', randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: jest.fn(async () => 'challenge'), buildAuthorizationUrl: jest.fn(() => new URL('https://accounts.google.com/authorize')),
  authorizationCodeGrant: jest.fn(),
  enableNonRepudiationChecks: jest.fn(),
};
jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/services/authSessionService', () => mockSessions);
jest.mock('openid-client', () => mockClient);
const oidc = require('../../src/services/oidcService');
const original = { ...process.env };
const browser = 'b'.repeat(43);
let transaction, identity;
const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });
const request = () => ({ query: { code: 'code', state: 'state' }, headers: { cookie: 'jobfind_oidc_tx=' + browser } });
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, { OIDC_GOOGLE_ENABLED: 'true', OIDC_GOOGLE_ISSUER: 'https://accounts.google.com', OIDC_GOOGLE_CLIENT_ID: 'test-client', OIDC_GOOGLE_CLIENT_SECRET: 'test-secret', OIDC_GOOGLE_REDIRECT_URI: 'http://localhost:4000/api/auth/sso/google/callback' });
  transaction = { provider: 'google', browserHash: browser, expiresAt: new Date(Date.now() + 10000), verifier: 'verifier', nonce: 'nonce', linkUserId: null, destroy: jest.fn(), toJSON() { return { ...this }; } };
  identity = { id: 9, userId: 7, update: jest.fn() };
  mockDb.OidcTransaction.findByPk.mockImplementation(async () => transaction);
  mockDb.AuthIdentity.findOne.mockResolvedValue(identity);
  mockDb.AuthIdentity.create.mockResolvedValue(identity);
  mockDb.AuthSession.findOne.mockResolvedValue({});
  mockSessions.loadUser.mockResolvedValue({ id: 7 });
  mockSessions.activeFamily.mockResolvedValue(true);
  mockSessions.readRefreshCookie.mockReturnValue('refresh-cookie');
  mockClient.discovery.mockResolvedValue(mockConfig);
  mockClient.authorizationCodeGrant.mockResolvedValue({ claims: () => ({ iss: 'https://accounts.google.com', sub: 'subject', aud: 'test-client', email_verified: true, email: 'person@example.com', role: 'ADMIN' }) });
});
afterAll(() => { process.env = original; });

test('start binds state to browser and uses PKCE S256, nonce and fixed callback', async () => {
  const res = response();
  await oidc.begin('google', res);
  expect(res.cookie).toHaveBeenCalledWith('jobfind_oidc_tx', expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
  expect(mockClient.buildAuthorizationUrl).toHaveBeenCalledWith(mockConfig, expect.objectContaining({ state: 'state', nonce: 'nonce', code_challenge: 'challenge', code_challenge_method: 'S256', redirect_uri: process.env.OIDC_GOOGLE_REDIRECT_URI }));
});
test('callback consumes state once and delegates all token validation checks to OIDC client', async () => {
  const result = await oidc.complete('google', request(), response());
  expect(result).toEqual({ userId: 7, identityId: 9, method: 'oidc:google', linked: false });
  expect(result.role).toBeUndefined();
  expect(transaction.destroy).toHaveBeenCalled();
  expect(mockClient.enableNonRepudiationChecks).toHaveBeenCalledWith(mockConfig);
  expect(mockClient.authorizationCodeGrant).toHaveBeenCalledWith(mockConfig, expect.any(URL), { pkceCodeVerifier: 'verifier', expectedState: 'state', expectedNonce: 'nonce', idTokenExpected: true });
  mockDb.OidcTransaction.findByPk.mockResolvedValue(null);
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_STATE');
});
test.each(['browser', 'expired', 'provider'])('rejects invalid transaction: %s', async kind => {
  if (kind === 'browser') transaction.browserHash = 'wrong';
  if (kind === 'expired') transaction.expiresAt = new Date(0);
  if (kind === 'provider') transaction.provider = 'other';
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_STATE');
  expect(mockClient.authorizationCodeGrant).not.toHaveBeenCalled();
});
test('does not provision or merge an unlinked email', async () => {
  mockDb.AuthIdentity.findOne.mockResolvedValue(null);
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_NOT_LINKED');
  expect(mockDb.AuthIdentity.create).not.toHaveBeenCalled();
});
test('propagates provider signature/nonce validation failure without issuing an identity', async () => {
  mockClient.authorizationCodeGrant.mockRejectedValue(new Error('invalid signature or nonce'));
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('invalid signature or nonce');
  expect(mockDb.AuthIdentity.findOne).not.toHaveBeenCalled();
});
test.each(['revoked', 'different-browser-session', 'other-user'])('cannot link using %s', async kind => {
  transaction.linkUserId = 7; transaction.linkSessionId = 'family';
  if (kind === 'revoked') mockSessions.activeFamily.mockResolvedValue(false);
  if (kind === 'different-browser-session') mockDb.AuthSession.findOne.mockResolvedValue(null);
  if (kind === 'other-user') identity.userId = 8;
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_LINK_DENIED');
  expect(mockDb.AuthIdentity.create).not.toHaveBeenCalled();
});
test('links only to the authenticated local account within its account lock', async () => {
  transaction.linkUserId = 7; transaction.linkSessionId = 'family';
  mockDb.AuthIdentity.findOne.mockResolvedValue(null);
  expect(await oidc.complete('google', request(), response())).toMatchObject({ linked: true, userId: 7 });
  expect(mockSessions.lockAccount).toHaveBeenCalledWith(7, expect.any(Object));
  expect(mockDb.AuthIdentity.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, subject: 'subject', issuer: 'https://accounts.google.com' }), expect.objectContaining({ transaction: expect.any(Object) }));
});
