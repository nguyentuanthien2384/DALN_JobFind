import { afterEach, expect, test, vi } from 'vitest';
import express from 'express';
import { createAuthProxy, authProxyPathGuard } from '../api-gateway/src/middlewares/authProxy.js';
const servers = [];
const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  servers.push(server);
});

test('forwards callback query parameters and multiple cookie headers without merging them', async () => {
  const upstream = express();
  const callback = vi.fn((req, res) => {
    res.setHeader('Set-Cookie', [
      'jobfind_rt=opaque; Path=/api/auth; HttpOnly; SameSite=Lax',
      'jobfind_sso=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    ]);
    res.redirect(303, '/account');
  });
  upstream.get('/api/auth/sso/google/callback', callback);
  const gateway = express();
  gateway.use('/api/auth', authProxyPathGuard, createAuthProxy(await listen(upstream)));
  const base = await listen(gateway);
  const query = '?code=authorization%2Bcode%3D&state=state%2Fvalue';

  const response = await fetch(base + '/api/auth/sso/google/callback' + query, { redirect: 'manual' });

  expect(callback).toHaveBeenCalledOnce();
  expect(callback.mock.calls[0][0].originalUrl).toBe('/api/auth/sso/google/callback' + query);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/account');
  expect(response.headers.getSetCookie()).toEqual([
    'jobfind_rt=opaque; Path=/api/auth; HttpOnly; SameSite=Lax',
    'jobfind_sso=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
  ]);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

test.each(['%252e%252e/admin', 'login%252fadmin', 'login%00', 'login%5cadmin'])(
  'rejects ambiguous authentication path %s before it reaches the backend', async (path) => {
    const upstream = express();
    const received = vi.fn((_req, res) => res.json({ errCode: 0 }));
    upstream.use(received);
    const gateway = express();
    gateway.use('/api/auth', authProxyPathGuard, createAuthProxy(await listen(upstream)));
    const base = await listen(gateway);

    const response = await fetch(base + '/api/auth/' + path);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errCode: 400, errMessage: 'Invalid auth path' });
    expect(received).not.toHaveBeenCalled();
  },
);

test('returns a bounded authentication failure when the upstream connection is refused', async () => {
  const target = await listen(express());
  const unavailable = servers.pop();
  await new Promise(resolve => unavailable.close(resolve));
  const gateway = express();
  gateway.use('/api/auth', authProxyPathGuard, createAuthProxy(target));
  const base = await listen(gateway);

  const response = await fetch(base + '/api/auth/refresh', { method: 'POST' });

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ errCode: 502, errMessage: 'Không kết nối được máy chủ xác thực' });
});
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))); });

test('auth proxy preserves refresh cookies, redirects, body and status while stripping forged identity', async () => {
  const upstream = express(); upstream.use(express.json());
  upstream.post('/api/auth/login', (req, res) => {
    expect(req.body).toEqual({ phonenumber: '0900000001', password: 'fixture' });
    for (const key of ['x-user-id', 'x-user-role', 'x-company-id', 'x-company-status', 'x-company-censor', 'x-internal-secret']) expect(req.headers[key]).toBeUndefined();
    // Backend limits count the client IP the Gateway resolved, never a client-sent X-Forwarded-For.
    expect(req.headers['x-forwarded-for']).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    res.cookie('jobfind_rt', 'opaque-fixture', { httpOnly: true, sameSite: 'lax' }).json({ errCode: 0 });
  });
  upstream.get('/api/auth/sso/google/start', (_req, res) => res.redirect(302, 'https://accounts.google.com/example'));
  upstream.post('/api/auth/refresh', (_req, res) => res.status(401).json({ errCode: 401 }));
  const target = await listen(upstream);
  const gateway = express(); gateway.use(express.json());
  gateway.use('/api/auth', authProxyPathGuard, createAuthProxy(target));
  const base = await listen(gateway);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': '1', 'x-user-role': 'ADMIN', 'x-company-id': '5', 'x-company-status': 'S1', 'x-company-censor': 'CS1', 'x-internal-secret': 'forged', 'x-forwarded-for': '203.0.113.66' }, body: JSON.stringify({ phonenumber: '0900000001', password: 'fixture' }) });
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('HttpOnly');
  expect(login.headers.get('cache-control')).toBe('no-store');
  const redirect = await fetch(base + '/api/auth/sso/google/start', { redirect: 'manual' });
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe('https://accounts.google.com/example');
  expect((await fetch(base + '/api/auth/refresh', { method: 'POST' })).status).toBe(401);
});
