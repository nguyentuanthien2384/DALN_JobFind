import fs from 'node:fs/promises';
import { openSync, closeSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { backupMysql, backupContainer, writeBackupManifest } from './backup-local.mjs';
import { alive, stopChild, ownedSupervisor, effectiveState, waitFor as waitUntil, runLoggedCommand, withStartLock, releaseOwnedLock, reconcileAiWorker, localComposeEnvironment, claudeRuntimeMatches, canConnect, awaitService, followLaunch, awaitSupervisorPublication } from './dev-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const local = path.join(root, '.local');
const stateFile = path.join(local, 'runtime.json');
const stopFile = path.join(local, 'stop.json');
const lockFile = path.join(local, 'runtime.lock');
const project = 'ai-job-portal';
const exec = promisify(execFile);
const require = createRequire(path.join(root, 'backend/package.json'));
const dotenv = require('dotenv');
const action = process.argv[2] || 'start';
const infrastructure = ['mongo', 'postgres', 'redis', 'rabbitmq', 'elasticsearch'];
const baseApplications = ['identity-service', 'application-service', 'notification-service', 'admin-service', 'job-core-service', 'search-service', 'support-chat-service', 'api-gateway'];
const applicationPorts = { 'identity-service': 4001, 'application-service': 4004, 'notification-service': 4005,
    'admin-service': 4006, 'job-core-service': 4002, 'search-service': 4003, 'support-chat-service': 4008,
    'api-gateway': 4000, 'ai-worker': 4007 };
const composeBase = ['compose', '-p', project, '-f', 'docker-compose.yml'];
const composeApps = [...composeBase, '-f', 'compose.local.yml', '-f', 'compose.runtime.yml'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let dockerEnvironment = process.env;
const readState = async () => { try { return JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { return null; } };
let lifecycleSignal;
let stateWrites = Promise.resolve();
const writeState = state => {
    const serialized = JSON.stringify(state, null, 2);
    stateWrites = stateWrites.catch(() => {}).then(async () => {
        await fs.writeFile(stateFile + '.tmp', serialized); await fs.rename(stateFile + '.tmp', stateFile);
    });
    return stateWrites;
};
const command = async (args, options = {}) => {
    try { return (await exec('docker', args, { cwd: path.join(root, 'microservices'), windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, signal: lifecycleSignal, env: dockerEnvironment, ...options })).stdout.trim(); }
    catch { throw new Error(`Docker không hoàn thành thao tác ${args.slice(0, 2).join(' ')}. Xem .local/docker.log.`); }
};
const longCommand = (args, env) => runLoggedCommand('docker', args, { cwd: path.join(root, 'microservices'), env,
    file: path.join(local, 'docker.log'), signal: lifecycleSignal });
const containerId = async service => {
    const rows = (await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=com.docker.compose.service=${service}`])).split(/\s+/).filter(Boolean);
    if (rows.length > 1) throw new Error(`Có nhiều container ${service}; cần kiểm tra trước khi chạy.`);
    return rows[0];
};
const runningContainerEnvironment = async service => {
    const id = await containerId(service);
    if (!id) return null;
    const [container] = JSON.parse(await command(['inspect', id]));
    if (!container?.State?.Running) return null;
    return Object.fromEntries(container.Config.Env.map(entry => {
        const at = entry.indexOf('=');
        return [entry.slice(0, at), entry.slice(at + 1)];
    }));
};
const currentClaudeConfiguration = async () => {
    const micro = dotenv.parse(await fs.readFile(path.join(root, 'microservices/.env')));
    const [worker, chat] = await Promise.all(['ai-worker', 'support-chat-service'].map(runningContainerEnvironment));
    return claudeRuntimeMatches(micro, worker, chat);
};
const waitFor = (check, label, timeout = 180000) => waitUntil(check, label, { timeout, signal: lifecycleSignal });
const httpOk = async url => { const res = await fetch(url, { signal: AbortSignal.timeout(5000) }); await res.body?.cancel(); return res.ok; };
const freePort = port => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Cổng ${port} đang được sử dụng. Chọn JOBFIND_WEB_PORT hoặc JOBFIND_BACKEND_PORT khác.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
});
const dockerReady = () => command(['info', '--format', '{{.ServerVersion}}'], { timeout: 15000 }).then(() => true, () => false);
// Explorer opens it exactly like the Start menu does, outside this launcher's
// process tree, so stopping JobFind never takes Docker Desktop down with it.
const openDockerDesktop = () => {
    const app = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
    if (process.platform !== 'win32' || !existsSync(app)) return false;
    spawn('explorer.exe', [app], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return true;
};
// MySQL stays under the developer's control (XAMPP); the launcher waits for it
// and says what to start instead of failing after npm start has returned.
async function awaitPrerequisites(backend, update) {
    const host = backend.DB_HOST || '127.0.0.1', port = Number(backend.DB_PORT || 3306);
    const dockerUp = await dockerReady();
    const dockerOpening = !dockerUp && openDockerDesktop();
    await awaitService(() => canConnect(host, port), { timeout: 600000, onWaiting: update, signal: lifecycleSignal,
        waiting: `Đang chờ MySQL tại ${host}:${port} – hãy bật MySQL (Start MySQL trong XAMPP Control Panel)`,
        failed: `Không kết nối được MySQL tại ${host}:${port} (DB_HOST/DB_PORT trong backend/.env). Bật MySQL rồi chạy lại npm start.` });
    if (!dockerUp) await awaitService(dockerReady, { timeout: 300000, interval: 3000, onWaiting: update, signal: lifecycleSignal,
        waiting: dockerOpening ? 'Đang mở Docker Desktop (thường mất 1–2 phút)' : 'Đang chờ Docker – hãy mở Docker Desktop',
        failed: 'Docker chưa sẵn sàng sau 5 phút. Mở Docker Desktop, chờ Engine running rồi chạy lại npm start.' });
}

async function serve() {
    let lock;
    try { lock = await fs.open(lockFile, 'wx'); await lock.writeFile(String(process.pid)); }
    catch { throw new Error('Một phiên khởi chạy khác đang tồn tại. Dùng npm run dev:status.'); }
    const instance = process.argv[3] || randomUUID();
    const startedAt = new Date().toISOString();
    const state = { instance, pid: process.pid, workspace: root, startedAt, status: 'starting', phase: 'Kiểm tra cấu hình',
        phases: [{ phase: 'Kiểm tra cấu hình', at: startedAt }], children: [] };
    const children = [];
    let frontend;
    let stopping = false;
    let failure;
    let appsStarted = false;
    let applications = baseApplications;
    const controller = new AbortController();
    lifecycleSignal = controller.signal;
    let monitor;
    // The dev server shows this on the web port (frontend/scripts/launcher-gate.cjs).
    const notifyFrontend = () => {
        if (!frontend?.connected) return;
        const { status, phase, phases, error } = state;
        try { frontend.send({ type: 'jobfind:launcher', status, phase, phases, error, startedAt }, () => {}); } catch {}
    };
    // Steps are what npm start and the progress page list; shutdown messages are not.
    const update = async (phase, { step = true } = {}) => {
        state.phase = phase;
        if (step) state.phases.push({ phase, at: new Date().toISOString() });
        notifyFrontend(); await writeState(state); console.log(`${new Date().toISOString()} ${phase}`);
    };
    const shutdown = async (error) => {
        if (stopping) return;
        stopping = true;
        failure ||= error instanceof Error ? error : undefined;
        controller.abort(failure || new Error('Đã yêu cầu dừng ứng dụng.'));
        clearInterval(monitor);
        state.status = 'stopping';
        if (failure) state.error = failure.message;
        await update('Đang dừng ứng dụng', { step: false }).catch(() => {});
        // The web server goes last so an open progress page can still show why the launch stopped.
        for (const child of children.reverse()) {
            if (child !== frontend) stopChild(child);
        }
        if (appsStarted) await command([...composeApps, 'stop', ...applications], { signal: undefined, timeout: 60000 }).catch(() => {});
        state.status = failure ? 'failed' : 'stopped'; state.children = [];
        await update(failure ? 'Khởi chạy chưa hoàn tất: ' + failure.message : 'Đã dừng; cơ sở dữ liệu vẫn được giữ', { step: false }).catch(() => {});
        if (failure && frontend?.connected) await sleep(1500);
        if (frontend) stopChild(frontend);
        await lock.close(); await releaseOwnedLock(lockFile, process.pid);
        process.exit(failure ? 1 : 0);
    };
    const launchNode = async (name, entry, args, cwd, env, { ipc = false } = {}) => {
        lifecycleSignal.throwIfAborted();
        const output = openSync(path.join(local, name + '.log'), 'a');
        const child = spawn(process.execPath, [entry, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', output, output, ...(ipc ? ['ipc'] : [])] });
        closeSync(output); children.push(child); state.children.push({ name, pid: child.pid });
        child.on('error', error => { if (!stopping) void shutdown(new Error(`${name}: ${error.code || 'không thể khởi chạy'}`)); });
        child.on('exit', code => { if (!stopping) void shutdown(new Error(`${name} đã dừng (${code}); xem .local/${name}.log`)); });
        await writeState(state);
        return child;
    };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
    monitor = setInterval(async () => {
        try { const request = JSON.parse(await fs.readFile(stopFile, 'utf8')); if (request.instance === instance) await shutdown(); } catch {}
    }, 500);
    try {
        await writeState(state);
        const backend = dotenv.parse(await fs.readFile(path.join(root, 'backend/.env')));
        const micro = dotenv.parse(await fs.readFile(path.join(root, 'microservices/.env')));
        if (!backend.JWT_SECRET || backend.JWT_SECRET !== micro.JWT_SECRET || backend.JWT_SECRET.length < 32) throw new Error('JWT_SECRET cần ít nhất 32 ký tự và phải khớp ở hai file .env.');
        if (!backend.INTERNAL_SECRET || backend.INTERNAL_SECRET !== micro.INTERNAL_SECRET) throw new Error('INTERNAL_SECRET chưa khớp ở hai file .env.');
        const webPort = Number(process.env.JOBFIND_WEB_PORT || 3001), backendPort = Number(process.env.JOBFIND_BACKEND_PORT || backend.PORT || 5000);
        if (![webPort, backendPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535)) throw new Error('Cổng ứng dụng phải từ 1024 đến 65535.');
        await freePort(webPort); await freePort(backendPort);
        state.webUrl = `http://localhost:${webPort}`; state.apiUrl = 'http://localhost:4000';
        dockerEnvironment = localComposeEnvironment(process.env, micro, { JOBFIND_WEB_PORT: String(webPort), JOBFIND_BACKEND_PORT: String(backendPort) });
        // Own the web port first: until the APIs are ready the browser gets a
        // progress page instead of "connection refused".
        await update('Khởi động giao diện tuyển dụng');
        await exec(process.execPath, ['scripts/copy-pdf-assets.cjs'], { cwd: path.join(root, 'frontend'), windowsHide: true, timeout: 60000, signal: lifecycleSignal });
        frontend = await launchNode('frontend', path.join(root, 'frontend/scripts/start.cjs'), [], path.join(root, 'frontend'), {
            ...process.env, NODE_ENV: 'development', BROWSER: 'none', HOST: '0.0.0.0', PORT: String(webPort),
            REACT_APP_BACKEND_URL: state.apiUrl,
        }, { ipc: true });
        notifyFrontend();
        waitFor(() => canConnect('127.0.0.1', webPort, 1000), 'Giao diện', 120000)
            .then(() => { state.webListening = true; return writeState(state); }).catch(() => {});
        await update('Kiểm tra Docker và MySQL');
        await awaitPrerequisites(backend, update);
        // A worker from a previous keyed run must not keep consuming with stale credentials.
        if (await reconcileAiWorker(micro.ANTHROPIC_API_KEY, containerId,
            service => command([...composeApps, 'stop', service]))) applications = [...baseApplications, 'ai-worker'];
        const directory = path.join(local, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
        await fs.mkdir(directory, { recursive: true });
        await update('Sao lưu MySQL đang có trước khi khởi chạy');
        const mysqlBackup = await backupMysql(root, backend, directory, { signal: lifecycleSignal });
        state.backup = directory;
        await update('Khởi động các kho dữ liệu và hàng đợi hiện có');
        for (const service of infrastructure) {
            const id = await containerId(service);
            if (id) await command(['start', id]);
            else await longCommand([...composeBase, 'up', '-d', '--no-deps', service], dockerEnvironment);
        }
        await waitFor(async () => {
            const ids = await Promise.all(infrastructure.map(containerId));
            const containers = JSON.parse(await command(['inspect', ...ids]));
            return containers.every(item => item.State.Running && item.State.Health?.Status === 'healthy');
        }, 'MySQL phụ trợ / MongoDB / PostgreSQL / RabbitMQ / Elasticsearch / Redis');
        await update('Sao lưu dữ liệu hồ sơ và nhật ký hiện có');
        await backupContainer(root, ['exec', await containerId('postgres'), 'pg_dump', '-U', micro.POSTGRES_USER, '-d', 'application_db', '-Fc'], path.join(directory, 'postgres.dump'), { signal: lifecycleSignal });
        await backupContainer(root, ['exec', await containerId('mongo'), 'mongodump', '--archive', '--gzip', '--quiet'], path.join(directory, 'mongo.archive.gz'), { signal: lifecycleSignal });
        await writeBackupManifest(directory, { mysql: mysqlBackup });
        await update('Chuẩn bị các dịch vụ từ mã nguồn hiện tại');
        await exec(process.execPath, ['scripts/prepare-local.mjs'], { cwd: path.join(root, 'microservices'), windowsHide: true, timeout: 60000, signal: lifecycleSignal });
        await longCommand([...composeApps, 'build', 'api-gateway'], dockerEnvironment);
        await update('Khởi động backend với MySQL');
        await launchNode('backend', path.join(root, 'scripts/run-backend.cjs'), [], path.join(root, 'backend'), {
            ...process.env, ...backend, PORT: String(backendPort), URL_REACT: `${state.webUrl},http://127.0.0.1:${webPort}`,
            SCHEDULED_JOBS_ENABLED: 'false', EMAIL_APP: '', EMAIL_APP_PASSWORD: '',
        });
        await waitFor(() => httpOk(`http://localhost:${backendPort}/health`), 'Backend MySQL', 60000);
        await update('Khởi động API, đồng bộ hồ sơ và tìm kiếm');
        appsStarted = true;
        await longCommand([...composeApps, 'up', '-d', '--no-deps', ...applications], dockerEnvironment);
        await waitFor(async () => {
            const id = await containerId('api-gateway');
            const result = await command(['exec', id, 'node', '-e', `Promise.all(${JSON.stringify(applications.map(name => `http://${name}:${applicationPorts[name]}/readyz`))}.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(4000)});await r.body?.cancel();if(!r.ok)throw Error(url)})).then(()=>console.log('ready')).catch(()=>process.exit(1))`]);
            return result === 'ready';
        }, 'Các dịch vụ API', 180000);
        await update('Hoàn tất biên dịch giao diện');
        await waitFor(() => httpOk(state.webUrl), 'Giao diện', 180000);
        state.status = 'running'; await update(`Ứng dụng sẵn sàng: ${state.webUrl}`);
    } catch (error) {
        if (!stopping) await shutdown(error);
    }
}

const clock = (from, to) => {
    const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000)) || 0;
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};
// npm start stays until the app answers (or says why it cannot), instead of
// returning while the web port is still closed.
async function follow(pid) {
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    let hinted = false;
    const final = await followLaunch({ pid, readState, signal: controller.signal,
        onPhase: ({ phase, at }, state) => console.log(`[${clock(state.startedAt, at || new Date().toISOString())}] ${phase}`),
        onState: state => {
            if (hinted || !state.webListening || state.status !== 'starting') return;
            hinted = true;
            console.log(`       Có thể mở ${state.webUrl} ngay: trang hiển thị tiến độ và tự vào ứng dụng khi sẵn sàng.`);
        } });
    process.off('SIGINT', interrupt);
    if (!final) { console.log('Đã thôi theo dõi; JobFind vẫn khởi chạy nền. Xem tiến độ bằng npm run dev:status.'); return 0; }
    if (final.status === 'running') { console.log('Dừng ứng dụng bằng npm run dev:stop; cơ sở dữ liệu được giữ nguyên.'); return 0; }
    if (final.status === 'stopped') { console.log('JobFind đã dừng.'); return 0; }
    console.error(`Khởi chạy chưa hoàn tất: ${final.error || final.phase}\nNhật ký: .local/runtime.log, .local/backend.log, .local/frontend.log, .local/docker.log`);
    return 1;
}

await fs.mkdir(local, { recursive: true });
if (action === 'serve') await serve();
else if (action === 'start') {
    const pid = await withStartLock(root, async () => {
        const existing = await readState();
        if (existing?.workspace === root && await ownedSupervisor(existing.pid, script)) {
            // The launcher polls stop requests, so right after dev:stop it may still report running.
            const stopRequested = await fs.readFile(stopFile, 'utf8').then(text => JSON.parse(text).instance === existing.instance, () => false);
            if (existing.status === 'running' && !stopRequested) {
                console.log(`JobFind đang chạy: ${existing.webUrl}`);
                try {
                    if (!(await currentClaudeConfiguration())) {
                        console.log('Cấu hình Claude trong container đã khác microservices/.env; dùng npm run dev:stop rồi npm start để áp dụng.');
                    }
                } catch { console.log('Chưa đối chiếu được cấu hình Claude trong container; xem npm run dev:status.'); }
                return null;
            }
            if (existing.status === 'starting' && !stopRequested) return existing.pid;
            // A stopping or failed launcher is still exiting; start again once it has.
            console.log('Đang chờ phiên trước dừng hẳn...');
            await waitUntil(async () => !alive(existing.pid), 'phiên trước dừng hẳn', { timeout: 120000, interval: 500 });
        }
        try { const pid = Number(await fs.readFile(lockFile, 'utf8')); if (pid && await ownedSupervisor(pid, script)) throw new Error('Đang có tiến trình khởi chạy.'); await fs.rm(lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // Detect missing local setup in the foreground rather than reporting a detached success.
        for (const relative of ['backend/.env', 'microservices/.env', 'frontend/node_modules/react-scripts/scripts/start.js', 'frontend/scripts/start.cjs']) {
            try { await fs.access(path.join(root, relative)); } catch { throw new Error(`Thiếu ${relative}; cài các gói phụ thuộc và cấu hình trước khi chạy.`); }
        }
        for (const dependency of ['mysql2/promise', '@babel/register', '@babel/preset-env']) require.resolve(dependency);
        const backendConfig = dotenv.parse(await fs.readFile(path.join(root, 'backend/.env')));
        const microConfig = dotenv.parse(await fs.readFile(path.join(root, 'microservices/.env')));
        if (!backendConfig.JWT_SECRET || backendConfig.JWT_SECRET.length < 32 || backendConfig.JWT_SECRET !== microConfig.JWT_SECRET) {
            throw new Error('JWT_SECRET cần ít nhất 32 ký tự và phải khớp ở hai file .env.');
        }
        if (!backendConfig.INTERNAL_SECRET || backendConfig.INTERNAL_SECRET !== microConfig.INTERNAL_SECRET) {
            throw new Error('INTERNAL_SECRET chưa khớp ở hai file .env.');
        }
        const output = openSync(path.join(local, 'runtime.log'), 'a');
        const instance = randomUUID();
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve', instance], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output] });
        child.once('error', () => {});
        child.unref(); closeSync(output);
        if (!child.pid) throw new Error('Không thể tạo tiến trình JobFind.');
        console.log('Đang khởi chạy JobFind (Ctrl+C chỉ thôi theo dõi, ứng dụng vẫn chạy nền).');
        await awaitSupervisorPublication({ pid: child.pid, instance, readState });
        return child.pid;
    });
    if (pid) process.exitCode = await follow(pid);
} else if (action === 'status') {
    const state = await readState();
    if (!state) console.log('Chưa khởi chạy. Dùng npm start.');
    else {
        const result = effectiveState(state, await ownedSupervisor(state.pid, script));
        if (result.status === 'running') {
            try { result.claudeConfigurationCurrent = await currentClaudeConfiguration(); }
            catch { result.claudeConfigurationCurrent = null; }
            if (result.claudeConfigurationCurrent === false) result.claudeConfigurationNotice = 'Cấu hình Claude đã khác microservices/.env; dùng npm run dev:stop rồi npm start để áp dụng.';
        }
        console.log(JSON.stringify(result, null, 2)); if (result.status === 'failed') process.exitCode = 1;
    }
} else if (action === 'stop') {
    const state = await readState();
    if (state?.workspace === root && await ownedSupervisor(state.pid, script)) {
        await fs.writeFile(stopFile, JSON.stringify({ instance: state.instance }));
        console.log('Đang dừng JobFind...');
        // Return only once it has exited, so "dev:stop, then npm start" starts a fresh launch.
        try {
            await waitUntil(async () => !alive(state.pid), 'JobFind dừng hẳn', { timeout: 120000, interval: 500 });
            console.log('Đã dừng JobFind. Cơ sở dữ liệu và volume được giữ.');
        } catch { console.log('JobFind vẫn đang dừng; xem npm run dev:status.'); }
    } else console.log('Không có phiên JobFind do trình khởi chạy quản lý.');
} else { console.error('Dùng start, status hoặc stop.'); process.exitCode = 1; }
