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

export const requireEnvironment = (name) => {
    const value = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
    if (!value) throw new Error(`${name} is required`);
    return value;
};
