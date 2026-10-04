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

describe('rate limit buckets follow the matched route, not the raw URL', () => {
  const { createRateLimiter: create } = require('../../src/middlewares/rateLimit');
  let seq = 0;
  const call = (limiter, req) => {
    const res = createResponse();
    const next = jest.fn();
    limiter({ ip: '10.9.9.9', ...req }, res, next);
    return { res, next };
  };

  test('case and trailing-slash variants of one route share a single budget', () => {
    seq += 1;
    const limiter = create({ windowMs: 60_000, max: 2 });
    const route = { path: `/api/variant-${seq}` };
    expect(call(limiter, { path: `/api/variant-${seq}`, route }).next).toHaveBeenCalled();
    expect(call(limiter, { path: `/API/Variant-${seq}/`, route }).next).toHaveBeenCalled();
    expect(call(limiter, { path: `/api/VARIANT-${seq}`, route }).res.status).toHaveBeenCalledWith(429);
  });

  test('includes the router mount path so equal sub-routes of different routers stay separate', () => {
    seq += 1;
    const limiter = create({ windowMs: 60_000, max: 1 });
    const route = { path: `/login-${seq}` };
    expect(call(limiter, { path: route.path, baseUrl: '/api/a', route }).next).toHaveBeenCalled();
    expect(call(limiter, { path: route.path, baseUrl: '/api/b', route }).next).toHaveBeenCalled();
    expect(call(limiter, { path: route.path, baseUrl: '/api/a', route }).res.status).toHaveBeenCalledWith(429);
  });

  test('normalises the path when used outside a route (app.use)', () => {
    seq += 1;
    const limiter = create({ windowMs: 60_000, max: 1 });
    expect(call(limiter, { path: `/api/mount-${seq}` }).next).toHaveBeenCalled();
    expect(call(limiter, { path: `/API/MOUNT-${seq}//` }).res.status).toHaveBeenCalledWith(429);
  });

  test('a real Express app cannot bypass the login limiter with URL variants', async () => {
    jest.resetModules();
    const express = require('express');
    const { loginLimiter } = require('../../src/middlewares/rateLimit');
    const app = express();
    app.post('/api/login', loginLimiter, (req, res) => res.json({ errCode: 1, errMessage: 'wrong password' }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const statuses = [];
      for (const variant of ['/api/login', '/api/login/', '/api/LOGIN', '/API/Login/']) {
        for (let i = 0; i < 4; i += 1) statuses.push((await fetch(base + variant, { method: 'POST' })).status);
      }
      expect(statuses.filter((status) => status === 200)).toHaveLength(10);
      expect(statuses.slice(10).every((status) => status === 429)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('rate limit window boundaries', () => {
  test('counts a request at exactly resetAt in the old window and starts a new one 1ms later', () => {
    const now = jest.spyOn(Date, 'now');
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    const req = { path: '/boundary', ip: '10.1.1.1' };
    now.mockReturnValue(5000);
    expect(invokeRaw(limiter, req).next).toHaveBeenCalled();
    now.mockReturnValue(6000);
    const atReset = invokeRaw(limiter, req);
    expect(atReset.res.status).toHaveBeenCalledWith(429);
    expect(atReset.res.setHeader).toHaveBeenCalledWith('Retry-After', 0);
    now.mockReturnValue(6001);
    expect(invokeRaw(limiter, req).next).toHaveBeenCalled();
    now.mockRestore();
  });

  test('reports Retry-After as the remaining window rounded up to seconds', () => {
    const now = jest.spyOn(Date, 'now');
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 });
    const req = { path: '/retry-after', ip: '10.1.1.2' };
    now.mockReturnValue(1_000);
    invokeRaw(limiter, req);
    now.mockReturnValue(2_500);
    const blocked = invokeRaw(limiter, req);
    expect(blocked.res.setHeader).toHaveBeenCalledWith('Retry-After', 9);
    expect(blocked.res.json).toHaveBeenCalledWith({ errCode: 429, errMessage: 'Bạn thao tác quá nhanh, vui lòng thử lại sau 9 giây' });
    now.mockRestore();
  });

  test('a success never drives the failure counter below zero', () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1, countOnlyFailures: true });
    const req = { path: '/never-negative', ip: '10.1.1.3' };
    const first = invokeRaw(limiter, req);
    first.res.json({ errCode: 0 });
    first.res.json({ errCode: 0 });
    invokeRaw(limiter, req).res.json({ errCode: 1 });
    expect(invokeRaw(limiter, req).res.status).toHaveBeenCalledWith(429);
  });
});

// The configured policies are security requirements: assert them with literal numbers.
describe('configured limiter policies', () => {
  let limiters;
  let now;
  beforeEach(() => {
    jest.resetModules();
    now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    limiters = require('../../src/middlewares/rateLimit');
  });
  afterEach(() => now.mockRestore());

  test.each([
    ['loginLimiter', 10, 15 * 60, 'Bạn đã đăng nhập sai quá nhiều lần, vui lòng thử lại sau ít phút'],
    ['refreshLimiter', 10, 15 * 60, 'Bạn đã đăng nhập sai quá nhiều lần, vui lòng thử lại sau ít phút'],
    ['otpLimiter', 5, 15 * 60, 'Bạn đã yêu cầu mã xác thực quá nhiều lần, vui lòng thử lại sau ít phút'],
    ['registerLimiter', 10, 60 * 60, 'Bạn đã tạo quá nhiều tài khoản, vui lòng thử lại sau'],
    ['ssoLimiter', 30, 15 * 60, 'Bạn đã thử xác thực SSO quá nhiều lần. Vui lòng thử lại sau ít phút'],
    ['phoneCheckLimiter', 30, 15 * 60, 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút'],
    ['supportChatLimiter', 8, 60, 'Bạn đã gửi quá nhiều câu hỏi. Vui lòng thử lại sau một phút.'],
  ])('%s allows %i attempts per window of %i seconds', (name, max, windowSeconds, message) => {
    const req = { path: `/policy/${name}`, ip: '10.2.2.2', headers: {} };
    for (let i = 0; i < max; i += 1) {
      const allowed = invokeRaw(limiters[name], req);
      expect(allowed.next).toHaveBeenCalled();
      allowed.res.json({ errCode: 1 });
    }
    const blocked = invokeRaw(limiters[name], req);
    expect(blocked.res.status).toHaveBeenCalledWith(429);
    expect(blocked.res.setHeader).toHaveBeenCalledWith('Retry-After', windowSeconds);
    expect(blocked.res.json).toHaveBeenCalledWith({ errCode: 429, errMessage: message });
    now.mockReturnValue(1_000_000 + windowSeconds * 1000 + 1);
    expect(invokeRaw(limiters[name], req).next).toHaveBeenCalled();
  });

  test.each(['otpLimiter', 'registerLimiter', 'ssoLimiter', 'phoneCheckLimiter', 'supportChatLimiter'])(
    '%s counts successful requests too (a sent OTP or created account is not refunded)', (name) => {
      const req = { path: `/policy/success-${name}`, ip: '10.2.2.4', headers: {} };
      let blocked = null;
      for (let i = 0; i < 40 && !blocked; i += 1) {
        const attempt = invokeRaw(limiters[name], req);
        if (attempt.res.status.mock.calls.length) blocked = i;
        else attempt.res.json({ errCode: 0 });
      }
      expect(blocked).not.toBeNull();
    });

  test('a successful session refresh is not counted against the refresh budget', () => {
    const req = { path: '/policy/refresh-success', ip: '10.2.2.5' };
    for (let i = 0; i < 25; i += 1) {
      const attempt = invokeRaw(limiters.refreshLimiter, req);
      expect(attempt.next).toHaveBeenCalled();
      attempt.res.json({ errCode: 0 });
    }
  });

  test('only failed logins count, so a shared office IP can keep signing in', () => {
    const req = { path: '/policy/login-success', ip: '10.2.2.3' };
    for (let i = 0; i < 25; i += 1) {
      const attempt = invokeRaw(limiters.loginLimiter, req);
      expect(attempt.next).toHaveBeenCalled();
      attempt.res.json({ errCode: 0 });
    }
  });
});

function invokeRaw(limiter, req) {
  const res = createResponse();
  const next = jest.fn();
  limiter({ ...req }, res, next);
  return { res, next };
}

describe('named scopes share one budget across alias routes', () => {
  test('a scoped limiter counts every route it guards together', () => {
    const { createRateLimiter: create } = require('../../src/middlewares/rateLimit');
    const limiter = create({ windowMs: 60_000, max: 2, scope: 'alias-test' });
    expect(invokeRaw(limiter, { path: '/api/a', route: { path: '/api/a' }, ip: '10.3.3.3' }).next).toHaveBeenCalled();
    expect(invokeRaw(limiter, { path: '/api/b', route: { path: '/api/b' }, ip: '10.3.3.3' }).next).toHaveBeenCalled();
    expect(invokeRaw(limiter, { path: '/api/a', route: { path: '/api/a' }, ip: '10.3.3.3' }).res.status).toHaveBeenCalledWith(429);
    expect(invokeRaw(limiter, { path: '/api/a', route: { path: '/api/a' }, ip: '10.3.3.4' }).next).toHaveBeenCalled();
  });

  test('a real app gives /api/login and /api/auth/login one shared budget of 10 failures', async () => {
    jest.resetModules();
    const express = require('express');
    const { loginLimiter, refreshLimiter } = require('../../src/middlewares/rateLimit');
    const app = express();
    const wrongPassword = (req, res) => res.json({ errCode: 1, errMessage: 'wrong password' });
    app.post('/api/login', loginLimiter, wrongPassword);
    app.post('/api/auth/login', loginLimiter, wrongPassword);
    app.post('/api/auth/refresh', refreshLimiter, (req, res) => res.json({ errCode: 0 }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const statuses = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await fetch(`${base}/api/login`, { method: 'POST' })).status);
        statuses.push((await fetch(`${base}/api/auth/login`, { method: 'POST' })).status);
      }
      expect(statuses.filter((status) => status === 200)).toHaveLength(10);
      expect(statuses.slice(10)).toEqual([429, 429]);
      // Exhausting the login budget does not block refreshing an existing session.
      expect((await fetch(`${base}/api/auth/refresh`, { method: 'POST' })).status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
