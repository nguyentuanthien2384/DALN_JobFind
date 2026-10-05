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

// Auth0 social strategies the login buttons can route to. Auth0 subjects are "<strategy>|<id>".
const AUTH0_STRATEGIES = { 'google-oauth2': 'google', github: 'github', facebook: 'facebook' };
const auth0Connections = () => (process.env.OIDC_AUTH0_CONNECTIONS || '').split(',').map(value => value.trim())
  .filter(value => Object.hasOwn(AUTH0_STRATEGIES, value));
// A button uses its direct provider when configured, otherwise the operator-listed Auth0 connection.
// The connection comes from server configuration only, never from the request.
export const loginRoute = method => {
  if (method !== 'facebook' && providerAvailable(method)) return { provider: method };
  const connection = auth0Connections().find(value => AUTH0_STRATEGIES[value] === method);
  if (connection && providerAvailable('auth0')) return { provider: 'auth0', connection };
  throw new Error('OIDC_DISABLED');
};
const routeAvailable = method => { try { loginRoute(method); return true; } catch { return false; } };
export const availableProviders = () => Object.fromEntries(['google', 'github', 'facebook', 'auth0'].map(name => [name, routeAvailable(name)]));
// Stored identity/session label: "auth0:google" for Google via Auth0, plain "auth0" for its own database users.
export const identityProvider = (name, subject) => {
  if (name !== 'auth0') return name;
  const strategy = String(subject).split('|')[0];
  return Object.hasOwn(AUTH0_STRATEGIES, strategy) ? `auth0:${AUTH0_STRATEGIES[strategy]}` : 'auth0';
};

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
