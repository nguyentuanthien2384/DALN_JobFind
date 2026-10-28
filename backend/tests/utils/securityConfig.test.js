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

describe('ES256 access tokens and JWKS', () => {
  const crypto = require('crypto');
  const jwt = require('jsonwebtoken');
  const security = require('../../src/utils/securityConfig');
  const secret = 'Correct-Horse_Battery-Staple_2026!Jwt';
  const pem = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  const saved = {};
  const names = ['JWT_SECRET', 'JWT_PRIVATE_KEY', 'JWT_PREVIOUS_PUBLIC_KEYS'];
  const verify = (token) => {
    const payload = jwt.verify(token, security.getJwtVerificationKey(token), security.getTokenVerifyOptions(token));
    if (!security.hasAccessTokenClaims(payload)) throw new Error('claims');
    return payload;
  };
  const sign = (payload = { sub: 42 }) => jwt.sign(payload, security.getJwtSigningKey(), security.getJwtSignOptions());

  beforeEach(() => { for (const name of names) { saved[name] = process.env[name]; delete process.env[name]; } });
  afterEach(() => { for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } });

  test('without a private key tokens stay HS256 and JWKS is empty', () => {
    process.env.JWT_SECRET = secret;
    const token = sign();
    expect(security.readJwtHeader(token)).toMatchObject({ alg: 'HS256' });
    expect(verify(token).sub).toBe(42);
    expect(security.getJwks()).toEqual({ keys: [] });
  });

  test('signs ES256 with a kid published in JWKS (base64 PEM accepted), without private parts', () => {
    process.env.JWT_PRIVATE_KEY = Buffer.from(pem()).toString('base64');
    const token = sign();
    const header = security.readJwtHeader(token);
    const { keys } = security.getJwks();
    expect(header).toMatchObject({ alg: 'ES256', kid: keys[0].kid });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toEqual({ kty: 'EC', crv: 'P-256', x: expect.any(String), y: expect.any(String), kid: expect.any(String), alg: 'ES256', use: 'sig' });
    expect(verify(token).sub).toBe(42);
    // The published JWK alone verifies the token (what the Gateway does).
    const publicKey = crypto.createPublicKey({ key: keys[0], format: 'jwk' });
    expect(jwt.verify(token, publicKey, { algorithms: ['ES256'] }).sub).toBe(42);
  });

  test('rotation keeps tokens of the previous key valid until that key is removed', () => {
    const oldKey = pem();
    process.env.JWT_PRIVATE_KEY = oldKey;
    const oldToken = sign();
    process.env.JWT_PRIVATE_KEY = pem();
    process.env.JWT_PREVIOUS_PUBLIC_KEYS = oldKey.replace(/\n/g, '\\n');
    expect(security.getJwks().keys).toHaveLength(2);
    expect(verify(oldToken).sub).toBe(42);
    expect(verify(sign()).sub).toBe(42);
    delete process.env.JWT_PREVIOUS_PUBLIC_KEYS;
    expect(() => verify(oldToken)).toThrow('Unknown JWT signing key');
  });

  test('ES256-only mode rejects HS256 tokens; HS256 tokens keep working while JWT_SECRET is set', () => {
    process.env.JWT_SECRET = secret;
    const hsToken = sign();
    process.env.JWT_PRIVATE_KEY = pem();
    expect(verify(hsToken).sub).toBe(42);
    delete process.env.JWT_SECRET;
    expect(() => verify(hsToken)).toThrow(/JWT_SECRET/);
    expect(() => security.assertJwtConfiguration()).not.toThrow();
  });

  test('rejects algorithm confusion, foreign keys and tampered headers', () => {
    process.env.JWT_SECRET = secret;
    process.env.JWT_PRIVATE_KEY = pem();
    const publicPem = crypto.createPublicKey(process.env.JWT_PRIVATE_KEY).export({ type: 'spki', format: 'pem' });
    const options = { issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 };
    // Classic confusion: HS256 MAC keyed with the public key. It is checked against JWT_SECRET.
    const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 1, iat: now, exp: now + 60, iss: 'jobfind-auth', aud: 'jobfind-api' })}`;
    const forged = `${unsigned}.${crypto.createHmac('sha256', publicPem).update(unsigned).digest('base64url')}`;
    expect(() => verify(forged)).toThrow(/signature/);
    const foreign = jwt.sign({ sub: 1 }, pem(), { ...options, algorithm: 'ES256', keyid: security.getJwks().keys[0].kid });
    expect(() => verify(foreign)).toThrow(/signature/);
    const noKid = jwt.sign({ sub: 1 }, process.env.JWT_PRIVATE_KEY, { ...options, algorithm: 'ES256' });
    expect(() => verify(noKid)).toThrow('Unknown JWT signing key');
    expect(security.readJwtHeader('not-a-token')).toBeNull();
  });

  test('startup check requires a strong secret without a key and rejects non-P-256 keys', () => {
    expect(() => security.assertJwtConfiguration()).toThrow(/JWT_SECRET/);
    process.env.JWT_PRIVATE_KEY = pem();
    process.env.JWT_SECRET = 'short';
    expect(() => security.assertJwtConfiguration()).toThrow(/JWT_SECRET/);
    delete process.env.JWT_SECRET;
    process.env.JWT_PRIVATE_KEY = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    expect(() => security.assertJwtConfiguration()).toThrow(/P-256/);
  });
});
