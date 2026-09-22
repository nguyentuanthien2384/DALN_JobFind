import crypto from 'crypto';

const callbackUrl = (name, redirect) => {
  const uri = new URL(redirect);
  const local = process.env.NODE_ENV !== 'production' && uri.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(uri.hostname);
  if ((!local && uri.protocol !== 'https:') || uri.pathname !== `/api/auth/sso/${name}/callback`
      || uri.search || uri.hash || uri.username || uri.password) throw new Error('OIDC_CONFIG');
  return uri.href;
};

export const providerSettings = name => {
  if (!['google', 'github', 'auth0'].includes(name)) throw new Error('OIDC_DISABLED');
  const prefix = name === 'github' ? 'OAUTH_GITHUB' : `OIDC_${name.toUpperCase()}`;
  if (process.env[`${prefix}_ENABLED`] !== 'true') throw new Error('OIDC_DISABLED');
  const id = process.env[`${prefix}_CLIENT_ID`], secret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!id || !secret || !process.env[`${prefix}_REDIRECT_URI`]) throw new Error('OIDC_CONFIG');
  const redirect = callbackUrl(name, process.env[`${prefix}_REDIRECT_URI`]);
  const issuer = name === 'github' ? 'https://github.com' : process.env[`${prefix}_ISSUER`];
  if (name === 'google' && issuer !== 'https://accounts.google.com') throw new Error('OIDC_CONFIG');
  if (name === 'auth0') {
    const uri = new URL(issuer);
    // Auth0 tenant/custom domain is configured by the operator, never supplied by a request.
    if (uri.protocol !== 'https:' || uri.pathname !== '/' || uri.search || uri.hash || uri.username || uri.password || issuer !== uri.origin + '/') throw new Error('OIDC_CONFIG');
  }
  return { name, id, secret, redirect, issuer };
};
export const providerAvailable = name => { try { providerSettings(name); return true; } catch { return false; } };
export const availableProviders = () => Object.fromEntries(['google', 'github', 'auth0'].map(name => [name, providerAvailable(name)]));

export const githubAuthorizationUrl = (settings, state, verifier) => {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: settings.id, redirect_uri: settings.redirect,
    scope: 'read:user user:email', state, code_challenge_method: 'S256',
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }).toString();
  return url.href;
};
const githubJson = async (url, options) => {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('OAUTH_PROVIDER_FAILED');
  return response.json();
};
export const githubClaims = async (settings, code, verifier) => {
  const token = await githubJson('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.id, client_secret: settings.secret, code,
      redirect_uri: settings.redirect, code_verifier: verifier }).toString(),
  });
  if (token.error || typeof token.access_token !== 'string' || !token.access_token
      || token.token_type?.toLowerCase() !== 'bearer') throw new Error('OAUTH_PROVIDER_FAILED');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token.access_token}`,
    'User-Agent': 'JobFind', 'X-GitHub-Api-Version': '2022-11-28' };
  // Read the authenticated numeric user ID on every callback; usernames are mutable.
  const profile = await githubJson('https://api.github.com/user', { headers });
  if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw new Error('OAUTH_IDENTITY_INVALID');
  const emails = await githubJson('https://api.github.com/user/emails?per_page=100', { headers });
  if (!Array.isArray(emails)) throw new Error('OAUTH_IDENTITY_INVALID');
  const verified = emails.find(item => item.verified === true && item.primary === true)
    || emails.find(item => item.verified === true);
  return { iss: settings.issuer, sub: String(profile.id), email: verified?.email,
    email_verified: Boolean(verified), name: typeof profile.name === 'string' ? profile.name : profile.login };
};
