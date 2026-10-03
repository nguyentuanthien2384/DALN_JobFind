// Session-bound access tokens under production settings (legacy session-less tokens OFF).
// tests/setupEnv.js enables legacy tokens for older fixtures, so these cases reset it.
const mockVerify = jest.fn();
const mockFindUser = jest.fn();
const mockActiveFamily = jest.fn();

jest.mock('jsonwebtoken', () => ({ verify: mockVerify }));
jest.mock('../../src/models/index', () => ({ User: { findOne: mockFindUser }, Account: {}, Company: {} }));
jest.mock('../../src/services/authSessionService', () => ({ activeFamily: mockActiveFamily }));

const middleware = require('../../src/middlewares/jwtVerify');
const { createRequest, createResponse } = require('../helpers/http');

const flush = () => new Promise((resolve) => setImmediate(resolve));
const tokenTimes = () => { const iat = Math.floor(Date.now() / 1000); return { iat, exp: iat + 900 }; };
const signedAs = (claims) => mockVerify.mockImplementation((token, secret, options, callback) => callback(null, claims));
const run = async (method, authorization = 'Bearer token') => {
  const req = createRequest({ headers: { authorization }, user: undefined });
  const res = createResponse();
  const next = jest.fn();
  middleware[method](req, res, next);
  await flush();
  return { req, res, next };
};
const activeUser = (roleCode = 'ADMIN') => ({ id: 42, companyId: null, userAccountData: { roleCode, statusCode: 'S1' } });

describe('JWT middleware session binding (production settings)', () => {
  const legacy = process.env.AUTH_ALLOW_LEGACY_TOKENS;
  beforeEach(() => {
    delete process.env.AUTH_ALLOW_LEGACY_TOKENS;
    mockVerify.mockReset();
    mockFindUser.mockReset();
    mockActiveFamily.mockReset();
  });
  afterAll(() => { process.env.AUTH_ALLOW_LEGACY_TOKENS = legacy; });

  test.each(['verifyTokenUser', 'verifyTokenAdmin'])('%s rejects a token whose session was revoked (logout, password change)', async (method) => {
    signedAs({ sub: 42, sid: 'family-1', ...tokenTimes() });
    mockActiveFamily.mockResolvedValue(false);
    const { res, next } = await run(method);
    expect(mockActiveFamily).toHaveBeenCalledWith('family-1', 42);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ status: false, errMessage: 'Session revoked', refresh: true });
    expect(mockFindUser).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['verifyTokenUser', 'verifyTokenAdmin'])('%s rejects a session-less legacy token when the migration switch is off', async (method) => {
    signedAs({ sub: 42, ...tokenTimes() });
    const { res, next } = await run(method);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errMessage: 'Session revoked' }));
    expect(mockActiveFamily).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test.each(['verifyTokenUser', 'verifyTokenAdmin'])('%s accepts an active session and records it on the request', async (method) => {
    signedAs({ sub: '42', sid: 'family-1', ...tokenTimes() });
    mockActiveFamily.mockResolvedValue(true);
    mockFindUser.mockResolvedValue(activeUser());
    const { req, next } = await run(method);
    expect(req.auth).toEqual({ sid: 'family-1', sub: 42 });
    expect(req.user).toEqual(activeUser());
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('verifyTokenOptional treats a revoked session as an anonymous visitor', async () => {
    signedAs({ sub: 42, sid: 'family-1', ...tokenTimes() });
    mockActiveFamily.mockResolvedValue(false);
    const { req, next } = await run('verifyTokenOptional');
    expect(req.user).toBeUndefined();
    expect(req.auth).toBeUndefined();
    expect(mockFindUser).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('verifyTokenOptional treats a session-store failure as anonymous instead of failing the page', async () => {
    signedAs({ sub: 42, sid: 'family-1', ...tokenTimes() });
    mockActiveFamily.mockRejectedValue(new Error('redis down'));
    const { req, next } = await run('verifyTokenOptional');
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each(['verifyTokenUser', 'verifyTokenAdmin'])('%s fails closed with 500 when the session store is unavailable', async (method) => {
    signedAs({ sub: 42, sid: 'family-1', ...tokenTimes() });
    mockActiveFamily.mockRejectedValue(new Error('db down'));
    const { res, next } = await run(method);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['a lifetime above the 15 minute policy', (t) => ({ sub: 42, sid: 'f', iat: t, exp: t + 901 })],
    ['no expiry', (t) => ({ sub: 42, sid: 'f', iat: t })],
    ['a subject of 0', (t) => ({ sub: 0, sid: 'f', iat: t, exp: t + 900 })],
    ['a non-numeric subject', (t) => ({ sub: 'admin', sid: 'f', iat: t, exp: t + 900 })],
  ])('rejects a correctly signed token with %s before any session or user lookup', async (_case, build) => {
    signedAs(build(Math.floor(Date.now() / 1000)));
    for (const method of ['verifyTokenUser', 'verifyTokenAdmin']) {
      const { res, next } = await run(method);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errMessage: 'Token is not valid!' }));
      expect(next).not.toHaveBeenCalled();
    }
    const optional = await run('verifyTokenOptional');
    expect(optional.req.user).toBeUndefined();
    expect(optional.next).toHaveBeenCalledTimes(1);
    expect(mockActiveFamily).not.toHaveBeenCalled();
    expect(mockFindUser).not.toHaveBeenCalled();
  });

  test('treats an account row without account data as inactive', async () => {
    signedAs({ sub: 42, sid: 'family-1', ...tokenTimes() });
    mockActiveFamily.mockResolvedValue(true);
    mockFindUser.mockResolvedValue({ id: 42, userAccountData: null });
    const { res, next } = await run('verifyTokenUser');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

// The frontend axios interceptor reads `refresh` to decide between a silent token refresh and
// a hard sign-out, so the exact failure bodies are an API contract.
describe('JWT middleware failure bodies (frontend contract)', () => {
  beforeEach(() => {
    process.env.AUTH_ALLOW_LEGACY_TOKENS = 'true';
    mockVerify.mockReset();
    mockFindUser.mockReset();
    mockActiveFamily.mockReset();
  });
  afterAll(() => { process.env.AUTH_ALLOW_LEGACY_TOKENS = 'true'; });

  test('a missing token asks the client to refresh', () => {
    for (const [method, body] of [
      ['verifyTokenUser', { status: false, message: "You're not authentication!", refresh: true }],
      ['verifyTokenAdmin', { status: false, errMessage: "You're not authentication!", refresh: true }],
    ]) {
      const res = createResponse();
      middleware[method](createRequest({ headers: {} }), res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(body);
    }
  });

  test.each(['verifyTokenUser', 'verifyTokenAdmin'])('%s returns the exact body for each failure', async (method) => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(new Error('bad')));
    let { res } = await run(method);
    expect(res.json).toHaveBeenLastCalledWith({ status: false, errMessage: 'Token is not valid!', refresh: true });

    signedAs({ sub: 42, ...tokenTimes() });
    mockFindUser.mockResolvedValueOnce(null);
    ({ res } = await run(method));
    expect(res.json).toHaveBeenLastCalledWith({ status: false, errMessage: 'User is not exits', refresh: true });

    mockFindUser.mockResolvedValueOnce({ id: 42, userAccountData: { roleCode: 'ADMIN', statusCode: 'S2' } });
    ({ res } = await run(method));
    expect(res.status).toHaveBeenLastCalledWith(403);
    expect(res.json).toHaveBeenLastCalledWith({ status: false, errMessage: 'Account is not active', authReason: 'inactive', refresh: true });

    mockFindUser.mockRejectedValueOnce(new Error('db down'));
    ({ res } = await run(method));
    expect(res.status).toHaveBeenLastCalledWith(500);
    expect(res.json).toHaveBeenLastCalledWith({ status: false, errMessage: 'Unable to verify account' });
  });

  test('a signed-in non-admin is denied without being told to refresh', async () => {
    signedAs({ sub: 42, ...tokenTimes() });
    mockFindUser.mockResolvedValue(activeUser('EMPLOYER'));
    const { res, next } = await run('verifyTokenAdmin');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ status: false, errMessage: 'Permission denied', refresh: false });
    expect(next).not.toHaveBeenCalled();
  });

  test('loads only the identity fields it needs, as one flat row', async () => {
    signedAs({ sub: 42, ...tokenTimes() });
    mockFindUser.mockResolvedValue(activeUser('CANDIDATE'));
    await run('verifyTokenUser');
    await run('verifyTokenOptional');
    for (const [query] of mockFindUser.mock.calls) {
      expect(query).toMatchObject({ where: { id: 42 }, attributes: ['id', 'companyId'], raw: true, nest: true });
      expect(query.include[1]).toMatchObject({ as: 'userCompanyData', required: false });
    }
    expect(mockFindUser.mock.calls).toHaveLength(2);
  });
});
