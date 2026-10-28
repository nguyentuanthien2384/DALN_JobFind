import crypto from 'node:crypto';
import { createLogger } from '../../../shared/logger.js';
import {
    assertSecureJwtSecret,
    getJwtKeys,
    getJwtPolicy,
    getJwtSecret,
    readJwtHeader
} from '../../../shared/securityConfig.js';

// ===== Khoa kiem tra access token tai Gateway =====
// - HS256 (moi token khong phai ES256): JWT_SECRET dung chung voi backend.
// - ES256: khoa cong khai theo kid. Tim trong khoa cau hinh tai cho (JWT_PREVIOUS_PUBLIC_KEYS)
//   truoc, roi den JWKS backend cong bo (JWT_JWKS_URL, vd http://backend:5000/.well-known/jwks.json).
// JWKS duoc cache: lam moi nen moi REFRESH_MS; gap kid la (backend vua doi khoa) thi tai lai
// ngay nhung toi da mot lan moi MIN_REFETCH_MS de token gia mao kid khong bien Gateway thanh
// cong cu ban request vao backend. Tai that bai thi giu cache cu (backend tam dung khong lam
// moi nguoi bi dang xuat); khoa da bi go khoi JWKS het hieu luc o lan tai thanh cong ke tiep.
const REFRESH_MS = 10 * 60 * 1000;
const MIN_REFETCH_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const MAX_KEYS = 20;

const logger = createLogger('api-gateway');

let remoteKeys = new Map(); // kid -> KeyObject (public)
let fetchedAt = 0;
let attemptedAt = -Infinity;
let inflight = null;

const jwksUrl = () => String(process.env.JWT_JWKS_URL || '').trim();

// Only public EC P-256 signing keys; private members (d) are never imported.
export const parseJwks = (body) => {
    const keys = new Map();
    const list = Array.isArray(body?.keys) ? body.keys.slice(0, MAX_KEYS) : [];
    for (const jwk of list) {
        if (!jwk || typeof jwk !== 'object') continue;
        if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') continue;
        if (typeof jwk.kid !== 'string' || !jwk.kid || jwk.kid.length > 128) continue;
        if (jwk.use !== undefined && jwk.use !== 'sig') continue;
        if (jwk.alg !== undefined && jwk.alg !== 'ES256') continue;
        try {
            const { kty, crv, x, y } = jwk;
            keys.set(jwk.kid, crypto.createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' }));
        } catch {
            // Malformed coordinates: skip this key, keep the others.
        }
    }
    return keys;
};

export const refreshJwks = () => {
    const url = jwksUrl();
    if (!url) return Promise.resolve(false);
    if (inflight) return inflight;
    attemptedAt = Date.now();
    inflight = (async () => {
        const response = await fetch(url, {
            headers: { accept: 'application/json' },
            redirect: 'error',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (!response.ok) throw new Error(`JWKS HTTP ${response.status}`);
        remoteKeys = parseJwks(await response.json());
        fetchedAt = Date.now();
        return true;
    })().catch((error) => {
        logger.warn('jwks_refresh_failed', { error: error.message, cachedKeys: remoteKeys.size });
        return false;
    }).finally(() => {
        inflight = null;
    });
    return inflight;
};

// Key that must verify this token (KeyObject for ES256, secret string for HS256).
// Throws when no key can verify it; callers treat that as an invalid token.
export const resolveVerificationKey = async (token) => {
    const header = readJwtHeader(token);
    if (header?.alg !== 'ES256') return getJwtSecret();
    const kid = typeof header.kid === 'string' ? header.kid : '';
    const local = getJwtKeys().verification.find((entry) => entry.kid === kid);
    if (local) return local.publicKey;
    if (!kid || !jwksUrl()) throw new Error('Unknown JWT signing key');

    const now = Date.now();
    const coolingDown = now - attemptedAt < MIN_REFETCH_MS;
    if (remoteKeys.has(kid)) {
        // Known key: refresh in the background so requests never wait on a slow backend.
        if (now - fetchedAt >= REFRESH_MS && !coolingDown) refreshJwks();
        return remoteKeys.get(kid);
    }
    if (inflight) await inflight;
    else if (!coolingDown) await refreshJwks();
    const key = remoteKeys.get(kid);
    if (!key) throw new Error('Unknown JWT signing key');
    return key;
};

// Startup: a configured JWT_SECRET must be strong; without ES256 keys (local or JWKS) the
// secret is required. JWT_JWKS_URL must be an absolute http(s) URL.
export const assertGatewayJwtConfiguration = () => {
    const url = jwksUrl();
    if (url) {
        let parsed;
        try { parsed = new URL(url); } catch { parsed = null; }
        if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('JWT_JWKS_URL must be an absolute http(s) URL');
        }
    }
    const { verification } = getJwtKeys();
    if (String(process.env.JWT_SECRET || '').trim() || (!url && verification.length === 0)) {
        assertSecureJwtSecret(process.env.JWT_SECRET);
    }
    getJwtPolicy();
};

export const resetJwksCache = () => {
    remoteKeys = new Map();
    fetchedAt = 0;
    attemptedAt = -Infinity;
    inflight = null;
};
