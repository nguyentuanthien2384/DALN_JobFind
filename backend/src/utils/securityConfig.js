import crypto from 'crypto';

const MIN_SECRET_LENGTH = 32;
const KNOWN_INSECURE_SECRETS = new Set([
    'anhtaideptrai',
    'changeme',
    'change-me',
    'replace-with-a-long-random-secret',
    'secret'
]);

export const assertSecureJwtSecret = (value) => {
    const secret = typeof value === 'string' ? value.trim() : '';
    const distinctCharacters = new Set(secret).size;
    if (
        secret.length < MIN_SECRET_LENGTH
        || distinctCharacters < 12
        || KNOWN_INSECURE_SECRETS.has(secret.toLowerCase())
    ) {
        throw new Error('JWT_SECRET must be a high-entropy secret of at least 32 characters');
    }
    return secret;
};

export const getJwtSecret = () => assertSecureJwtSecret(process.env.JWT_SECRET);

// ===== Khoa ky access token: HS256 (mac dinh) hoac ES256 + JWKS =====
// HS256: backend va Gateway dung chung JWT_SECRET - ai giu secret cung tu ky duoc token.
// ES256: dat JWT_PRIVATE_KEY (khoa EC P-256, PEM hoac base64 cua PEM; tao bang
// scripts/generate-jwt-key.cjs). Chi backend giu khoa rieng; khoa cong khai duoc cong bo
// o /.well-known/jwks.json (moi khoa co kid = RFC 7638 thumbprint) va Gateway tu tai ve
// (JWT_JWKS_URL), nen Gateway khong con giu bi mat co the tao token.
// Doi khoa: dua khoa cu vao JWT_PREVIOUS_PUBLIC_KEYS (phan cach dau phay; khoa cong khai
// hoac chinh khoa rieng cu), dat JWT_PRIVATE_KEY = khoa moi. Token cu van hop le toi khi het
// han (toi da JWT_ACCESS_TTL_SECONDS) roi moi bo khoa cu. Con JWT_SECRET thi token HS256 cu
// van duoc chap nhan; bo JWT_SECRET khi da chuyen han sang ES256.
const decodeKeyMaterial = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return '';
    const pem = value.includes('-----BEGIN') ? value : Buffer.from(value, 'base64').toString('utf8');
    return pem.replace(/\\n/g, '\n');
};

const assertP256 = (key, name) => {
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error(`${name} must be an EC P-256 key for ES256`);
    }
};

// RFC 7638 JWK thumbprint: the same public key always gets the same kid.
const publicJwk = (publicKey) => {
    const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
    const kid = crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');
    return { kty, crv, x, y, kid, alg: 'ES256', use: 'sig' };
};

let cachedKeys = null;
let cachedKeySource = null;
export const getJwtKeys = () => {
    const source = `${process.env.JWT_PRIVATE_KEY || ''}\u0000${process.env.JWT_PREVIOUS_PUBLIC_KEYS || ''}`;
    if (cachedKeys && cachedKeySource === source) return cachedKeys;
    let signing = null;
    const verification = [];
    const add = (publicKey) => {
        const jwk = publicJwk(publicKey);
        if (!verification.some((key) => key.kid === jwk.kid)) verification.push({ kid: jwk.kid, publicKey, jwk });
        return jwk.kid;
    };
    const privatePem = decodeKeyMaterial(process.env.JWT_PRIVATE_KEY);
    if (privatePem) {
        const privateKey = crypto.createPrivateKey(privatePem);
        assertP256(privateKey, 'JWT_PRIVATE_KEY');
        signing = { privateKey, kid: add(crypto.createPublicKey(privateKey)) };
    }
    for (const raw of String(process.env.JWT_PREVIOUS_PUBLIC_KEYS || '').split(',')) {
        const pem = decodeKeyMaterial(raw);
        if (!pem) continue;
        const publicKey = crypto.createPublicKey(pem);
        assertP256(publicKey, 'JWT_PREVIOUS_PUBLIC_KEYS');
        add(publicKey);
    }
    cachedKeys = { signing, verification };
    cachedKeySource = source;
    return cachedKeys;
};

// Public half only; served at /.well-known/jwks.json.
export const getJwks = () => ({ keys: getJwtKeys().verification.map((key) => key.jwk) });

export const getJwtSigningKey = () => getJwtKeys().signing?.privateKey || getJwtSecret();

// Startup check: ES256 needs a valid key, HS256 a strong secret; a configured secret must be strong.
export const assertJwtConfiguration = () => {
    const { signing } = getJwtKeys();
    if (String(process.env.JWT_SECRET || '').trim() || !signing) assertSecureJwtSecret(process.env.JWT_SECRET);
    getJwtPolicy();
};

// Header of a compact JWS, or null. Read without jsonwebtoken so each token is verified
// with exactly one algorithm and the key that belongs to it.
export const readJwtHeader = (token) => {
    try {
        const header = JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString('utf8'));
        return header && typeof header === 'object' ? header : null;
    } catch {
        return null;
    }
};

const tokenAlgorithm = (token) => (readJwtHeader(token)?.alg === 'ES256' ? 'ES256' : 'HS256');

// ES256 -> public key with the token's kid; anything else -> JWT_SECRET (throws if unset).
export const getJwtVerificationKey = (token) => {
    const header = readJwtHeader(token);
    if (header?.alg !== 'ES256') return getJwtSecret();
    const key = getJwtKeys().verification.find((entry) => entry.kid === header.kid);
    if (!key) throw new Error('Unknown JWT signing key');
    return key.publicKey;
};

export const getTokenVerifyOptions = (token) => getJwtVerifyOptions(tokenAlgorithm(token));

// Behind the API Gateway every request comes from the Gateway's address, so per-IP limits
// would be shared by all users. Trust X-Forwarded-For only from the named proxy addresses
// (same rules as microservices/api-gateway parseTrustedProxies); never "true" or wildcards.
export const parseTrustedProxies = (raw = '') => {
    const proxies = String(raw || '').split(',').map((value) => value.trim()).filter(Boolean);
    if (proxies.length === 0) return false;
    const unsafe = new Set(['true', '*', 'all', '0.0.0.0/0', '::/0']);
    for (const proxy of proxies) {
        if (unsafe.has(proxy.toLowerCase()) || /^\d+$/.test(proxy)) throw new Error(`TRUST_PROXY khong an toan: ${proxy}`);
    }
    return proxies;
};

// Keep this policy identical in microservices/shared/securityConfig.js.
export const getJwtPolicy = () => {
    const issuer = process.env.JWT_ISSUER?.trim() || 'jobfind-auth';
    const audience = process.env.JWT_AUDIENCE?.trim() || 'jobfind-api';
    const ttl = Number(process.env.JWT_ACCESS_TTL_SECONDS || 900);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) {
        throw new Error('JWT_ACCESS_TTL_SECONDS must be an integer between 60 and 3600');
    }
    return { issuer, audience, ttl };
};

export const getJwtSignOptions = () => {
    const { issuer, audience, ttl } = getJwtPolicy();
    const signing = getJwtKeys().signing;
    if (signing) return { algorithm: 'ES256', keyid: signing.kid, issuer, audience, expiresIn: ttl };
    return { algorithm: 'HS256', issuer, audience, expiresIn: ttl };
};

export const getJwtVerifyOptions = (algorithm = 'HS256') => {
    const { issuer, audience, ttl } = getJwtPolicy();
    return { algorithms: [algorithm], issuer, audience, maxAge: ttl, clockTolerance: 5 };
};

// jsonwebtoken validates exp only when present; require a bounded access token.
export const hasAccessTokenClaims = (payload) => {
    const { ttl } = getJwtPolicy();
    const now = Math.floor(Date.now() / 1000);
    return payload !== null && typeof payload === 'object'
        && Number.isSafeInteger(Number(payload.sub)) && Number(payload.sub) > 0
        && Number.isInteger(payload.iat) && Number.isInteger(payload.exp)
        && payload.iat <= now + 5 && payload.exp > payload.iat
        && payload.exp - payload.iat <= ttl;
};
