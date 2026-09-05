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
    if (
        secret.length < MIN_SECRET_LENGTH
        || new Set(secret).size < 12
        || KNOWN_INSECURE_SECRETS.has(secret.toLowerCase())
    ) {
        throw new Error('JWT_SECRET must be a high-entropy secret of at least 32 characters');
    }
    return secret;
};

export const getJwtSecret = () => assertSecureJwtSecret(process.env.JWT_SECRET);

// Keep this policy identical in backend/src/utils/securityConfig.js.
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
    return { algorithm: 'HS256', issuer, audience, expiresIn: ttl };
};

export const getJwtVerifyOptions = () => {
    const { issuer, audience, ttl } = getJwtPolicy();
    return { algorithms: ['HS256'], issuer, audience, maxAge: ttl, clockTolerance: 5 };
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

export const requireEnvironment = (name) => {
    const value = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
    if (!value) throw new Error(`${name} is required`);
    return value;
};
