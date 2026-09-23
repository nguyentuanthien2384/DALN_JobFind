const { authResponseHeaders } = require('../../src/middlewares/authResponseHeaders');

const expectedHeaders = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};

test('auth responses disable caching, framing, sniffing and referrer disclosure before continuing', () => {
  const headers = { 'Cache-Control': 'public, max-age=86400', 'X-Frame-Options': 'SAMEORIGIN' };
  const res = { set: jest.fn((name, value) => { headers[name] = value; }) };
  const next = jest.fn(() => {
    expect(headers).toEqual(expectedHeaders);
  });

  authResponseHeaders({ path: '/api/auth/refresh' }, res, next);

  expect(res.set).toHaveBeenCalledTimes(Object.keys(expectedHeaders).length);
  expect(next).toHaveBeenCalledTimes(1);
});

test('response policy is independent of user-controlled request values', () => {
  const res = { set: jest.fn() };
  const next = jest.fn();
  authResponseHeaders({
    headers: { referer: 'https://attacker.test/?token=secret' },
    query: { redirect: 'https://attacker.test' },
  }, res, next);

  expect(Object.fromEntries(res.set.mock.calls)).toEqual(expectedHeaders);
  expect(JSON.stringify(res.set.mock.calls)).not.toContain('attacker.test');
  expect(next).toHaveBeenCalledTimes(1);
});
