import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    assertJwtConfiguration, assertSecureJwtSecret, getJwks, getJwtKeys, getJwtPolicy,
    getJwtSecret, getJwtSigningKey, getJwtSignOptions, getJwtVerificationKey,
    getJwtVerifyOptions, getTokenVerifyOptions, hasAccessTokenClaims, readJwtHeader,
    requireEnvironment
} from '../shared/securityConfig.js';

describe('security configuration', () => {
    it.each([undefined, '', 'short-secret', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])(
        'rejects missing, short and low-entropy JWT secrets',
        (value) => expect(() => assertSecureJwtSecret(value)).toThrow(/JWT_SECRET/)
    );

    it('accepts a long high-entropy JWT secret', () => {
        const value = 'Correct-Horse_Battery-Staple_2026!Jwt';
        expect(assertSecureJwtSecret(value)).toBe(value);
    });

    it('requires non-empty service configuration', () => {
        const old = process.env.REQUIRED_TEST_SETTING;
        delete process.env.REQUIRED_TEST_SETTING;
        expect(() => requireEnvironment('REQUIRED_TEST_SETTING')).toThrow(/required/);
        process.env.REQUIRED_TEST_SETTING = ' configured ';
        expect(requireEnvironment('REQUIRED_TEST_SETTING')).toBe('configured');
        if (old === undefined) delete process.env.REQUIRED_TEST_SETTING;
        else process.env.REQUIRED_TEST_SETTING = old;
    });
});

describe('JWT policy (literal values are the security requirement)', () => {
    const strong = 'Correct-Horse_Battery-Staple_2026!Jwt';
    const env = (values) => {
        for (const key of ['JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_ACCESS_TTL_SECONDS']) vi.stubEnv(key, '');
        for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
    };
    afterEach(() => vi.unstubAllEnvs());

    it.each(['anhtaideptrai', 'changeme', 'change-me', 'replace-with-a-long-random-secret', 'secret'])(
        'rejects the known placeholder secret %s in any letter case', (placeholder) => {
            expect(() => assertSecureJwtSecret(placeholder)).toThrow(/JWT_SECRET/);
            expect(() => assertSecureJwtSecret(placeholder.toUpperCase())).toThrow(/JWT_SECRET/);
        });

    it('requires 32 characters after trimming and 12 distinct characters', () => {
        const distinct = 'abcdefghijkl';
        const at32 = distinct + 'x'.repeat(20);
        expect(assertSecureJwtSecret(`  ${at32}  `)).toBe(at32);
        expect(() => assertSecureJwtSecret(at32.slice(0, 31))).toThrow();
        expect(() => assertSecureJwtSecret(`   ${at32.slice(0, 31)}   `)).toThrow();
        const elevenDistinct = 'abcdefghijk'.repeat(3);
        expect(elevenDistinct.length).toBeGreaterThanOrEqual(32);
        expect(() => assertSecureJwtSecret(elevenDistinct)).toThrow();
        expect(assertSecureJwtSecret('abcdefghijkl'.repeat(3))).toBe('abcdefghijkl'.repeat(3));
        expect(() => assertSecureJwtSecret(12345678901234567890123456789012345)).toThrow();
    });

    it('reads the secret from JWT_SECRET', () => {
        vi.stubEnv('JWT_SECRET', strong);
        expect(getJwtSecret()).toBe(strong);
        vi.stubEnv('JWT_SECRET', 'secret');
        expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
    });

    it('defaults to the JobFind issuer, audience and a 15 minute lifetime', () => {
        env({});
        expect(getJwtPolicy()).toEqual({ issuer: 'jobfind-auth', audience: 'jobfind-api', ttl: 900 });
        expect(getJwtSignOptions()).toEqual({ algorithm: 'HS256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 });
        expect(getJwtVerifyOptions()).toEqual({ algorithms: ['HS256'], issuer: 'jobfind-auth', audience: 'jobfind-api', maxAge: 900, clockTolerance: 5 });
    });

    it('trims configured issuer and audience and ignores blank values', () => {
        env({ JWT_ISSUER: '  issuer-x  ', JWT_AUDIENCE: '  api-y ' });
        expect(getJwtPolicy()).toMatchObject({ issuer: 'issuer-x', audience: 'api-y' });
        env({ JWT_ISSUER: '   ', JWT_AUDIENCE: '   ' });
        expect(getJwtPolicy()).toMatchObject({ issuer: 'jobfind-auth', audience: 'jobfind-api' });
    });

    it.each([['60', 60], ['3600', 3600], ['1800', 1800]])('accepts an access-token lifetime of %s seconds', (value, ttl) => {
        env({ JWT_ACCESS_TTL_SECONDS: value });
        expect(getJwtPolicy().ttl).toBe(ttl);
        expect(getJwtVerifyOptions().maxAge).toBe(ttl);
    });

    it.each(['59', '3601', '90.5', 'abc', '-900'])('refuses an access-token lifetime of %s seconds', (value) => {
        env({ JWT_ACCESS_TTL_SECONDS: value });
        expect(() => getJwtPolicy()).toThrow('JWT_ACCESS_TTL_SECONDS must be an integer between 60 and 3600');
        expect(() => getJwtSignOptions()).toThrow();
    });

    describe('hasAccessTokenClaims', () => {
        const NOW = 1_800_000_000;
        beforeEach(() => { env({}); vi.useFakeTimers(); vi.setSystemTime(NOW * 1000); });
        afterEach(() => vi.useRealTimers());
        const claims = (extra = {}) => ({ sub: 7, iat: NOW, exp: NOW + 900, ...extra });

        it('accepts a bounded token for a positive subject', () => {
            expect(hasAccessTokenClaims(claims())).toBe(true);
            expect(hasAccessTokenClaims(claims({ sub: '7' }))).toBe(true);
            expect(hasAccessTokenClaims(claims({ iat: NOW + 5, exp: NOW + 905 }))).toBe(true);
            expect(hasAccessTokenClaims(claims({ exp: NOW + 1 }))).toBe(true);
        });

        it.each([
            ['null', null], ['a string', 'token'], ['subject 0', claims({ sub: 0 })], ['a negative subject', claims({ sub: -1 })],
            ['an unsafe subject', claims({ sub: 2 ** 53 })], ['a missing iat', claims({ iat: undefined })],
            ['a fractional exp', claims({ exp: NOW + 0.5 })], ['iat 6s in the future', claims({ iat: NOW + 6, exp: NOW + 906 })],
            ['exp equal to iat', claims({ exp: NOW })], ['a 901s lifetime', claims({ exp: NOW + 901 })],
        ])('rejects %s', (_case, payload) => {
            expect(hasAccessTokenClaims(payload)).toBe(false);
        });
    });
});

describe('ES256 access tokens and JWKS', () => {
    const secret = 'Correct-Horse_Battery-Staple_2026!Jwt';
    const pem = () => crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const saved = {};
    const names = ['JWT_SECRET', 'JWT_PRIVATE_KEY', 'JWT_PREVIOUS_PUBLIC_KEYS', 'JWT_ACCESS_TTL_SECONDS'];
    const verify = (token) => {
        const payload = jwt.verify(token, getJwtVerificationKey(token), getTokenVerifyOptions(token));
        if (!hasAccessTokenClaims(payload)) throw new Error('claims');
        return payload;
    };
    const sign = (payload = { sub: 42 }) => jwt.sign(payload, getJwtSigningKey(), getJwtSignOptions());

    beforeEach(() => {
        for (const name of names) {
            saved[name] = process.env[name];
            delete process.env[name];
        }
    });
    afterEach(() => {
        for (const name of names) {
            if (saved[name] === undefined) delete process.env[name];
            else process.env[name] = saved[name];
        }
    });

    it('without a private key tokens stay HS256 and JWKS is empty', () => {
        process.env.JWT_SECRET = secret;
        const token = sign();
        expect(readJwtHeader(token)).toMatchObject({ alg: 'HS256' });
        expect(getTokenVerifyOptions(token)).toMatchObject({ algorithms: ['HS256'] });
        expect(verify(token).sub).toBe(42);
        expect(getJwks()).toEqual({ keys: [] });
        expect(getJwtKeys()).toBe(getJwtKeys());
    });

    it('signs ES256 with a kid published in JWKS (base64 PEM accepted), without private parts', () => {
        process.env.JWT_PRIVATE_KEY = `  ${Buffer.from(pem()).toString('base64')}  `;
        const token = sign();
        const header = readJwtHeader(token);
        const { keys } = getJwks();
        expect(header).toMatchObject({ alg: 'ES256', kid: keys[0].kid });
        expect(getTokenVerifyOptions(token)).toMatchObject({ algorithms: ['ES256'] });
        expect(keys).toHaveLength(1);
        expect(keys[0]).toEqual({
            kty: 'EC', crv: 'P-256', x: expect.any(String), y: expect.any(String),
            kid: expect.any(String), alg: 'ES256', use: 'sig'
        });
        expect(verify(token).sub).toBe(42);
        const publicKey = crypto.createPublicKey({ key: keys[0], format: 'jwk' });
        expect(jwt.verify(token, publicKey, { algorithms: ['ES256'] }).sub).toBe(42);
    });

    it('rotation keeps tokens of the previous key valid, deduplicates identical keys, and ignores blank entries', () => {
        const oldKey = pem();
        process.env.JWT_PRIVATE_KEY = oldKey;
        const oldToken = sign();
        const currentKey = pem();
        process.env.JWT_PRIVATE_KEY = currentKey;
        process.env.JWT_PREVIOUS_PUBLIC_KEYS = ` , ${oldKey.replace(/\n/g, '\\n')} , ${currentKey.replace(/\n/g, '\\n')} , `;
        expect(getJwks().keys).toHaveLength(2);
        expect(verify(oldToken).sub).toBe(42);
        expect(verify(sign()).sub).toBe(42);
        delete process.env.JWT_PREVIOUS_PUBLIC_KEYS;
        expect(() => verify(oldToken)).toThrow('Unknown JWT signing key');
    });

    it('ES256-only mode rejects HS256 tokens; HS256 tokens keep working while JWT_SECRET is set', () => {
        process.env.JWT_SECRET = secret;
        const hsToken = sign();
        process.env.JWT_PRIVATE_KEY = pem();
        expect(verify(hsToken).sub).toBe(42);
        delete process.env.JWT_SECRET;
        expect(() => verify(hsToken)).toThrow(/JWT_SECRET/);
        expect(() => assertJwtConfiguration()).not.toThrow();
    });

    it('rejects algorithm confusion, foreign keys and tampered headers', () => {
        process.env.JWT_SECRET = secret;
        process.env.JWT_PRIVATE_KEY = pem();
        const publicPem = crypto.createPublicKey(process.env.JWT_PRIVATE_KEY).export({ type: 'spki', format: 'pem' });
        const options = { issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 };
        const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 1, iat: now, exp: now + 60, iss: 'jobfind-auth', aud: 'jobfind-api' })}`;
        const forged = `${unsigned}.${crypto.createHmac('sha256', publicPem).update(unsigned).digest('base64url')}`;
        expect(() => verify(forged)).toThrow(/signature/);
        const foreign = jwt.sign({ sub: 1 }, pem(), { ...options, algorithm: 'ES256', keyid: getJwks().keys[0].kid });
        expect(() => verify(foreign)).toThrow(/signature/);
        const noKid = jwt.sign({ sub: 1 }, process.env.JWT_PRIVATE_KEY, { ...options, algorithm: 'ES256' });
        expect(() => verify(noKid)).toThrow('Unknown JWT signing key');
        expect(readJwtHeader('not-a-token')).toBeNull();
        expect(readJwtHeader(`${Buffer.from('null').toString('base64url')}.x.y`)).toBeNull();
        expect(readJwtHeader(`${Buffer.from('"str"').toString('base64url')}.x.y`)).toBeNull();
        expect(readJwtHeader(null)).toBeNull();
    });

    it('startup check requires a strong secret without a key, validates policy, and rejects non-P-256 keys', () => {
        expect(() => assertJwtConfiguration()).toThrow(/JWT_SECRET/);
        process.env.JWT_SECRET = `  ${secret}  `;
        expect(() => assertJwtConfiguration()).not.toThrow();
        process.env.JWT_PRIVATE_KEY = pem();
        process.env.JWT_SECRET = '   ';
        expect(() => assertJwtConfiguration()).not.toThrow();
        process.env.JWT_SECRET = 'short';
        expect(() => assertJwtConfiguration()).toThrow(/JWT_SECRET/);
        delete process.env.JWT_SECRET;
        process.env.JWT_ACCESS_TTL_SECONDS = '10';
        expect(() => assertJwtConfiguration()).toThrow(/JWT_ACCESS_TTL_SECONDS/);
        delete process.env.JWT_ACCESS_TTL_SECONDS;
        const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        process.env.JWT_PRIVATE_KEY = p384;
        expect(() => assertJwtConfiguration()).toThrow('JWT_PRIVATE_KEY must be an EC P-256 key for ES256');
        const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
        process.env.JWT_PRIVATE_KEY = rsa;
        expect(() => assertJwtConfiguration()).toThrow('JWT_PRIVATE_KEY must be an EC P-256 key for ES256');
        process.env.JWT_PRIVATE_KEY = pem();
        process.env.JWT_PREVIOUS_PUBLIC_KEYS = p384;
        expect(() => assertJwtConfiguration()).toThrow('JWT_PREVIOUS_PUBLIC_KEYS must be an EC P-256 key for ES256');
    });
});
