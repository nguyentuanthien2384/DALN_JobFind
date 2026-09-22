const crypto = require('crypto');
const providers = require('../../src/services/socialProviders');
const originalEnv = { ...process.env };
const originalFetch = global.fetch;
const envPrefixes = ['OIDC_GOOGLE', 'OAUTH_GITHUB', 'OIDC_AUTH0'];
const configure = name => {
  const prefix = name === 'github' ? 'OAUTH_GITHUB' : `OIDC_${name.toUpperCase()}`;
  Object.assign(process.env, {
    [`${prefix}_ENABLED`]: 'true', [`${prefix}_CLIENT_ID`]: `${name}-test-client`,
    [`${prefix}_CLIENT_SECRET`]: `${name}-test-server-secret`,
    [`${prefix}_REDIRECT_URI`]: `https://jobs.example.com/api/auth/sso/${name}/callback`,
    [`${prefix}_ISSUER`]: name === 'google' ? 'https://accounts.google.com' : 'https://tenant.eu.auth0.com/',
  });
  return prefix;
};
const respond = value => global.fetch.mockResolvedValueOnce({ ok: true, json: async () => value });
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  for (const key of Object.keys(process.env)) if (envPrefixes.some(prefix => key.startsWith(prefix))) delete process.env[key];
  global.fetch = jest.fn();
});
afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('providers are disabled by default and unknown provider names cannot select configuration', () => {
  expect(providers.availableProviders()).toEqual({ google: false, github: false, auth0: false });
  expect(() => providers.providerSettings('attacker')).toThrow('OIDC_DISABLED');
  configure('google');
  delete process.env.OIDC_GOOGLE_CLIENT_SECRET;
  expect(providers.providerAvailable('google')).toBe(false);
});

test('availability exposes only booleans while Auth0 secrets remain in server configuration', () => {
  configure('auth0');
  const settings = providers.providerSettings('auth0');
  expect(settings).toMatchObject({ issuer: 'https://tenant.eu.auth0.com/', secret: 'auth0-test-server-secret' });
  const publicSettings = providers.availableProviders();
  expect(publicSettings).toEqual({ google: false, github: false, auth0: true });
  expect(JSON.stringify(publicSettings)).not.toContain(settings.secret);
  expect(JSON.stringify(publicSettings)).not.toContain(settings.id);
});

test.each([
  'https://jobs.example.com/api/auth/sso/github/callback',
  'https://jobs.example.com/api/auth/sso/google/callback?next=elsewhere',
  'https://jobs.example.com/api/auth/sso/google/callback#fragment',
  'https://user:password@jobs.example.com/api/auth/sso/google/callback',
  'http://jobs.example.com/api/auth/sso/google/callback',
])('provider callback rejects a mismatched or unsafe URI: %s', redirect => {
  configure('google');
  process.env.OIDC_GOOGLE_REDIRECT_URI = redirect;
  expect(providers.providerAvailable('google')).toBe(false);
});

test('localhost HTTP callback is allowed only outside production', () => {
  configure('google');
  process.env.OIDC_GOOGLE_REDIRECT_URI = 'http://localhost:4000/api/auth/sso/google/callback';
  expect(providers.providerAvailable('google')).toBe(true);
  process.env.NODE_ENV = 'production';
  expect(providers.providerAvailable('google')).toBe(false);
});

test('Google issuer is pinned and Auth0 rejects non-HTTPS, path and credential-bearing issuers', () => {
  configure('google');
  process.env.OIDC_GOOGLE_ISSUER = 'https://untrusted.example.com';
  expect(providers.providerAvailable('google')).toBe(false);
  configure('auth0');
  for (const issuer of ['http://tenant.auth0.com/', 'https://tenant.auth0.com/path/', 'https://user:pass@tenant.auth0.com/', 'https://tenant.auth0.com/?next=x', 'https://tenant.auth0.com']) {
    process.env.OIDC_AUTH0_ISSUER = issuer;
    expect(providers.providerAvailable('auth0')).toBe(false);
  }
});

test('GitHub authorization binds state and S256 PKCE without exposing the client secret', () => {
  configure('github');
  const settings = providers.providerSettings('github');
  const url = new URL(providers.githubAuthorizationUrl(settings, 'test-state', 'test-verifier'));
  expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
  expect(url.searchParams.get('state')).toBe('test-state');
  expect(url.searchParams.get('redirect_uri')).toBe(settings.redirect);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update('test-verifier').digest('base64url'));
  expect(url.searchParams.get('scope')).toBe('read:user user:email');
  expect(url.href).not.toContain(settings.secret);
});

test('GitHub requests use fixed URLs, bounded timeouts and numeric ID with verified private email', async () => {
  configure('github');
  const settings = providers.providerSettings('github');
  const signal = new AbortController().signal;
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
  respond({ access_token: 'unit-provider-token', token_type: 'bearer' });
  respond({ id: 123456, login: 'mutable-name', name: 'Nguyen Lan', email: 'untrusted-public@gmail.com' });
  respond([{ email: 'unverified@gmail.com', primary: true, verified: false }, { email: 'private@gmail.com', primary: true, verified: true }]);
  const result = await providers.githubClaims(settings, 'unit-code', 'unit-verifier');
  expect(result).toEqual({ iss: 'https://github.com', sub: '123456', name: 'Nguyen Lan', email: 'private@gmail.com', email_verified: true });
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
    'https://github.com/login/oauth/access_token', 'https://api.github.com/user', 'https://api.github.com/user/emails?per_page=100',
  ]);
  for (const [, options] of global.fetch.mock.calls) expect(options).toMatchObject({ redirect: 'error', signal });
  expect(timeout).toHaveBeenCalledTimes(3);
  expect(timeout).toHaveBeenCalledWith(10000);
  const body = new URLSearchParams(global.fetch.mock.calls[0][1].body);
  expect(Object.fromEntries(body)).toMatchObject({ code: 'unit-code', code_verifier: 'unit-verifier', client_secret: settings.secret, redirect_uri: settings.redirect });
  expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer unit-provider-token');
});

test('GitHub can use a verified secondary email but never trusts the public profile email', async () => {
  configure('github');
  respond({ access_token: 'unit-token', token_type: 'Bearer' });
  respond({ id: 1, login: 'mutable', email: 'public@gmail.com' });
  respond([{ email: 'secondary@gmail.com', verified: true, primary: false }]);
  expect(await providers.githubClaims(providers.providerSettings('github'), 'code', 'verifier')).toMatchObject({ email: 'secondary@gmail.com', email_verified: true });
  respond({ access_token: 'unit-token', token_type: 'bearer' });
  respond({ id: 1, login: 'mutable', email: 'public@gmail.com' });
  respond([{ email: 'public@gmail.com', verified: false, primary: true }]);
  expect(await providers.githubClaims(providers.providerSettings('github'), 'code', 'verifier')).toMatchObject({ email: undefined, email_verified: false });
});

test.each([
  {}, { error: 'bad_verification_code' }, { access_token: '', token_type: 'bearer' },
  { access_token: 'token', token_type: 'mac' }, { access_token: 123, token_type: 'bearer' },
])('GitHub rejects malformed token responses before fetching a profile: %j', async token => {
  configure('github'); respond(token);
  await expect(providers.githubClaims(providers.providerSettings('github'), 'code', 'verifier')).rejects.toThrow('OAUTH_PROVIDER_FAILED');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([0, -1, '42', Number.MAX_SAFE_INTEGER + 1, undefined])('GitHub rejects an invalid stable user ID: %s', async id => {
  configure('github'); respond({ access_token: 'token', token_type: 'bearer' }); respond({ id, login: 'name' });
  await expect(providers.githubClaims(providers.providerSettings('github'), 'code', 'verifier')).rejects.toThrow('OAUTH_IDENTITY_INVALID');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('GitHub provider failures stop processing without accepting partial claims', async () => {
  configure('github');
  global.fetch.mockResolvedValueOnce({ ok: false, json: jest.fn() });
  await expect(providers.githubClaims(providers.providerSettings('github'), 'code', 'verifier')).rejects.toThrow('OAUTH_PROVIDER_FAILED');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
