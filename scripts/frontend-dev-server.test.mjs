import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const front = createRequire(new URL('../frontend/package.json', import.meta.url));
const { adaptDevServerConfig } = front('./scripts/dev-server-config.cjs');

test('development server adapter preserves HTTPS and host restrictions', () => {
    const tls = { cert: 'fixture certificate', key: 'fixture key' };
    const config = adaptDevServerConfig({ https: tls, allowedHosts: ['localhost'] });
    assert.deepEqual(config.server, { type: 'https', options: tls });
    assert.deepEqual(config.allowedHosts, ['localhost']);
    assert.equal('https' in config, false);
    assert.deepEqual(adaptDevServerConfig({ https: true }).server, { type: 'https', options: {} });
});

test('patched development server serves assets, SPA routes and CRA middleware in order', { timeout: 30000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobfind-dev-server-test-'));
    const webpack = front('webpack');
    const DevServer = front('webpack-dev-server');
    let compiler, server;
    try {
        await writeFile(path.join(root, 'entry.js'), 'console.log("isolated dev fixture");');
        await writeFile(path.join(root, 'index.html'), '<!doctype html><title>JobFind fixture</title>');
        compiler = webpack({ mode: 'development', context: root, entry: './entry.js',
            output: { path: path.join(root, 'dist'), filename: 'bundle.js', publicPath: '/' },
            infrastructureLogging: { level: 'none' }, stats: 'none' });
        const config = adaptDevServerConfig({ host: '127.0.0.1', port: 0,
            allowedHosts: ['127.0.0.1'], client: false, hot: false,
            static: { directory: root, watch: false }, historyApiFallback: true,
            devMiddleware: { stats: 'none' },
            onBeforeSetupMiddleware(dev) {
                dev.app.get('/fixture-before', (_req, res) => res.end('before'));
            },
            onAfterSetupMiddleware(dev) {
                dev.app.get('/service-worker.js', (_req, res) => res.end('fixture worker'));
            }
        });
        server = new DevServer(config, compiler);
        await server.start();
        const origin = `http://127.0.0.1:${server.server.address().port}`;
        assert.equal(await (await fetch(origin + '/fixture-before')).text(), 'before');
        assert.match(await (await fetch(origin + '/bundle.js')).text(), /isolated dev fixture/);
        assert.match(await (await fetch(origin + '/job/deep-link', { headers: { accept: 'text/html' } })).text(), /JobFind fixture/);
        assert.equal(await (await fetch(origin + '/service-worker.js')).text(), 'fixture worker');
        const rejectedHost = await new Promise((resolve, reject) => {
            http.get(origin + '/', { headers: { Host: 'untrusted.example' } }, response => {
                response.resume(); response.on('end', () => resolve(response.statusCode));
            }).on('error', reject);
        });
        assert.equal(rejectedHost, 403);
    } finally {
        await server?.stop();
        if (compiler) await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
        assert.equal(path.dirname(root), path.resolve(tmpdir()));
        assert.ok(path.basename(root).startsWith('jobfind-dev-server-test-'));
        await rm(root, { recursive: true, force: true });
    }
});
