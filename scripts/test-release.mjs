import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { verify, sha256 } from './release/verify.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireMicro = createRequire(path.join(root, 'microservices/package.json'));
const { chromium, expect } = requireMicro('playwright/test');
const requireFrontend = createRequire(path.join(root, 'frontend/package.json'));
const { io } = requireFrontend('socket.io-client');
const kit = path.resolve(process.argv[2] || path.join(root, '.local/releases', (await readFile(path.join(root, '.local/releases/LATEST'), 'utf8')).trim()));
const manifest = await verify(kit);
const id = 'jobfind-release-test-' + randomBytes(4).toString('hex');
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, ...options }).trim();
const docker = (...args) => run('docker', args);
const inspect = name => JSON.parse(docker('inspect', name))[0];
const image = role => manifest.images.find(i => i.role === role).id;
const env = values => Object.entries(values).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
const checks = [];
const pass = (name, detail = {}) => { checks.push({ name, status: 'passed', ...detail }); console.log('PASS ' + name); };
const containers = new Set();
const report = { releaseId: manifest.releaseId, manifestSha256: await sha256(path.join(kit, 'manifest.json')), startedAt: new Date().toISOString(), checks, status: 'failed', cleaned: false };
let browser, origin, webPort;
const sourceState = () => {
    const ids = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal').split(/\s+/).filter(Boolean);
    return JSON.parse(docker('inspect', ...ids)).map(c => ({ id: c.Id, status: c.State.Status, started: c.State.StartedAt, finished: c.State.FinishedAt })).sort((a, b) => a.id.localeCompare(b.id));
};
const sourceBefore = sourceState();
const start = (name, args, network = id) => {
    const full = `${id}-${name}`; containers.add(full);
    docker('run', '-d', '--name', full, '--label', `jobfind.release-test=${id}`, '--network', network, ...args);
    return full;
};
const waitFor = async (probe, timeout = 60000) => {
    const until = Date.now() + timeout; let failure;
    do { try { return await probe(); } catch (error) { failure = error; await new Promise(r => setTimeout(r, 400)); } } while (Date.now() < until);
    throw failure;
};
const hardened = ['--read-only', '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true'];
const jwt = 'release-test-jwt-only-0123456789-abcdef';
async function switchWeb(variant) {
    const full = `${id}-web`;
    if (containers.has(full)) { docker('stop', '-t', '10', full); docker('rm', full); containers.delete(full); }
    // Docker Desktop does not publish host ports on an internal-only network.
    // Only static web joins this loopback transport bridge; stores stay internal.
    start('web', [...hardened, '-p', `127.0.0.1:${webPort || ''}:8080`, image('web-' + variant)], id + '-web');
    docker('network', 'connect', id, full);
    webPort = inspect(full).NetworkSettings.Ports['8080/tcp'][0].HostPort;
    origin = `http://127.0.0.1:${webPort}`;
    await waitFor(async () => {
        const res = await fetch(origin + '/release-info.json'); assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const info = await res.json(); const { image: _, ...expected } = manifest.variants[variant]; assert.deepEqual(info, expected);
    });
    assert.equal(inspect(full).HostConfig.ReadonlyRootfs, true);
    assert.notEqual(inspect(full).Config.User, 'root');
    // public/login is an asset directory, but /login is also a React route.
    // A directory redirect leaks the internal port and breaks real sign-in.
    for (const route of ['/login', '/login/', '/admin/list-post', '/candidate/cv-post']) {
        const response = await fetch(origin + route, { redirect: 'manual' });
        assert.equal(response.status, 200, 'SPA route must serve the app shell: ' + route);
        assert.match(await response.text(), /id="root"/);
    }
    const loginAsset = await fetch(origin + '/login/images/form-v8.jpg');
    assert.equal(loginAsset.status, 200); assert.match(loginAsset.headers.get('content-type'), /image/);
}
try {
    pass('complete kit checksum verification');
    // Pure parse with synthetic credentials; never load the real environment or print interpolated config.
    const dummy = { MYSQL_HOST: 'mysql', MYSQL_PORT: '3306', MYSQL_DATABASE: 'fixture', MYSQL_USER: 'fixture', MYSQL_PASSWORD: 'fixture-password', POSTGRES_USER: 'fixture', POSTGRES_PASSWORD: 'fixture-password', RABBITMQ_USER: 'fixture', RABBITMQ_PASSWORD: 'fixture-password', JWT_SECRET: jwt, INTERNAL_SECRET: 'release-internal-only-0123456789', METRICS_TOKEN_FILE: path.join(kit, 'README.md'), ANTHROPIC_API_KEY: 'synthetic-not-a-provider-key', CLAUDE_MODEL: 'synthetic-model' };
    Object.assign(dummy, { CLOUD_NAME: 'fixture', API_KEY: 'fixture', API_SECRET: 'fixture', PAYPAL_CLIENT_ID: 'fixture', PAYPAL_CLIENT_SECRET: 'fixture' });
    const work = path.join(root, '.local/release-work', manifest.releaseId); await mkdir(work, { recursive: true });
    const empty = path.join(work, 'test-empty.env'); await writeFile(empty, '');
    for (const variant of ['rollback', 'deployment']) {
        const args = ['compose', '--env-file', empty, '-f', path.join(kit, 'compose.json'), '-f', path.join(kit, `compose.${variant}.json`), 'config', '--format', 'json'];
        const parsed = JSON.parse(run('docker', args, { env: { ...process.env, ...dummy } }));
        assert.equal(Object.keys(parsed.services).length, 10);
        assert.equal(parsed.services.web.image, manifest.variants[variant].image);
        assert.equal(parsed.services.backend.image, image('backend'));
        assert.equal(parsed.services.backend.environment.INTERNAL_SECRET, dummy.INTERNAL_SECRET);
        assert.equal(parsed.services['api-gateway'].environment.LEGACY_URL, 'http://backend:5000');
        assert.equal(parsed.services['api-gateway'].environment.MYSQL_PASSWORD, dummy.MYSQL_PASSWORD);
        assert.equal(parsed.services['notification-service'].environment.EMAIL_APP, '');
        assert.equal(parsed.services['notification-service'].environment.EMAIL_APP_PASSWORD, '');
        assert.equal(parsed.services['notification-service'].environment.LEGACY_URL, 'http://backend:5000');
        assert.equal(parsed.services['ai-worker'].environment.ANTHROPIC_API_KEY, dummy.ANTHROPIC_API_KEY);
        assert.equal(parsed.services['ai-worker'].environment.CLAUDE_MODEL, dummy.CLAUDE_MODEL);
        assert.match(parsed.services.backend.environment.RABBITMQ_URL, /@rabbitmq:5672$/);
        assert.equal(parsed.networks.default.external, true);
        for (const [name, service] of Object.entries(parsed.services)) {
            assert.match(service.image, /^sha256:[a-f0-9]{64}$/); assert.equal(service.pull_policy, 'never');
            assert.ok(!service.build && !service.volumes?.length && !service.depends_on);
            assert.equal(service.read_only, true);
            if (!['web', 'backend'].includes(name)) assert.equal(service.image, image('microservices'));
        }
    }
    pass('both pinned Compose variants parse; no data volumes, builds or dependencies to recreate');
    const independentRollback = JSON.parse(run('docker', ['compose', '--env-file', empty, '-f', path.join(kit, 'compose.web.rollback.json'), 'config', '--format', 'json']));
    assert.deepEqual(Object.keys(independentRollback.services), ['web']);
    assert.equal(independentRollback.services.web.image, manifest.variants.rollback.image);
    assert.equal(independentRollback.name, 'ai-job-portal');
    pass('standalone web rollback requires no provider or secret bindings');
    run(process.execPath, [path.join(root, 'microservices/scripts/test-image.mjs')], { env: { ...process.env, JOBFIND_IMAGE: image('microservices') }, timeout: 90000 });
    pass('packaged microservices: offline readiness, auth, contracts, non-root and graceful shutdown');
    let refused = false;
    try { docker('run', '--rm', '--network', 'none', ...hardened, '-w', '/app/ai-worker', image('microservices'), 'node', 'src/app.js'); }
    catch (error) { assert.equal(error.status, 1); assert.match(String(error.stdout) + String(error.stderr), /ANTHROPIC_API_KEY/); refused = true; }
    assert.equal(refused, true); pass('packaged Worker fails closed without provider configuration');

    docker('network', 'create', '--internal', '--label', `jobfind.release-test=${id}`, id);
    docker('network', 'create', '--label', `jobfind.release-test=${id}`, id + '-web');
    const fixtureMysqlImage = JSON.parse(docker('image', 'inspect', 'mariadb:10.4.32'))[0].Id;
    report.fixtureMysqlImage = fixtureMysqlImage;
    const mysql = start('mysql', ['--network-alias', 'mysql', '--tmpfs', '/var/lib/mysql', ...env({ MYSQL_ROOT_PASSWORD: 'release-root-only', MYSQL_DATABASE: 'fixture' }), fixtureMysqlImage]);
    await waitFor(() => docker('exec', mysql, 'mysqladmin', '-uroot', '-prelease-root-only', 'ping', '--silent'));
    const backend = start('backend', [...hardened, '--network-alias', 'backend', ...env({ NODE_ENV: 'development', DB_HOST: 'mysql', DB_PORT: '3306', DB_USER: 'root', DB_PASSWORD: 'release-root-only', DB_NAME: 'fixture', JWT_SECRET: jwt, SCHEDULED_JOBS_ENABLED: 'false' }), image('backend')]);
    await waitFor(() => docker('exec', backend, 'node', '-e', "fetch('http://127.0.0.1:5000/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"));
    docker('exec', backend, 'node', '-e', "fetch('http://127.0.0.1:5000/api/auth/me').then(r=>{if(r.status!==401)process.exit(1)}).catch(()=>process.exit(1))");
    assert.ok(inspect(backend).Config.Env.includes('SCHEDULED_JOBS_ENABLED=false'));
    pass('packaged real Backend/Socket boots with disposable MariaDB; health and auth gates');
    const gateway = start('gateway', [...hardened, '--network-alias', 'api-gateway', ...env({ JWT_SECRET: jwt, MYSQL_HOST: 'mysql', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: 'release-root-only', MYSQL_DATABASE: 'fixture', LEGACY_URL: 'http://backend:5000', REDIS_URL: 'redis://127.0.0.1:9' }), image('microservices')]);
    await waitFor(() => docker('exec', gateway, 'node', '-e', "fetch('http://127.0.0.1:4000/healthz').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"));
    await switchWeb('deployment');
    const api = await fetch(origin + '/api/profile'); assert.equal(api.status, 401);
    const socketResponse = await fetch(origin + '/socket.io/?EIO=4&transport=polling'); assert.equal(socketResponse.status, 200); assert.match(await socketResponse.text(), /^0\{/);
    await new Promise((resolve, reject) => {
        const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5000, forceNew: true });
        const timer = setTimeout(() => { socket.close(); reject(Error('Socket auth probe timeout')); }, 8000);
        socket.on('connect', () => { clearTimeout(timer); socket.close(); reject(Error('Unauthenticated socket connected')); });
        socket.on('connect_error', error => { clearTimeout(timer); socket.close(); try { assert.equal(error.message, 'UNAUTHORIZED'); resolve(); } catch (e) { reject(e); } });
    });
    pass('Nginx same-origin API and real Socket polling/WebSocket proxy with authentication');

    browser = await chromium.launch({ headless: true, ...(process.env.JOBFIND_TEST_BROWSER_CHANNEL && { channel: process.env.JOBFIND_TEST_BROWSER_CHANNEL }) });
    const context = await browser.newContext();
    await context.addInitScript(() => { if (window.top !== window) return; localStorage.setItem('token_user', 'release-ui-synthetic'); localStorage.setItem('userData', JSON.stringify({ id: 8, roleCode: 'CANDIDATE', firstName: 'Synthetic', lastName: 'Candidate' })); });
    const posts = []; let rolledBack = false;
    await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (url.pathname === '/api/auth/me') return reply({ errCode: 0, data: { userId: 8, roleCode: 'CANDIDATE', companyId: null } });
        if (url.pathname === '/api/ai/match-cv' && request.method() === 'POST') {
            posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() });
            return rolledBack ? reply({ errCode: 0, taskId: 'release-task' }) : reply({ errCode: -1 }, 503);
        }
        if (url.pathname.startsWith('/api/ai/tasks/')) return reply({ errCode: 0, data: { id: 'release-task', type: 'match_cv', status: 'done', result: { score: 80, summary: 'Synthetic match', matchedSkills: ['Node'], missingSkills: [], strengths: [], concerns: [] } } });
        if (url.pathname.startsWith('/api/')) return reply({ errCode: 0, data: [], count: 0 });
        return route.continue();
    });
    const page = await context.newPage(); const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin + '/candidate/ai-cv');
    await page.getByLabel('Chức năng').selectOption('match_cv');
    await page.getByLabel('Nội dung CV').fill('Synthetic Node experience');
    await page.getByLabel('Mã công việc').fill('7');
    await page.getByRole('button', { name: 'Gửi yêu cầu AI', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đối chiếu yêu cầu đã gửi', exact: true })).toBeVisible();
    const pending = await page.evaluate(() => sessionStorage.getItem('jobfind.ai.intent.v1.8'));
    assert.equal(posts.length, 1); assert.match(posts[0].key, /^[a-f0-9]{32}$/); assert.ok(pending && !pending.includes('Synthetic Node experience'));
    const originalOrigin = origin;
    await switchWeb('rollback'); rolledBack = true; assert.equal(origin, originalOrigin);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Đối chiếu yêu cầu đã gửi', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('jobfind.ai.intent.v1.8')), pending);
    assert.equal(posts.length, 1, 'rollback/reload must not auto-post');
    await page.getByLabel('Nội dung CV').fill('Different content'); await page.getByLabel('Mã công việc').fill('7');
    await page.getByRole('button', { name: 'Đối chiếu yêu cầu đã gửi', exact: true }).click();
    await expect(page.getByText(/Hãy chọn lại đúng/)).toBeVisible(); assert.equal(posts.length, 1);
    await page.getByLabel('Nội dung CV').fill('Synthetic Node experience');
    await page.getByRole('button', { name: 'Đối chiếu yêu cầu đã gửi', exact: true }).click();
    await expect(page.getByText('80/100', { exact: true })).toBeVisible(); assert.equal(posts.length, 2); assert.deepEqual(posts[1], posts[0]);
    assert.deepEqual(pageErrors, []);
    const fresh = await context.newPage(); await fresh.goto(origin + '/candidate/ai-cv');
    await expect(fresh.getByRole('button', { name: 'Gửi yêu cầu AI', exact: true })).toBeDisabled();
    pass('exact frontend image swap at same origin: pending survives; no auto-send; altered payload blocked; original key replay; new AI disabled', { api: 'synthetic browser responses; no provider calls' });
    for (const variant of ['rollback', 'deployment']) {
        await switchWeb(variant);
        const html = await (await fetch(origin + '/')).text();
        const js = html.match(/src="([^"]+\/static\/js\/[^"]+)"/)?.[1] || html.match(/src="(\/static\/js\/[^"]+)"/)?.[1]; assert.ok(js);
        const asset = await fetch(new URL(js, origin)); assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /immutable/);
        assert.equal((await fetch(origin + '/static/js/missing.js')).status, 404);
        pass('served ' + variant + ' bundle and cache policy', { mainBundle: js, mainBundleSha256: (await import('node:crypto')).createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex') });
    }
    docker('stop', '-t', '20', backend); assert.equal(inspect(backend).State.ExitCode, 0);
    pass('packaged Backend/Socket graceful shutdown');
    assert.deepEqual(sourceState(), sourceBefore); report.sourceUnchanged = true; report.status = 'passed';
} catch (error) {
    report.failure = error.message;
    throw error;
} finally {
    await browser?.close();
    for (const name of containers) { try { docker('rm', '-f', '-v', name); } catch { /* Report residuals below. */ } }
    try { docker('network', 'rm', id); } catch { /* May not have been created. */ }
    try { docker('network', 'rm', id + '-web'); } catch { /* May not have been created. */ }
    report.cleaned = !docker('ps', '-aq', '--filter', `label=jobfind.release-test=${id}`) && !docker('network', 'ls', '-q', '--filter', `label=jobfind.release-test=${id}`);
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(root, 'microservices/docs/release-preparation.json'), JSON.stringify(report, null, 2) + '\n');
    if (!report.cleaned) throw new Error('Release test resources require cleanup: ' + id);
}
