import { afterEach, expect, test } from 'vitest';
import express from 'express';
import { createAuthProxy, authProxyPathGuard } from '../api-gateway/src/middlewares/authProxy.js';
const servers = [];
const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  servers.push(server);
});
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))); });

test('auth proxy preserves refresh cookies, redirects, body and status while stripping forged identity', async () => {
  const upstream = express(); upstream.use(express.json());
  upstream.post('/api/auth/login', (req, res) => {
    expect(req.body).toEqual({ phonenumber: '0900000001', password: 'fixture' });
    for (const key of ['x-user-id', 'x-user-role', 'x-company-id', 'x-internal-secret']) expect(req.headers[key]).toBeUndefined();
    res.cookie('jobfind_rt', 'opaque-fixture', { httpOnly: true, sameSite: 'lax' }).json({ errCode: 0 });
  });
  upstream.get('/api/auth/sso/google/start', (_req, res) => res.redirect(302, 'https://accounts.google.com/example'));
  upstream.post('/api/auth/refresh', (_req, res) => res.status(401).json({ errCode: 401 }));
  const target = await listen(upstream);
  const gateway = express(); gateway.use(express.json());
  gateway.use('/api/auth', authProxyPathGuard, createAuthProxy(target));
  const base = await listen(gateway);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-user-id': '1', 'x-user-role': 'ADMIN', 'x-company-id': '5', 'x-internal-secret': 'forged' }, body: JSON.stringify({ phonenumber: '0900000001', password: 'fixture' }) });
  expect(login.status).toBe(200);
  expect(login.headers.get('set-cookie')).toContain('HttpOnly');
  expect(login.headers.get('cache-control')).toBe('no-store');
  const redirect = await fetch(base + '/api/auth/sso/google/start', { redirect: 'manual' });
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get('location')).toBe('https://accounts.google.com/example');
  expect((await fetch(base + '/api/auth/refresh', { method: 'POST' })).status).toBe(401);
});
