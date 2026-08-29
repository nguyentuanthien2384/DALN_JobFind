const { createRateLimiter } = require('../../src/middlewares/rateLimit');
const { createRequest, createResponse } = require('../helpers/http');

describe('createRateLimiter', () => {
  let pathSequence = 0;

  const invoke = (limiter, overrides = {}) => {
    const req = createRequest({
      path: `/rate-${pathSequence}`,
      ip: '10.0.0.1',
      ...overrides
    });
    const res = createResponse();
    const next = jest.fn();
    limiter(req, res, next);
    return { req, res, next };
  };

  beforeEach(() => { pathSequence += 1; });

  test('allows requests up to max and blocks the next request with Retry-After', () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 2, message: 'slow down' });
    const path = `/limit-${pathSequence}`;
    expect(invoke(limiter, { path }).next).toHaveBeenCalledTimes(1);
    expect(invoke(limiter, { path }).next).toHaveBeenCalledTimes(1);
    const blocked = invoke(limiter, { path });
    expect(blocked.next).not.toHaveBeenCalled();
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    expect(blocked.res.json).toHaveBeenCalledWith({ errCode: 429, errMessage: 'slow down' });
  });

  test('uses connection address fallback and resets after the window', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1000).mockReturnValueOnce(1000).mockReturnValueOnce(3001);
    const limiter = createRateLimiter({ windowMs: 2000, max: 1 });
    const request = { path: `/reset-${pathSequence}`, ip: '', connection: { remoteAddress: 'x' } };
    expect(invoke(limiter, request).next).toHaveBeenCalled();
    expect(invoke(limiter, request).res.status).toHaveBeenCalledWith(429);
    expect(invoke(limiter, request).next).toHaveBeenCalled();
    now.mockRestore();
  });

  test('successful responses do not consume a failure-only allowance', () => {
    const limiter = createRateLimiter({ windowMs: 10000, max: 1, countOnlyFailures: true });
    const path = `/login-${pathSequence}`;
    const successful = invoke(limiter, { path });
    successful.res.json({ errCode: 0, data: 'ok' });
    const second = invoke(limiter, { path });
    expect(second.next).toHaveBeenCalled();
    second.res.json({ errCode: 1 });
    const blocked = invoke(limiter, { path });
    expect(blocked.res.status).toHaveBeenCalledWith(429);
  });

  test('different IPs and paths have independent buckets', () => {
    const limiter = createRateLimiter({ windowMs: 10000, max: 1 });
    const base = `/independent-${pathSequence}`;
    invoke(limiter, { path: base, ip: 'a' });
    expect(invoke(limiter, { path: base, ip: 'b' }).next).toHaveBeenCalled();
    expect(invoke(limiter, { path: `${base}-other`, ip: 'a' }).next).toHaveBeenCalled();
  });
});
