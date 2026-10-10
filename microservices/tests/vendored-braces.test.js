import { createRequire } from 'node:module';
import { afterEach, expect, test } from 'vitest';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

// Resolve exactly as the gateway does at runtime: http-proxy-middleware -> micromatch -> braces.
const require = createRequire(createRequire(import.meta.url).resolve('http-proxy-middleware'));
const micromatch = require(require.resolve('micromatch'));
const braces = createRequire(require.resolve('micromatch'))('braces');
const bracesManifest = createRequire(require.resolve('micromatch'))('braces/package.json');

const nested = (open, close, depth, inner = 'a,b') => open.repeat(depth) + inner + close.repeat(depth);
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

test('the gateway dependency chain loads the vendored braces patch', () => {
  expect(bracesManifest.version).toBe('3.0.4-jobfind.1');
});

test('patterns nested past 100 levels are rejected before any recursive walk (GHSA-vfj7-8cjw-p6xm)', () => {
  for (const pattern of [nested('{', '}', 101), nested('(', ')', 101, 'a')]) {
    expect(() => braces(pattern)).toThrow(SyntaxError);
    expect(() => braces(pattern)).toThrow('Input depth (101), exceeds max depth (100)');
    expect(() => braces.expand(pattern)).toThrow(SyntaxError);
  }
  expect(braces(nested('{', '}', 100))).toHaveLength(1);
  expect(braces(nested('(', ')', 100, 'a'))).toHaveLength(1);
});

test('the inputs that exhausted the stack in 3.0.3 now fail with a catchable SyntaxError', () => {
  // Under the 10,000 character limit; upstream 3.0.3 throws "Maximum call stack size exceeded".
  const deepBraces = nested('{', '}', 4998);
  const deepParens = nested('(', ')', 4999, 'a');
  // micromatch reaches braces only through braces/braceExpand/parse; matching itself uses picomatch.
  for (const run of [
    () => braces(deepBraces),
    () => braces(deepParens),
    () => braces.expand(deepBraces),
    () => micromatch.braces(deepBraces),
    () => micromatch.braceExpand(deepBraces),
    () => micromatch.parse(deepParens),
  ]) {
    expect(run).toThrow(SyntaxError);
  }
});

test('maxDepth can lower the limit but never raise or disable it', () => {
  expect(() => braces('{{a,b},c}', { maxDepth: 1 })).toThrow('Input depth (2), exceeds max depth (1)');
  expect(braces('{{a,b},c}', { maxDepth: 2 })).toEqual(['((a|b)|c)']);
  for (const maxDepth of [1000, Infinity, NaN, '1000', undefined]) {
    expect(() => braces(nested('{', '}', 101), { maxDepth })).toThrow('exceeds max depth (100)');
  }
});

test('ordinary patterns compile and expand exactly as upstream 3.0.3', () => {
  const upstream = {
    'a/{b,c}/d': [['a/(b|c)/d'], ['a/b/d', 'a/c/d']],
    '{1..3}': [['([1-3])'], ['1', '2', '3']],
    '{a..c}': [['([a-c])'], ['a', 'b', 'c']],
    'src/**/*.{js,jsx}': [['src/**/*.(js|jsx)'], ['src/**/*.js', 'src/**/*.jsx']],
    'a{,b}c': [['a(|b)c'], ['ac', 'abc']],
    '{a,b{c,d}}e': [['(a|b(c|d))e'], ['ae', 'bce', 'bde']],
    'foo/({a,b})': [['foo/((a|b))'], ['foo/(a)', 'foo/(b)']],
    '/socket.io/**': [['/socket.io/**'], ['/socket.io/**']],
    'x{01..03}': [['x(0[1-3])'], ['x01', 'x02', 'x03']],
  };
  for (const [pattern, [compiled, expanded]] of Object.entries(upstream)) {
    expect(braces(pattern)).toEqual(compiled);
    expect(braces.expand(pattern)).toEqual(expanded);
  }
  expect(micromatch.isMatch('src/app/index.jsx', 'src/**/*.{js,jsx}')).toBe(true);
  expect(micromatch.isMatch('src/app/index.ts', 'src/**/*.{js,jsx}')).toBe(false);
});

test('the gateway socket pathFilter still routes only /socket.io/** with the vendored dependency installed', async () => {
  const listen = app => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    servers.push(server);
  });
  const upstream = express();
  upstream.use((req, res) => res.json({ upstreamPath: req.originalUrl }));
  const target = await listen(upstream);
  const gateway = express();
  gateway.use(createProxyMiddleware({ target, pathFilter: '/socket.io/**' }));
  gateway.use((req, res) => res.status(404).json({ gatewayPath: req.originalUrl }));
  const base = await listen(gateway);

  const proxied = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
  expect(proxied.status).toBe(200);
  expect(await proxied.json()).toEqual({ upstreamPath: '/socket.io/?EIO=4&transport=polling' });
  const local = await fetch(`${base}/api/jobs`);
  expect(local.status).toBe(404);
  expect(await local.json()).toEqual({ gatewayPath: '/api/jobs' });
});
