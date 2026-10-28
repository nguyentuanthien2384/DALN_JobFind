// Generate an EC P-256 key pair for ES256 access tokens (see src/utils/securityConfig.js).
//
//   node scripts/generate-jwt-key.cjs            print env lines to paste into .env
//   node scripts/generate-jwt-key.cjs --pem      print the PEM files instead
//
// Backend only:  JWT_PRIVATE_KEY=<base64 of the private PEM>   (never give this to the Gateway)
// Gateway:       JWT_JWKS_URL=http://<backend>:5000/.well-known/jwks.json
// Key rotation:  move the old JWT_PRIVATE_KEY value into JWT_PREVIOUS_PUBLIC_KEYS (comma
//                separated; its public half is derived), set the new JWT_PRIVATE_KEY, and drop
//                the old key once JWT_ACCESS_TTL_SECONDS has passed.
const crypto = require('node:crypto');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
const kid = crypto.createHash('sha256').update(JSON.stringify({ crv, kty, x, y })).digest('base64url');

if (process.argv.includes('--pem')) {
    process.stdout.write(`${privatePem}\n${publicPem}`);
} else {
    console.log('# kid (RFC 7638 thumbprint): ' + kid);
    console.log('# Backend .env - keep secret:');
    console.log('JWT_PRIVATE_KEY=' + Buffer.from(privatePem).toString('base64'));
    console.log('# Public key (optional: JWT_PREVIOUS_PUBLIC_KEYS on a Gateway without JWKS access):');
    console.log('# ' + Buffer.from(publicPem).toString('base64'));
}
