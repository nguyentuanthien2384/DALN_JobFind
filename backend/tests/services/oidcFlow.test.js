const mockDb = {
  Sequelize: { Op: { lt: Symbol('lt') } },
  sequelize: { transaction: jest.fn(cb => cb({ LOCK: { UPDATE: 'UPDATE' } })) },
  OidcTransaction: { findByPk: jest.fn(), create: jest.fn(), destroy: jest.fn() },
  AuthIdentity: { findOne: jest.fn(), create: jest.fn() },
  AuthSession: { findOne: jest.fn() },
};
jest.mock('../../src/services/authAuditService', () => ({ recordSecurityEvent: jest.fn() }));
const mockSessions = { hashOpaque: x => x, loadUser: jest.fn(), activeFamily: jest.fn(), readRefreshCookie: jest.fn(), lockAccount: jest.fn() };
const mockConfig = { serverMetadata: jest.fn() };
const mockRegistration = { prepareSignup: jest.fn(), clearSignupCookie: jest.fn() };
const mockClient = {
  discovery: jest.fn(), randomState: () => 'state', randomNonce: () => 'nonce', randomPKCECodeVerifier: () => 'verifier',
  calculatePKCECodeChallenge: jest.fn(async () => 'challenge'), buildAuthorizationUrl: jest.fn(() => new URL('https://accounts.google.com/authorize')),
  authorizationCodeGrant: jest.fn(),
  enableNonRepudiationChecks: jest.fn(),
};
jest.mock('../../src/models/index', () => mockDb);
jest.mock('../../src/services/authSessionService', () => mockSessions);
jest.mock('../../src/services/socialRegistrationService', () => mockRegistration);
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
  transaction = { provider: 'google', browserHash: browser, expiresAt: new Date(Date.now() + 10000), verifier: 'verifier', nonce: 'nonce', linkUserId: null, rememberMe: false, destroy: jest.fn(), toJSON() { return { ...this }; } };
  identity = { id: 9, userId: 7, update: jest.fn() };
  mockDb.OidcTransaction.findByPk.mockImplementation(async () => transaction);
  mockDb.AuthIdentity.findOne.mockResolvedValue(identity);
  mockDb.AuthIdentity.create.mockResolvedValue(identity);
  mockDb.AuthSession.findOne.mockResolvedValue({});
  mockSessions.loadUser.mockResolvedValue({ id: 7 });
  mockSessions.activeFamily.mockResolvedValue(true);
  mockSessions.readRefreshCookie.mockReturnValue('refresh-cookie');
  mockConfig.serverMetadata.mockReturnValue({ issuer: 'https://accounts.google.com' });
  mockRegistration.prepareSignup.mockResolvedValue({ pendingSignup: true });
  mockClient.discovery.mockResolvedValue(mockConfig);
  mockClient.authorizationCodeGrant.mockResolvedValue({ claims: () => ({ iss: 'https://accounts.google.com', sub: 'subject', aud: 'test-client', email_verified: true, email: 'person@example.com', role: 'ADMIN' }) });
});
afterAll(() => { process.env = original; });

test('start binds state to browser and uses PKCE S256, nonce and fixed callback', async () => {
  const res = response();
  await oidc.begin('google', res);
  expect(res.cookie).toHaveBeenCalledWith('jobfind_oidc_tx', expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
  expect(mockClient.buildAuthorizationUrl).toHaveBeenCalledWith(mockConfig, expect.objectContaining({ state: 'state', nonce: 'nonce', code_challenge: 'challenge', code_challenge_method: 'S256', redirect_uri: process.env.OIDC_GOOGLE_REDIRECT_URI }));
  expect(mockDb.OidcTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ rememberMe: false }));
  expect(mockRegistration.clearSignupCookie).toHaveBeenCalledWith(res);
});
test('callback consumes state once and delegates all token validation checks to OIDC client', async () => {
  const result = await oidc.complete('google', request(), response());
  expect(result).toEqual({ userId: 7, identityId: 9, method: 'oidc:google', linked: false, rememberMe: false });
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
test('an unlinked identity only starts browser-bound onboarding without provisioning or merging an account', async () => {
  mockDb.AuthIdentity.findOne.mockResolvedValue(null);
  const res = response();
  await expect(oidc.complete('google', request(), res)).resolves.toEqual({ pendingSignup: true });
  expect(mockRegistration.prepareSignup).toHaveBeenCalledWith('google', expect.objectContaining({ sub: 'subject', email: 'person@example.com' }), false, res);
  expect(mockDb.AuthIdentity.create).not.toHaveBeenCalled();
  expect(mockSessions.loadUser).not.toHaveBeenCalled();
});

test('an existing local email is rejected by onboarding and never implicitly linked', async () => {
  mockDb.AuthIdentity.findOne.mockResolvedValue(null);
  mockRegistration.prepareSignup.mockRejectedValueOnce(new Error('OIDC_ACCOUNT_EXISTS'));
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_ACCOUNT_EXISTS');
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
  expect(mockRegistration.prepareSignup).not.toHaveBeenCalled();
});

test.each([false, true])('Auth0 validates issuer and signed ID token and preserves stored rememberMe=%s despite callback tampering', async rememberMe => {
  const issuer = 'https://unit-tenant.eu.auth0.com/';
  const redirect = 'http://localhost:4000/api/auth/sso/auth0/callback';
  Object.assign(process.env, { OIDC_AUTH0_ENABLED: 'true', OIDC_AUTH0_ISSUER: issuer, OIDC_AUTH0_CLIENT_ID: 'auth0-client', OIDC_AUTH0_CLIENT_SECRET: 'auth0-test-secret', OIDC_AUTH0_REDIRECT_URI: redirect });
  mockConfig.serverMetadata.mockReturnValue({ issuer });
  const res = response();
  await oidc.begin('auth0', res, null, null, rememberMe);
  expect(mockClient.discovery).toHaveBeenCalledWith(new URL(issuer), 'auth0-client', 'auth0-test-secret');
  expect(mockDb.OidcTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ provider: 'auth0', rememberMe }));
  expect(mockClient.enableNonRepudiationChecks).toHaveBeenCalledWith(mockConfig);
  expect(mockClient.buildAuthorizationUrl).toHaveBeenCalledWith(mockConfig, expect.objectContaining({ redirect_uri: redirect, scope: 'openid email profile' }));
  transaction.provider = 'auth0'; transaction.rememberMe = rememberMe;
  mockClient.authorizationCodeGrant.mockResolvedValue({ claims: () => ({ iss: issuer, sub: 'auth0|stable-id', aud: ['auth0-client', 'other-audience'], email_verified: true, email: 'user@gmail.com' }) });
  const req = request(); req.query.rememberMe = String(!rememberMe); req.query.issuer = 'https://attacker.invalid/';
  req.headers['x-forwarded-host'] = 'attacker.invalid';
  expect(await oidc.complete('auth0', req, res)).toMatchObject({ method: 'oidc:auth0', rememberMe });
  const callback = mockClient.authorizationCodeGrant.mock.calls[0][1];
  expect(callback.origin + callback.pathname).toBe(redirect);
  expect(callback.searchParams.has('rememberMe')).toBe(false);
  expect(mockDb.AuthIdentity.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { issuer, subject: 'auth0|stable-id' } }));
});

test('OIDC discovery rejects unexpected issuer metadata before exchanging any code', async () => {
  mockConfig.serverMetadata.mockReturnValue({ issuer: 'https://attacker.invalid/' });
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_ISSUER');
  expect(mockClient.authorizationCodeGrant).not.toHaveBeenCalled();
});

test.each([
  { iss: 'https://attacker.invalid', sub: 'subject', aud: 'test-client' },
  { iss: 'https://accounts.google.com', sub: 'subject', aud: 'another-client' },
  { iss: 'https://accounts.google.com', sub: '', aud: 'test-client' },
])('invalid claims cannot reach account lookup or onboarding: %j', async claims => {
  mockClient.authorizationCodeGrant.mockResolvedValue({ claims: () => claims });
  await expect(oidc.complete('google', request(), response())).rejects.toThrow('OIDC_ID_TOKEN');
  expect(mockDb.AuthIdentity.findOne).not.toHaveBeenCalled();
  expect(mockRegistration.prepareSignup).not.toHaveBeenCalled();
});
