import { afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { getJwtPolicy, getJwtSignOptions, getJwtVerifyOptions, hasAccessTokenClaims } from '../shared/securityConfig.js';

const secret = 'integration-test-jwt-2026-strong-value-only';
const verify = (token) => {
    const payload = jwt.verify(token, secret, getJwtVerifyOptions());
    if (!hasAccessTokenClaims(payload)) throw new Error('Invalid access claims');
    return payload;
};
afterEach(() => vi.unstubAllEnvs());

describe('strict access token policy (real cryptography)', () => {
    it('accepts the exact issuer/audience/algorithm issued by the backend', () => {
        expect(verify(jwt.sign({ sub: 42 }, secret, getJwtSignOptions())).sub).toBe(42);
    });
    it.each([
        { algorithm: 'HS384' }, { issuer: 'foreign-issuer' }, { audience: 'foreign-api' },
        { expiresIn: -10 }, { noTimestamp: true }, { expiresIn: 3601 }
    ])('rejects incompatible sign options %j', (override) => {
        expect(() => verify(jwt.sign({ sub: 42 }, secret, { ...getJwtSignOptions(), ...override }))).toThrow();
    });
    it('requires expiry, subject and integer timestamps; rejects future issue times', () => {
        const now = Math.floor(Date.now() / 1000);
        for (const payload of [
            { sub: 42 }, { id: 42, exp: now + 60 }, { sub: -1, exp: now + 60 },
            { sub: 42, iat: now + 60, exp: now + 120 }, { sub: 42, iat: now, exp: now },
            { sub: 42, iat: now - 1000, exp: now + 100 }
        ]) {
            const { expiresIn, ...options } = getJwtSignOptions();
            expect(() => verify(jwt.sign(payload, secret, options))).toThrow();
        }
    });
    it('rejects unsigned and wrong-secret tokens', () => {
        expect(() => verify(jwt.sign({ sub: 42 }, '', { algorithm: 'none' }))).toThrow();
        expect(() => verify(jwt.sign({ sub: 42 }, `${secret}-other`, getJwtSignOptions()))).toThrow();
    });
    it('validates configured lifetime before issuing or verifying tokens', () => {
        for (const value of ['0', '59', '3601', 'abc', '900.5']) {
            vi.stubEnv('JWT_ACCESS_TTL_SECONDS', value);
            expect(getJwtPolicy).toThrow();
        }
    });
    it('keeps independently deployed backend and gateway policies identical', () => {
        const extract = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
            .slice(readFileSync(new URL(path, import.meta.url), 'utf8').indexOf('export const getJwtPolicy'))
            .split('export const requireEnvironment')[0].trim();
        expect(extract('../shared/securityConfig.js')).toBe(extract('../../backend/src/utils/securityConfig.js'));
    });
});
