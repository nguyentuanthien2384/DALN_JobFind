const mockVerify = jest.fn();
const mockFindUser = jest.fn();

jest.mock('jsonwebtoken', () => ({ verify: mockVerify }));
jest.mock('../../src/models/index', () => ({
  User: { findOne: mockFindUser },
  Account: {}
}));

const middleware = require('../../src/middlewares/jwtVerify');
const { createRequest, createResponse } = require('../helpers/http');

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('JWT middleware', () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockFindUser.mockReset();
  });

  test.each([
    ['verifyTokenUser'],
    ['verifyTokenAdmin']
  ])('%s rejects a missing token', (method) => {
    const req = createRequest({ headers: {} });
    const res = createResponse();
    const next = jest.fn();
    middleware[method](req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['verifyTokenUser'],
    ['verifyTokenAdmin']
  ])('%s rejects an invalid token', async (method) => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(new Error('bad')));
    const req = createRequest({ headers: { authorization: 'Bearer broken' } });
    const res = createResponse();
    const next = jest.fn();
    middleware[method](req, res, next);
    await flush();
    expect(mockVerify).toHaveBeenCalledWith('broken', expect.anything(), expect.objectContaining({ algorithms: ['HS256'] }), expect.any(Function));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }));
  });

  test('verifyTokenUser loads the current user and continues', async () => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 42, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    const user = { id: 42, companyId: 8, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } };
    mockFindUser.mockResolvedValue(user);
    const req = createRequest({ headers: { authorization: 'Bearer valid' } });
    const res = createResponse();
    const next = jest.fn();
    middleware.verifyTokenUser(req, res, next);
    await flush();
    expect(mockFindUser).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 }, raw: true }));
    expect(req.user).toBe(user);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('verifyTokenUser rejects a token for a deleted user', async () => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 99, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    mockFindUser.mockResolvedValue(null);
    const res = createResponse();
    const next = jest.fn();
    middleware.verifyTokenUser(createRequest({ headers: { authorization: 'Bearer valid' } }), res, next);
    await flush();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['verifyTokenUser', 'CANDIDATE'],
    ['verifyTokenAdmin', 'ADMIN']
  ])('%s rejects a token after the account is disabled', async (method, roleCode) => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 42, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    mockFindUser.mockResolvedValue({
      id: 42,
      userAccountData: { roleCode, statusCode: 'S2' }
    });
    const res = createResponse();
    const next = jest.fn();
    middleware[method](createRequest({ headers: { authorization: 'Bearer valid' } }), res, next);
    await flush();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      errMessage: 'Account is not active',
      refresh: true
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['verifyTokenUser'],
    ['verifyTokenAdmin']
  ])('%s returns a controlled error when account lookup fails', async (method) => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 42, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    mockFindUser.mockRejectedValue(new Error('db down'));
    const res = createResponse();
    const next = jest.fn();
    middleware[method](createRequest({ headers: { authorization: 'Bearer valid' } }), res, next);
    await flush();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errMessage: 'Unable to verify account' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('verifyTokenAdmin permits admins and rejects non-admin users', async () => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 1, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    const req = createRequest({ headers: { authorization: 'Bearer valid' } });
    const admin = { id: 1, userAccountData: { roleCode: 'ADMIN', statusCode: 'S1' } };
    mockFindUser.mockResolvedValueOnce(admin);
    const res = createResponse();
    const next = jest.fn();
    middleware.verifyTokenAdmin(req, res, next);
    await flush();
    expect(req.user).toBe(admin);
    expect(next).toHaveBeenCalled();

    mockFindUser.mockResolvedValueOnce({ id: 1, userAccountData: { roleCode: 'EMPLOYER', statusCode: 'S1' } });
    const deniedRes = createResponse();
    const deniedNext = jest.fn();
    middleware.verifyTokenAdmin(createRequest({ headers: { authorization: 'Bearer valid' } }), deniedRes, deniedNext);
    await flush();
    expect(deniedRes.status).toHaveBeenCalledWith(403);
    expect(deniedRes.json).toHaveBeenCalledWith(expect.objectContaining({ errMessage: 'Permission denied', refresh: false }));
  });

  test('verifyTokenAdmin rejects a deleted admin account', async () => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 1, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    mockFindUser.mockResolvedValue(null);
    const res = createResponse();
    middleware.verifyTokenAdmin(createRequest({ headers: { authorization: 'Bearer valid' } }), res, jest.fn());
    await flush();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ errMessage: 'User is not exits' }));
  });

  test('verifyTokenOptional always continues for absent, malformed, invalid and missing-user tokens', async () => {
    const nextAbsent = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: {} }), createResponse(), nextAbsent);
    expect(nextAbsent).toHaveBeenCalled();

    const nextMalformed = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: { authorization: 'Bearer' } }), createResponse(), nextMalformed);
    expect(nextMalformed).toHaveBeenCalled();

    mockVerify.mockImplementationOnce((token, secret, options, callback) => callback(new Error('bad')));
    const nextInvalid = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: { authorization: 'Bearer bad' } }), createResponse(), nextInvalid);
    expect(nextInvalid).toHaveBeenCalled();

    mockVerify.mockImplementationOnce((token, secret, options, callback) => callback(null, { sub: 3, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    mockFindUser.mockResolvedValueOnce(null);
    const nextMissing = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: { authorization: 'Bearer ok' } }), createResponse(), nextMissing);
    await flush();
    expect(nextMissing).toHaveBeenCalled();
  });

  test('verifyTokenOptional attaches a valid user and tolerates database errors', async () => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 3, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    const user = { id: 3, userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S1' } };
    mockFindUser.mockResolvedValueOnce(user);
    const req = createRequest({ headers: { authorization: 'Bearer ok' }, user: undefined });
    const next = jest.fn();
    middleware.verifyTokenOptional(req, createResponse(), next);
    await flush();
    expect(req.user).toBe(user);
    expect(next).toHaveBeenCalled();

    mockFindUser.mockRejectedValueOnce(new Error('db down'));
    const fallbackNext = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: { authorization: 'Bearer ok' } }), createResponse(), fallbackNext);
    await flush();
    expect(fallbackNext).toHaveBeenCalled();
  });

  test('verifyTokenOptional treats a disabled account as an anonymous visitor', async () => {
    mockVerify.mockImplementation((token, secret, options, callback) => callback(null, { sub: 3, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900 }));
    mockFindUser.mockResolvedValue({
      id: 3,
      userAccountData: { roleCode: 'CANDIDATE', statusCode: 'S2' }
    });
    const req = createRequest({ headers: { authorization: 'Bearer ok' }, user: undefined });
    const next = jest.fn();
    middleware.verifyTokenOptional(req, createResponse(), next);
    await flush();
    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
