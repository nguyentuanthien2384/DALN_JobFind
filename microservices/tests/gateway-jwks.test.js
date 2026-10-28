import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    assertGatewayJwtConfiguration,
    parseJwks,
    refreshJwks,
    resetJwksCache,
    resolveVerificationKey
} from '../api-gateway/src/libs/jwks.js';
import { getTokenVerifyOptions, hasAccessTokenClaims } from '../shared/securityConfig.js';

const JWKS_URL = 'http://backend.test/.well-known/jwks.json';
const newKey = () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
    const kid = crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');
    return { privateKey, jwk: { kty, crv, x, y, kid, alg: 'ES256', use: 'sig' }, kid };
};
const sign = (key, payload = { sub: 7, sid: 'family-7' }) => jwt.sign(payload, key.privateKey, {
    algorithm: 'ES256', keyid: key.kid, issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900
});
// Same steps as middlewares/auth.js decodeIdentity.
const verify = async (token) => {
    const payload = jwt.verify(token, await resolveVerificationKey(token), getTokenVerifyOptions(token));
    if (!hasAccessTokenClaims(payload)) throw new Error('claims');
    return payload;
};
const serve = (...bodies) => {
    const fetch = vi.fn(async () => {
        const body = bodies.length > 1 ? bodies.shift() : bodies[0];
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, json: async () => body };
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
};

beforeEach(() => {
    resetJwksCache();
    vi.stubEnv('JWT_JWKS_URL', JWKS_URL);
    vi.stubEnv('JWT_PRIVATE_KEY', '');
    vi.stubEnv('JWT_PREVIOUS_PUBLIC_KEYS', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('gateway JWKS verification of ES256 access tokens', () => {
    it('verifies a backend ES256 token with the key fetched from JWKS, then serves it from cache', async () => {
        const key = newKey();
        const fetch = serve({ keys: [key.jwk] });
        expect((await verify(sign(key))).sub).toBe(7);
        expect((await verify(sign(key))).sub).toBe(7);
        expect(fetch).toHaveBeenCalledOnce();
        expect(fetch.mock.calls[0][0]).toBe(JWKS_URL);
    });

    it('picks up a rotated key immediately, but refetches for unknown kids at most every 30s', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const first = newKey();
        const second = newKey();
        const fetch = serve({ keys: [first.jwk] }, { keys: [first.jwk, second.jwk] });
        await verify(sign(first));
        vi.advanceTimersByTime(31_000);
        expect((await verify(sign(second))).sub).toBe(7);
        expect(fetch).toHaveBeenCalledTimes(2);
        const stranger = newKey();
        for (let i = 0; i < 5; i += 1) await expect(verify(sign(stranger))).rejects.toThrow('Unknown JWT signing key');
        expect(fetch).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(31_000);
        await expect(verify(sign(stranger))).rejects.toThrow('Unknown JWT signing key');
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('keeps the cached keys when the backend is unreachable', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const key = newKey();
        const fetch = serve({ keys: [key.jwk] }, new Error('ECONNREFUSED'));
        await verify(sign(key));
        vi.advanceTimersByTime(11 * 60_000);
        expect((await verify(sign(key))).sub).toBe(7); // background refresh fails
        await Promise.resolve();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect((await verify(sign(key))).sub).toBe(7);
    });

    it('drops a key the backend no longer publishes after the next successful refresh', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const retired = newKey();
        const current = newKey();
        serve({ keys: [retired.jwk] }, { keys: [current.jwk] });
        await verify(sign(retired));
        vi.advanceTimersByTime(11 * 60_000);
        await verify(sign(retired));
        await refreshJwks();
        await expect(verify(sign(retired))).rejects.toThrow('Unknown JWT signing key');
    });

    it('rejects forged tokens: foreign key with a published kid, missing kid, no JWKS configured', async () => {
        const key = newKey();
        serve({ keys: [key.jwk] });
        const forged = sign({ ...newKey(), kid: key.kid });
        await expect(verify(forged)).rejects.toThrow(/signature/);
        const noKid = jwt.sign({ sub: 7 }, key.privateKey, { algorithm: 'ES256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 });
        await expect(verify(noKid)).rejects.toThrow('Unknown JWT signing key');
        resetJwksCache();
        vi.stubEnv('JWT_JWKS_URL', '');
        await expect(verify(sign(key))).rejects.toThrow('Unknown JWT signing key');
    });

    it('still verifies HS256 tokens with JWT_SECRET during the migration', async () => {
        const secret = process.env.JWT_SECRET;
        const token = jwt.sign({ sub: 9 }, secret, { algorithm: 'HS256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 });
        expect((await verify(token)).sub).toBe(9);
        expect(await resolveVerificationKey(token)).toBe(secret);
    });

    it('imports only public EC P-256 signing keys from JWKS', () => {
        const key = newKey();
        const keys = parseJwks({ keys: [
            key.jwk,
            { ...newKey().jwk, alg: 'RS256' },
            { ...newKey().jwk, use: 'enc' },
            { ...newKey().jwk, crv: 'P-384' },
            { kty: 'oct', k: 'c2VjcmV0', kid: 'hmac' },
            { ...newKey().jwk, kid: '' },
            { ...newKey().jwk, x: 'broken' },
            null
        ] });
        expect([...keys.keys()]).toEqual([key.kid]);
        expect(keys.get(key.kid).type).toBe('public');
        expect(parseJwks({}).size).toBe(0);
    });

    it('validates the startup configuration', () => {
        vi.stubEnv('JWT_JWKS_URL', 'file:///etc/passwd');
        expect(assertGatewayJwtConfiguration).toThrow(/JWT_JWKS_URL/);
        vi.stubEnv('JWT_JWKS_URL', JWKS_URL);
        vi.stubEnv('JWT_SECRET', '');
        expect(assertGatewayJwtConfiguration).not.toThrow();
        vi.stubEnv('JWT_SECRET', 'weak');
        expect(assertGatewayJwtConfiguration).toThrow(/JWT_SECRET/);
        vi.stubEnv('JWT_SECRET', '');
        vi.stubEnv('JWT_JWKS_URL', '');
        expect(assertGatewayJwtConfiguration).toThrow(/JWT_SECRET/);
    });
});
