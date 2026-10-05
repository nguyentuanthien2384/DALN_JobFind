const crypto = require('crypto');
const mockPending = new Map();
const mockAccounts = [];
const mockIdentities = [];
const mockFindUsers = jest.fn();
const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockCreateAccount = jest.fn();
const mockFindPending = jest.fn(async key => mockPending.get(key) || null);
const mockDestroyPending = jest.fn();
const mockCreatePending = jest.fn(async data => {
  const row = { ...data, destroy: jest.fn(async () => mockPending.delete(data.tokenHash)) };
  mockPending.set(data.tokenHash, row);
  return row;
});
const mockCreateIdentity = jest.fn(async data => {
  const row = { id: 51, ...data };
  mockIdentities.push(row);
  return row;
});
const mockFindIdentity = jest.fn(async ({ where }) => mockIdentities.find(row => row.issuer === where.issuer && row.subject === where.subject) || null);
const mockRecordEvent = jest.fn();
const mockTransact = jest.fn(async callback => {
  const snapshot = { pending: new Map(mockPending), accounts: [...mockAccounts], identities: [...mockIdentities] };
  try { return await callback(mockTransaction); }
  catch (error) {
    mockPending.clear(); snapshot.pending.forEach((value, key) => mockPending.set(key, value));
    mockAccounts.splice(0, mockAccounts.length, ...snapshot.accounts);
    mockIdentities.splice(0, mockIdentities.length, ...snapshot.identities);
    throw error;
  }
});
jest.mock('../../src/models/index', () => ({
  sequelize: { transaction: mockTransact },
  Sequelize: {
    Op: { lt: Symbol('lt') },
    col: name => ({ col: name }), fn: (name, ...args) => ({ fn: name, args }), where: (left, right) => ({ left, right }),
  },
  User: { findAll: mockFindUsers },
  AuthSignupRequest: { create: mockCreatePending, findByPk: mockFindPending, destroy: mockDestroyPending },
  AuthIdentity: { create: mockCreateIdentity, findOne: mockFindIdentity },
}));
jest.mock('../../src/services/authSessionService', () => ({ hashOpaque: value => require('crypto').createHash('sha256').update(value).digest('hex') }));
jest.mock('../../src/services/userService', () => ({ createRegisteredAccount: mockCreateAccount }));
jest.mock('../../src/services/authAuditService', () => ({ recordSecurityEvent: mockRecordEvent }));
const registration = require('../../src/services/socialRegistrationService');
const response = () => ({ cookie: jest.fn(), clearCookie: jest.fn() });
const claims = () => ({ iss: 'https://accounts.google.com', sub: 'provider-user-123', email: '  NEW.USER@GMAIL.COM ', email_verified: true, name: 'Nguyen Thi Lan' });
const body = () => ({ firstName: 'Nguyen', lastName: 'Lan', phonenumber: '0912345678', password: 'Sample pass!42', roleCode: 'CANDIDATE' });
const prepare = async (rememberMe = false) => {
  const res = response();
  await registration.prepareSignup('google', claims(), rememberMe, res);
  return { res, req: { headers: { cookie: `unrelated=value; jobfind_signup=${res.cookie.mock.calls[0][1]}` }, body: body() } };
};
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-22T08:00:00Z'));
  jest.clearAllMocks();
  mockPending.clear(); mockAccounts.length = 0; mockIdentities.length = 0;
  mockFindUsers.mockResolvedValue([]);
  mockRecordEvent.mockResolvedValue(undefined);
  mockCreateAccount.mockImplementation(async data => {
    const user = { id: 7, ...data }; mockAccounts.push(user); return user;
  });
});
afterEach(() => jest.useRealTimers());

test.each([false, undefined, 'true'])('unverified or ambiguously verified emails still start registration with an editable email: %s', async verified => {
  await registration.prepareSignup('google', { ...claims(), email_verified: verified }, true, response());
  expect(mockCreatePending).toHaveBeenCalledWith(expect.objectContaining({ email: 'new.user@gmail.com', emailVerified: false }));
  expect(mockCreateAccount).not.toHaveBeenCalled();
});

test.each(['', undefined, 'not-an-email', 'a@example.com'])('missing or invalid provider email starts registration without a prefilled email: %s', async email => {
  await registration.prepareSignup('auth0:github', { ...claims(), email, email_verified: false }, true, response());
  expect(mockCreatePending).toHaveBeenCalledWith(expect.objectContaining({ email: null, emailVerified: false }));
  expect(mockFindUsers).not.toHaveBeenCalled();
});

test('unverified signup completes with the typed email, validated by the shared account helper', async () => {
  const res = response();
  await registration.prepareSignup('auth0:github', { ...claims(), email: undefined, email_verified: false }, true, res);
  const req = { headers: { cookie: `jobfind_signup=${res.cookie.mock.calls[0][1]}` }, body: { ...body(), email: 'typed@gmail.com' } };
  expect(await registration.signupProfile(req)).toMatchObject({ profile: { provider: 'auth0:github', email: '', emailVerified: false } });
  await registration.completeSignup(req);
  expect(mockCreateAccount).toHaveBeenCalledWith({ ...body(), email: 'typed@gmail.com' }, { transaction: mockTransaction });
  expect(mockCreateIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: 'auth0:github', emailAtLink: null, emailVerifiedAtLink: false }), { transaction: mockTransaction });
});

test('a provider-verified email signs in to the existing account by linking the identity once', async () => {
  mockFindUsers.mockResolvedValue([{ id: 99 }]);
  const linked = await registration.linkVerifiedEmail('auth0:google', claims());
  expect(mockFindUsers.mock.calls[0][0]).toMatchObject({ where: { right: 'new.user@gmail.com' }, limit: 2, transaction: mockTransaction });
  expect(linked).toMatchObject({ userId: 99, provider: 'auth0:google', subject: 'provider-user-123', emailAtLink: 'new.user@gmail.com', emailVerifiedAtLink: true });
  expect(mockRecordEvent).toHaveBeenCalledWith({ event: 'identity_linked', userId: 99 }, mockTransaction);
  expect(await registration.linkVerifiedEmail('auth0:google', claims())).toBe(linked);
  expect(mockCreateIdentity).toHaveBeenCalledTimes(1);
});

test.each([
  ['google', { email_verified: false }],
  ['google', { email_verified: 'true' }],
  ['google', { email: 'not-an-email' }],
  ['auth0', {}],
])('no link to an existing account for %s with %j', async (provider, override) => {
  mockFindUsers.mockResolvedValue([{ id: 99 }]);
  expect(await registration.linkVerifiedEmail(provider, { ...claims(), ...override })).toBeNull();
  expect(mockFindUsers).not.toHaveBeenCalled();
  expect(mockCreateIdentity).not.toHaveBeenCalled();
});

test('a verified email without a JobFind account is left for registration', async () => {
  expect(await registration.linkVerifiedEmail('github', claims())).toBeNull();
  expect(mockCreateIdentity).not.toHaveBeenCalled();
});

test('a verified email shared by legacy duplicate accounts is not linked to either', async () => {
  mockFindUsers.mockResolvedValue([{ id: 99 }, { id: 100 }]);
  await expect(registration.linkVerifiedEmail('auth0:google', claims())).rejects.toThrow('OIDC_ACCOUNT_EXISTS');
  expect(mockCreateIdentity).not.toHaveBeenCalled();
});

test('onboarding is bound to an opaque HttpOnly cookie and only its hash is stored for ten minutes', async () => {
  const { req, res } = await prepare(false);
  const raw = res.cookie.mock.calls[0][1];
  expect(raw).toMatch(/^[A-Za-z0-9_-]{64}$/);
  expect(res.cookie).toHaveBeenCalledWith('jobfind_signup', raw, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/sso', maxAge: 600000,
  });
  const saved = mockCreatePending.mock.calls[0][0];
  expect(saved.tokenHash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
  expect(saved.expiresAt.getTime() - Date.now()).toBe(600000);
  expect(JSON.stringify(saved)).not.toContain(raw);
  expect(await registration.signupProfile(req)).toEqual({ profile: { provider: 'google', email: 'new.user@gmail.com', emailVerified: true, firstName: 'Nguyen', lastName: 'Thi Lan' }, rememberMe: false });
});

test.each(['', 'jobfind_signup=short', `jobfind_signup=${'x'.repeat(64)}`, `jobfind_signup=%${'x'.repeat(63)}`])('missing, malformed or foreign browser cookie cannot read or consume signup: %s', async cookie => {
  await prepare();
  const req = { headers: { cookie }, body: body() };
  await expect(registration.signupProfile(req)).rejects.toMatchObject({ status: 410 });
  await expect(registration.completeSignup(req)).rejects.toMatchObject({ status: 410 });
  expect(mockCreateAccount).not.toHaveBeenCalled();
});

test('an expired signup request cannot be read or completed even if its cookie remains', async () => {
  const { req } = await prepare();
  jest.advanceTimersByTime(600000);
  await expect(registration.signupProfile(req)).rejects.toMatchObject({ status: 410 });
  await expect(registration.completeSignup(req)).rejects.toMatchObject({ status: 410 });
  expect(mockCreateAccount).not.toHaveBeenCalled();
});

test('completion uses only allowed form fields and server-side email, identity and persistence', async () => {
  const { req } = await prepare(false);
  req.body = { ...body(), email: 'attacker@gmail.com', companyId: 999, provider: 'github', issuer: 'malicious', subject: 'another', rememberMe: true, statusCode: 'S1', isAdmin: true };
  const result = await registration.completeSignup(req);
  expect(mockCreateAccount).toHaveBeenCalledWith({ ...body(), email: 'new.user@gmail.com' }, { transaction: mockTransaction });
  expect(mockCreateIdentity).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, provider: 'google', issuer: 'https://accounts.google.com', subject: 'provider-user-123', emailAtLink: 'new.user@gmail.com', emailVerifiedAtLink: true }), { transaction: mockTransaction });
  expect(mockFindPending).toHaveBeenLastCalledWith(expect.any(String), { raw: false, transaction: mockTransaction, lock: 'UPDATE' });
  expect(result).toEqual({ userId: 7, identityId: 51, method: 'oidc:google', rememberMe: false });
  expect(mockRecordEvent).toHaveBeenCalledWith({ event: 'identity_linked', userId: 7 }, mockTransaction);
  await expect(registration.completeSignup(req)).rejects.toMatchObject({ status: 410 });
  expect(mockAccounts).toHaveLength(1);
  expect(mockIdentities).toHaveLength(1);
});

test('role validation is delegated to the shared account helper and cannot be bypassed on a helper rejection', async () => {
  const { req } = await prepare();
  req.body.roleCode = 'ADMIN';
  mockCreateAccount.mockRejectedValueOnce(Object.assign(new Error('Invalid public role'), { status: 400 }));
  await expect(registration.completeSignup(req)).rejects.toMatchObject({ status: 400 });
  expect(mockCreateAccount.mock.calls[0][0].roleCode).toBe('ADMIN');
  expect(mockCreateIdentity).not.toHaveBeenCalled();
  expect(mockPending.size).toBe(1);
});

test('identity linked by another flow is rejected without creating an account', async () => {
  const { req } = await prepare();
  mockIdentities.push({ issuer: claims().iss, subject: claims().sub, userId: 99 });
  await expect(registration.completeSignup(req)).rejects.toMatchObject({ status: 409 });
  expect(mockCreateAccount).not.toHaveBeenCalled();
  expect(mockPending.size).toBe(1);
});

test('transaction failure after account and identity creation rolls back consumption so the user can retry', async () => {
  const { req } = await prepare();
  mockRecordEvent.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(registration.completeSignup(req)).rejects.toThrow('database unavailable');
  expect(mockAccounts).toHaveLength(0);
  expect(mockIdentities).toHaveLength(0);
  expect(mockPending.size).toBe(1);
  await expect(registration.completeSignup(req)).resolves.toMatchObject({ userId: 7, identityId: 51 });
  expect(mockAccounts).toHaveLength(1);
  expect(mockPending.size).toBe(0);
});

test('clearing the signup cookie uses the same security flags and path', () => {
  const res = response();
  registration.clearSignupCookie(res);
  expect(res.clearCookie).toHaveBeenCalledWith('jobfind_signup', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/sso',
  });
});
