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
    mockVerify.mockImplementation((token, secret, callback) => callback(new Error('bad')));
    const req = createRequest({ headers: { authorization: 'Bearer broken' } });
    const res = createResponse();
    const next = jest.fn();
    middleware[method](req, res, next);
    await flush();
    expect(mockVerify).toHaveBeenCalledWith('broken', expect.anything(), expect.any(Function));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }));
  });

  test('verifyTokenUser loads the current user and continues', async () => {
    mockVerify.mockImplementation((token, secret, callback) => callback(null, { sub: 42 }));
    const user = { id: 42, companyId: 8, userAccountData: { roleCode: 'CANDIDATE' } };
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
    mockVerify.mockImplementation((token, secret, callback) => callback(null, { sub: 99 }));
    mockFindUser.mockResolvedValue(null);
    const res = createResponse();
    const next = jest.fn();
    middleware.verifyTokenUser(createRequest({ headers: { authorization: 'Bearer valid' } }), res, next);
    await flush();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  test('verifyTokenAdmin permits admins and rejects non-admin users', async () => {
    mockVerify.mockImplementation((token, secret, callback) => callback(null, { sub: 1 }));
    const req = createRequest({ headers: { authorization: 'Bearer valid' } });
    const admin = { id: 1, userAccountData: { roleCode: 'ADMIN' } };
    mockFindUser.mockResolvedValueOnce(admin);
    const res = createResponse();
    const next = jest.fn();
    middleware.verifyTokenAdmin(req, res, next);
    await flush();
    expect(req.user).toBe(admin);
    expect(next).toHaveBeenCalled();

    mockFindUser.mockResolvedValueOnce({ id: 1, userAccountData: { roleCode: 'EMPLOYER' } });
    const deniedRes = createResponse();
    const deniedNext = jest.fn();
    middleware.verifyTokenAdmin(createRequest({ headers: { authorization: 'Bearer valid' } }), deniedRes, deniedNext);
    await flush();
    expect(deniedRes.status).toHaveBeenCalledWith(404);
    expect(deniedRes.json).toHaveBeenCalledWith(expect.objectContaining({ errMessage: 'Permission denied' }));
  });

  test('verifyTokenAdmin rejects a deleted admin account', async () => {
    mockVerify.mockImplementation((token, secret, callback) => callback(null, { sub: 1 }));
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

    mockVerify.mockImplementationOnce((token, secret, callback) => callback(new Error('bad')));
    const nextInvalid = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: { authorization: 'Bearer bad' } }), createResponse(), nextInvalid);
    expect(nextInvalid).toHaveBeenCalled();

    mockVerify.mockImplementationOnce((token, secret, callback) => callback(null, { sub: 3 }));
    mockFindUser.mockResolvedValueOnce(null);
    const nextMissing = jest.fn();
    middleware.verifyTokenOptional(createRequest({ headers: { authorization: 'Bearer ok' } }), createResponse(), nextMissing);
    await flush();
    expect(nextMissing).toHaveBeenCalled();
  });

  test('verifyTokenOptional attaches a valid user and tolerates database errors', async () => {
    mockVerify.mockImplementation((token, secret, callback) => callback(null, { sub: 3 }));
    const user = { id: 3 };
    mockFindUser.mockResolvedValueOnce(user);
    const req = createRequest({ headers: { authorization: 'Bearer ok' } });
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
});
