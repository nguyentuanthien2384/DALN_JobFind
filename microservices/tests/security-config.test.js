import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    assertSecureJwtSecret, getJwtPolicy, getJwtSecret, getJwtSignOptions, getJwtVerifyOptions,
    hasAccessTokenClaims, requireEnvironment
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
