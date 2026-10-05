const http = require('http');
const express = require('express');
const { assertSecureJwtSecret, parseTrustedProxies } = require('../../src/utils/securityConfig');
const { createRateLimiter } = require('../../src/middlewares/rateLimit');

describe('security configuration', () => {
  test.each([undefined, '', 'short-secret', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) (
    'rejects a missing, short or low-entropy JWT secret',
    (value) => expect(() => assertSecureJwtSecret(value)).toThrow(/JWT_SECRET/)
  );

  test('accepts a long high-entropy JWT secret', () => {
    const value = 'Correct-Horse_Battery-Staple_2026!Jwt';
    expect(assertSecureJwtSecret(value)).toBe(value);
  });

  test.each([undefined, '', ' , '])('trusts no proxy unless one is named: %j', (value) => {
    expect(parseTrustedProxies(value)).toBe(false);
  });

  test('trusts only the named proxy addresses', () => {
    expect(parseTrustedProxies(' 172.30.250.11 , 10.0.0.0/8 ')).toEqual(['172.30.250.11', '10.0.0.0/8']);
  });

  test.each(['true', '*', 'ALL', '0.0.0.0/0', '::/0', '1'])('rejects a proxy setting that would trust any client: %s', (value) => {
    expect(() => parseTrustedProxies(value)).toThrow(/TRUST_PROXY/);
  });

  test('behind the trusted Gateway each user gets an own rate limit, and other peers cannot forge one', async () => {
    const app = express();
    app.set('trust proxy', parseTrustedProxies('127.0.0.1,::ffff:127.0.0.1'));
    app.get('/limited', createRateLimiter({ windowMs: 60000, max: 1 }), (_req, res) => res.json({ ok: true }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const status = (ip) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.address().port, path: '/limited', headers: { 'x-forwarded-for': ip } },
        (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
    });
    try {
      expect(await status('198.51.100.1')).toBe(200);
      expect(await status('198.51.100.2')).toBe(200);
      expect(await status('198.51.100.1')).toBe(429);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
