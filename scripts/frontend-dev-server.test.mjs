import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';

const front = createRequire(new URL('../frontend/package.json', import.meta.url));
const { adaptDevServerConfig } = front('./scripts/dev-server-config.cjs');
const { createLauncherGate } = front('./scripts/launcher-gate.cjs');
const statusFor = (url, headers) => new Promise((resolve, reject) => {
    http.get(url, { headers }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
});

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
        assert.equal(await statusFor(origin + '/', { Host: 'untrusted.example' }), 403);
    } finally {
        await server?.stop();
        if (compiler) await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
        assert.equal(path.dirname(root), path.resolve(tmpdir()));
        assert.ok(path.basename(root).startsWith('jobfind-dev-server-test-'));
        await rm(root, { recursive: true, force: true });
    }
});

test('under the launcher, page loads show progress until the app is ready', { timeout: 30000 }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jobfind-dev-server-test-'));
    const webpack = front('webpack');
    const DevServer = front('webpack-dev-server');
    const gate = createLauncherGate();
    let compiler, server;
    try {
        await writeFile(path.join(root, 'entry.js'), 'console.log("isolated dev fixture");');
        await writeFile(path.join(root, 'index.html'), '<!doctype html><title>JobFind fixture</title>');
        compiler = webpack({ mode: 'development', context: root, entry: './entry.js',
            output: { path: path.join(root, 'dist'), filename: 'bundle.js', publicPath: '/' },
            infrastructureLogging: { level: 'none' }, stats: 'none' });
        server = new DevServer(adaptDevServerConfig({ host: '127.0.0.1', port: 0,
            allowedHosts: ['127.0.0.1'], client: false, hot: false, headers: { 'Access-Control-Allow-Origin': '*' },
            static: { directory: root, watch: false }, historyApiFallback: true,
            devMiddleware: { stats: 'none' } }, { gate }), compiler);
        await server.start();
        const origin = `http://127.0.0.1:${server.server.address().port}`;
        const html = { accept: 'text/html,application/xhtml+xml' };

        const progress = await fetch(origin + '/admin/', { headers: html });
        assert.equal(progress.status, 503);
        assert.equal(progress.headers.get('cache-control'), 'no-store');
        assert.match(await progress.text(), /<title>JobFind đang khởi động<\/title>/);
        // Bundles, API-style requests and the host check are unchanged.
        const bundle = await fetch(origin + '/bundle.js');
        assert.match(await bundle.text(), /isolated dev fixture/);
        assert.equal(bundle.headers.get('access-control-allow-origin'), '*');
        assert.equal(await statusFor(origin + '/admin/', { ...html, Host: 'untrusted.example' }), 403);

        const phases = [{ phase: 'Đang chờ MySQL tại 127.0.0.1:3333', at: '2026-09-29T13:00:00.000Z' }];
        gate.update({ type: 'jobfind:launcher', status: 'starting', phase: phases[0].phase, phases, startedAt: phases[0].at });
        gate.update({ type: 'unrelated', status: 'running' });
        const status = await fetch(origin + '/__jobfind/status');
        // The launcher status is not shared with other sites through CRA's CORS headers.
        assert.equal(status.headers.get('access-control-allow-origin'), null);
        assert.deepEqual(await status.json(), { launcher: 'jobfind', status: 'starting', phase: phases[0].phase,
            error: '', startedAt: phases[0].at, phases });

        gate.update({ type: 'jobfind:launcher', status: 'running', phase: 'Ứng dụng sẵn sàng', phases, startedAt: phases[0].at });
        const app = await fetch(origin + '/admin/', { headers: html });
        assert.equal(app.status, 200);
        assert.match(await app.text(), /JobFind fixture/);
        assert.equal((await (await fetch(origin + '/__jobfind/status')).json()).status, 'running');
    } finally {
        await server?.stop();
        if (compiler) await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
        assert.equal(path.dirname(root), path.resolve(tmpdir()));
        assert.ok(path.basename(root).startsWith('jobfind-dev-server-test-'));
        await rm(root, { recursive: true, force: true });
    }
});

test('progress page shows each launcher state and opens the app once it is ready', async () => {
    const html = await new Promise(resolve => createLauncherGate().middleware({ url: '/admin/', method: 'GET', headers: { accept: 'text/html' } },
        { writeHead() {}, end: body => resolve(String(body)) }, () => resolve('')));
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
    const element = () => {
        let text = '';
        const node = { className: '', children: [], appendChild: child => node.children.push(child),
            get textContent() { return text; }, set textContent(value) { text = value; node.children = []; } };
        return node;
    };
    const elements = {};
    const document = { title: '', body: { className: '' }, createElement: element, getElementById: id => (elements[id] ??= element()) };
    const startedAt = new Date(Date.now() - 65000).toISOString();
    const phases = [{ phase: 'Kiểm tra cấu hình' }, { phase: 'Đang chờ MySQL tại 127.0.0.1:3333' }];
    const replies = [
        { launcher: 'jobfind', status: 'starting', phases, startedAt },
        { launcher: 'jobfind', status: 'failed', error: 'Không kết nối được MySQL', phases, startedAt },
        new TypeError('Failed to fetch'),
        { launcher: 'jobfind', status: 'running', phases, startedAt },
    ];
    const requested = [];
    const timers = [];
    let reloads = 0;
    vm.runInNewContext(script, { document, location: { reload: () => reloads++ }, setTimeout: poll => timers.push(poll),
        fetch: async url => {
            requested.push(url);
            const reply = replies.shift();
            if (reply instanceof Error) throw reply;
            return { json: async () => reply };
        } });
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const pollAgain = async () => { timers.shift()(); await settle(); };

    await settle();
    assert.equal(document.title, 'JobFind đang khởi động');
    assert.match(elements.summary.textContent, /^Đã chạy 1:0[4-6]\./);
    assert.deepEqual(elements.steps.children.map(step => [step.textContent, step.className]),
        [['Kiểm tra cấu hình', ''], ['Đang chờ MySQL tại 127.0.0.1:3333', 'current']]);
    await pollAgain();
    assert.equal(document.title, 'JobFind chưa khởi động được');
    assert.equal(document.body.className, 'failed');
    assert.equal(elements.error.textContent, 'Không kết nối được MySQL');
    // Once the launcher has exited, the last error stays visible while the page keeps polling.
    await pollAgain();
    assert.equal(elements.error.textContent, 'Không kết nối được MySQL');
    assert.equal(timers.length, 1);
    assert.equal(reloads, 0);
    await pollAgain();
    assert.equal(reloads, 1);
    assert.equal(timers.length, 0);
    assert.ok(requested.every(url => url === '/__jobfind/status'));
});
