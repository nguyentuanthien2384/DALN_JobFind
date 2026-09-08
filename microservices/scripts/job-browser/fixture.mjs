import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';

const front = createRequire(new URL('../../../frontend/package.json', import.meta.url));
const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const address = server => `http://127.0.0.1:${server.address().port}`;
const close = async server => { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };

export async function startBrowserFixture({ pool, legacy, legacyController, legacyDb, url, token, docker }) {
    assert.equal((await pool.query('SELECT DATABASE() AS name'))[0][0].name, 'jobfind_posting_quota_test');
    assert.equal(process.env.MYSQL_PASSWORD, token);
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const label = 'jobfind.browser-test', owned = [], servers = [];
    let gateway, directory;
    const stop = async () => {
        const failures = [];
        const cleanup = async run => { try { await run(); } catch (error) { failures.push(error); } };
        await cleanup(async () => {
            if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
                const ended = once(gateway, 'exit');
                if (gateway.connected) gateway.send('stop'); else gateway.kill();
                const timer = setTimeout(() => gateway.kill(), 35000);
                try { const [code] = await ended; assert.equal(code,0,'Gateway did not drain cleanly'); }
                finally { clearTimeout(timer); }
            }
        });
        for (const server of servers.reverse()) await cleanup(() => close(server));
        await cleanup(async () => {
            const { closeAccountStore } = await import('../../api-gateway/src/libs/accountStore.js');
            await closeAccountStore();
        });
        for (const container of owned.reverse()) {
            await cleanup(async () => {
                assert.match(container, /^[a-f0-9]{64}$/);
                assert.equal(JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', container))[label], token);
                await docker('rm', '--force', '--volumes', container);
            });
        }
        if (directory) await cleanup(async () => {
            // Only remove this invocation's mkdtemp output, never frontend/build.
            const resolved = await realpath(directory), parent = await realpath(tmpdir());
            assert.equal(path.dirname(resolved), parent);
            assert.ok(path.basename(resolved).startsWith('jobfind-browser-'));
            await rm(resolved, { recursive: true });
        });
        if (failures.length) throw new AggregateError(failures,'Browser fixture cleanup failed; check owned resources');
        console.log('Closed test browser services and removed only owned Redis and temporary bundles.');
    };
    try {
        Object.assign(process.env, { JWT_SECRET: token + token, JWT_ISSUER: 'jobfind-auth', JWT_AUDIENCE: 'jobfind-api', JWT_ACCESS_TTL_SECONDS: '900' });
        await pool.query(`CREATE TABLE accounts (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, roleCode VARCHAR(20), statusCode VARCHAR(10)) ENGINE=InnoDB`);
        await pool.query("INSERT INTO accounts(userId,roleCode,statusCode) VALUES (7,'COMPANY','S1'),(8,'EMPLOYER','S1'),(88,'ADMIN','S1'),(99,'COMPANY','S1'),(26,'CANDIDATE','S1')");
        await pool.query('UPDATE companies SET allowPost=50, allowHotPost=50 WHERE id IN (3,4)');
        // Fill ONLY missing fixture columns required by actual legacy read ORM.
        for (const [table, model] of [['users', legacyDb.User], ['companies', legacyDb.Company]]) {
            const existing = new Set((await pool.query(`SHOW COLUMNS FROM ${table}`))[0].map(column => column.Field));
            for (const [field, attribute] of Object.entries(model.rawAttributes)) {
                assert.match(field, /^[A-Za-z][A-Za-z0-9]*$/);
                if (!existing.has(field)) await pool.query(`ALTER TABLE ${table} ADD COLUMN \`${field}\` ${attribute.type.toSql()} NULL`);
            }
        }
        await pool.query('CREATE TABLE allcodes (id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(64), type VARCHAR(64), value VARCHAR(255), createdAt DATETIME, updatedAt DATETIME) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        const codes = ['GENDERPOST','JOBTYPE','JOBLEVEL','SALARYTYPE','EXPTYPE','WORKTYPE','PROVINCE'];
        for (const type of codes) await pool.query('INSERT INTO allcodes(code,type,value) VALUES (?,?,?)', [type + '-1', type, type]);
        for (const [code, value] of [['PS1','Đã kiểm duyệt'],['PS2','Đã bị từ chối'],['PS3','Chờ kiểm duyệt'],['PS4','Bài viết đã bị chặn']]) {
            await pool.query('INSERT INTO allcodes(code,type,value) VALUES (?,?,?)', [code, 'POSTSTATUS', value]);
        }
        const { optionalAuth, requireAuth, requireRole } = await import('../../api-gateway/src/middlewares/auth.js');
        const auxiliary = express(); auxiliary.use(express.json());
        auxiliary.get('/health', (_req, res) => res.json({ status: 'ok' }));
        auxiliary.post('/internal/audit-action', (_req, res) => res.status(204).end()); // no audit consumer in this test
        auxiliary.use(optionalAuth, requireAuth);
        auxiliary.use((req, _res, next) => {
            req.user.userAccountData = { roleCode: req.user.roleCode };
            req.user.userCompanyData = { id: req.user.companyId, statusCode: req.user.companyStatusCode, censorCode: req.user.companyCensorCode };
            next();
        });
        const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
        auxiliary.get('/api/get-all-code', asyncRoute(async (req, res) => res.json({ errCode: 0,
            data: (await pool.query('SELECT code,value FROM allcodes WHERE type=?', [req.query.type]))[0] })));
        auxiliary.get('/api/get-detail-company-by-userId', requireRole('COMPANY','EMPLOYER'), asyncRoute(async (req, res) => res.json({ errCode: 0,
            data: (await pool.query('SELECT allowPost,allowHotPost FROM companies WHERE id=?', [req.user.companyId]))[0][0] })));
        auxiliary.get('/api/get-all-post-admin', requireRole('ADMIN'), asyncRoute(async (req, res) => res.json(await legacy.getAllPostByAdmin(req.query))));
        auxiliary.get('/api/get-list-post-admin', requireRole('COMPANY','EMPLOYER'), asyncRoute(async (req, res) => res.json(await legacy.getListPostByAdmin({ ...req.query, companyId: req.user.companyId }))));
        auxiliary.get('/api/get-note-by-post', requireRole('ADMIN'), asyncRoute(async (req, res) => res.json(await legacy.getListNoteByPost(req.query))));
        auxiliary.get('/api/get-detail-post-by-id', requireRole('ADMIN','COMPANY','EMPLOYER'), legacyController.getDetailPostById);
        auxiliary.post('/api/create-new-post', requireRole('COMPANY','EMPLOYER'), legacyController.handleCreateNewPost);
        auxiliary.post('/api/create-reup-post', requireRole('COMPANY','EMPLOYER'), legacyController.handleReupPost);
        auxiliary.put('/api/update-post', requireRole('COMPANY','EMPLOYER'), legacyController.handleUpdatePost);
        auxiliary.put('/api/accept-post', requireRole('ADMIN'), legacyController.handleAcceptPost);
        auxiliary.put('/api/ban-post', requireRole('ADMIN'), legacyController.handleBanPost);
        auxiliary.put('/api/active-post', requireRole('ADMIN'), legacyController.handleActivePost);
        auxiliary.use((error, _req, res, _next) => { console.error('Browser auxiliary API:', error.message); res.status(500).json({ errCode: -1 }); });
        const legacyServer = await listen(auxiliary); servers.push(legacyServer);
        await docker('image', 'inspect', 'redis:7-alpine', '--format', '{{.Id}}');
        const redis = await docker('run', '--detach', '--rm', '--pull=never', '--label', `${label}=${token}`,
            '--publish', '127.0.0.1::6379', 'redis:7-alpine'); owned.push(redis);
        const redisPort = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}', redis);
        assert.match(redisPort, /^\d+$/);
        const auxiliaryUrl = address(legacyServer);
        // Fresh allowlisted child environment: cannot inherit provider keys or a
        // production URL/DB/Redis/proxy from this shell or any .env.
        const env = Object.fromEntries(['PATH','Path','SystemRoot','TEMP','TMP','HOME','USERPROFILE'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
        Object.assign(env, { NODE_ENV: 'test', PORT: '0', JOBFIND_BROWSER_FIXTURE: 'owned-disposable',
            MYSQL_HOST: '127.0.0.1', MYSQL_PORT: process.env.MYSQL_PORT, MYSQL_USER: 'root', MYSQL_PASSWORD: token,
            MYSQL_DATABASE: 'jobfind_posting_quota_test', JWT_SECRET: token + token, JWT_ISSUER: 'jobfind-auth', JWT_AUDIENCE: 'jobfind-api', JWT_ACCESS_TTL_SECONDS: '900',
            INTERNAL_SECRET: token, REDIS_URL: `redis://127.0.0.1:${redisPort}`, JOB_CORE_URL: new URL(url).origin,
            LEGACY_URL: auxiliaryUrl, ADMIN_URL: auxiliaryUrl, IDENTITY_URL: auxiliaryUrl, SEARCH_URL: auxiliaryUrl, APPLICATION_URL: auxiliaryUrl,
            CORS_ORIGIN: auxiliaryUrl, TRUST_PROXY: '', LOG_LEVEL: 'error', PROXY_TIMEOUT_MS: '4000' });
        gateway = fork(fileURLToPath(new URL('./gateway-child.mjs', import.meta.url)), [], { env, stdio: ['ignore','pipe','pipe','ipc'], windowsHide: true });
        let log = ''; for (const output of [gateway.stdout, gateway.stderr]) output.on('data', chunk => { log = (log + chunk).slice(-5000); });
        const port = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Gateway did not start: ' + log)), 15000);
            gateway.once('message', message => { clearTimeout(timeout); resolve(message.port); });
            gateway.once('exit', code => { clearTimeout(timeout); reject(new Error(`Gateway exited ${code}: ${log}`)); });
            gateway.once('error', error => { clearTimeout(timeout); reject(error); });
        });
        assert.ok(Number.isSafeInteger(port) && port > 0);
        const gatewayUrl = `http://127.0.0.1:${port}`;
        directory = await mkdtemp(path.join(tmpdir(), 'jobfind-browser-'));
        const webpack = front('webpack');
        for (const mode of ['core','legacy']) {
            const defines = Object.fromEntries(['CREATE','EDIT','REPOST','WORKSPACE'].map(kind => [`process.env.REACT_APP_JOB_${kind}_MODE`, JSON.stringify(mode)]));
            const compiler = webpack({ mode: 'development', devtool: false,
                entry: front.resolve('./test-browser/job-workspace.jsx'), output: { path: directory, filename: mode + '.js' },
                resolve: { extensions: ['.js','.jsx'], modules: [path.dirname(front.resolve('react/package.json')), path.join(path.dirname(front.resolve('./package.json')), 'node_modules'), 'node_modules'] },
                module: { rules: [
                    { test: /\.jsx?$/, exclude: /node_modules/, use: { loader: front.resolve('babel-loader'), options: { babelrc: false, configFile: false,
                        presets: [[front.resolve('babel-preset-react-app'), { runtime: 'automatic' }]] } } },
                    { test: /\.css$/, use: [front.resolve('style-loader'), front.resolve('css-loader')] },
                    { test: /\.(png|svg|jpg|gif|woff2?|ttf|eot)$/, type: 'asset/resource' }
                ] }, plugins: [new webpack.DefinePlugin({ ...defines, 'process.env.REACT_APP_BACKEND_URL': JSON.stringify('/'),
                    'process.env.NODE_ENV': JSON.stringify('development') })] });
            const result = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
            await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
            if (result.hasErrors()) throw new Error(result.toString({ all: false, errors: true }));
        }
        const ui = express(); ui.use(createProxyMiddleware({ target: gatewayUrl, pathFilter: '/api/**' }));
        ui.use('/assets', express.static(directory));
        ui.get('*', (req, res) => {
            const mode = ['core','legacy'].includes(req.query.bundle) ? req.query.bundle
                : /jobfind-test-bundle=legacy/.test(req.headers.cookie || '') ? 'legacy' : 'core';
            if (req.query.bundle) res.cookie('jobfind-test-bundle', mode, { httpOnly: true, sameSite: 'strict' });
            res.setHeader('Cache-Control','no-store');
            res.send(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>JobFind isolated browser test</title><div id="root"></div><script src="/assets/${mode}.js"></script></html>`);
        });
        const uiServer = await listen(ui); servers.push(uiServer);
        const issue = (id, expired = false) => jwt.sign({ sub: String(id), ...(expired && { iat: Math.floor(Date.now()/1000)-1200 }) }, token + token,
            { algorithm:'HS256', issuer:'jobfind-auth', audience:'jobfind-api', expiresIn:900 });
        return { uiUrl: address(uiServer), gatewayUrl, issue, stop };
    } catch (error) { await stop(); throw error; }
}
