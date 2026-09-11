import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { backupMysql, backupContainer, writeBackupManifest } from './backup-local.mjs';
import { alive, stopChild, ownedSupervisor, effectiveState, waitFor as waitUntil, runLoggedCommand, withStartLock, releaseOwnedLock } from './dev-runtime.mjs';

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
const applications = ['identity-service', 'application-service', 'notification-service', 'admin-service', 'job-core-service', 'search-service', 'api-gateway'];
const composeBase = ['compose', '-p', project, '-f', 'docker-compose.yml'];
const composeApps = [...composeBase, '-f', 'compose.local.yml', '-f', 'compose.runtime.yml'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    try { return (await exec('docker', args, { cwd: path.join(root, 'microservices'), windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, signal: lifecycleSignal, ...options })).stdout.trim(); }
    catch { throw new Error(`Docker không hoàn thành thao tác ${args.slice(0, 2).join(' ')}. Xem .local/docker.log.`); }
};
const longCommand = (args, env) => runLoggedCommand('docker', args, { cwd: path.join(root, 'microservices'), env,
    file: path.join(local, 'docker.log'), signal: lifecycleSignal });
const containerId = async service => {
    const rows = (await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`, '--filter', `label=com.docker.compose.service=${service}`])).split(/\s+/).filter(Boolean);
    if (rows.length > 1) throw new Error(`Có nhiều container ${service}; cần kiểm tra trước khi chạy.`);
    return rows[0];
};
const waitFor = (check, label, timeout = 180000) => waitUntil(check, label, { timeout, signal: lifecycleSignal });
const httpOk = async url => { const res = await fetch(url, { signal: AbortSignal.timeout(5000) }); await res.body?.cancel(); return res.ok; };
const freePort = port => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Cổng ${port} đang được sử dụng. Chọn JOBFIND_WEB_PORT hoặc JOBFIND_BACKEND_PORT khác.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
});

async function serve() {
    let lock;
    try { lock = await fs.open(lockFile, 'wx'); await lock.writeFile(String(process.pid)); }
    catch { throw new Error('Một phiên khởi chạy khác đang tồn tại. Dùng npm run dev:status.'); }
    const instance = randomUUID();
    const state = { instance, pid: process.pid, workspace: root, startedAt: new Date().toISOString(), status: 'starting', phase: 'Kiểm tra cấu hình', children: [] };
    const children = [];
    let stopping = false;
    let failure;
    let appsStarted = false;
    const controller = new AbortController();
    lifecycleSignal = controller.signal;
    let monitor;
    const update = async phase => { state.phase = phase; await writeState(state); console.log(phase); };
    const shutdown = async (error) => {
        if (stopping) return;
        stopping = true;
        failure ||= error instanceof Error ? error : undefined;
        controller.abort(failure || new Error('Đã yêu cầu dừng ứng dụng.'));
        clearInterval(monitor);
        state.status = 'stopping'; await update('Đang dừng ứng dụng').catch(() => {});
        for (const child of children.reverse()) {
            stopChild(child);
        }
        if (appsStarted) await command([...composeApps, 'stop', ...applications], { signal: undefined, timeout: 60000 }).catch(() => {});
        state.status = failure ? 'failed' : 'stopped'; state.children = [];
        if (failure) state.error = failure.message;
        await update(failure ? 'Khởi chạy chưa hoàn tất: ' + failure.message : 'Đã dừng; cơ sở dữ liệu vẫn được giữ').catch(() => {});
        await lock.close(); await releaseOwnedLock(lockFile, process.pid);
        process.exit(failure ? 1 : 0);
    };
    const launchNode = async (name, entry, args, cwd, env) => {
        lifecycleSignal.throwIfAborted();
        const output = openSync(path.join(local, name + '.log'), 'a');
        const child = spawn(process.execPath, [entry, ...args], { cwd, env, windowsHide: true, stdio: ['ignore', output, output] });
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
        const env = { ...process.env, JOBFIND_WEB_PORT: String(webPort), JOBFIND_BACKEND_PORT: String(backendPort) };
        await command(['info', '--format', '{{.ServerVersion}}']);
        const directory = path.join(local, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
        await fs.mkdir(directory, { recursive: true });
        await update('Sao lưu MySQL đang có trước khi khởi chạy');
        const mysqlBackup = await backupMysql(root, backend, directory, { signal: lifecycleSignal });
        state.backup = directory;
        await update('Khởi động các kho dữ liệu và hàng đợi hiện có');
        for (const service of infrastructure) {
            const id = await containerId(service);
            if (id) await command(['start', id]);
            else await longCommand([...composeBase, 'up', '-d', '--no-deps', service], env);
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
        await longCommand([...composeApps, 'build', 'api-gateway'], env);
        await update('Khởi động backend với MySQL');
        await launchNode('backend', path.join(root, 'scripts/run-backend.cjs'), [], path.join(root, 'backend'), {
            ...process.env, ...backend, PORT: String(backendPort), URL_REACT: `${state.webUrl},http://127.0.0.1:${webPort}`,
            SCHEDULED_JOBS_ENABLED: 'false', EMAIL_APP: '', EMAIL_APP_PASSWORD: '',
        });
        await waitFor(() => httpOk(`http://localhost:${backendPort}/health`), 'Backend MySQL', 60000);
        await update('Khởi động API, đồng bộ hồ sơ và tìm kiếm');
        appsStarted = true;
        await longCommand([...composeApps, 'up', '-d', '--no-deps', ...applications], env);
        await waitFor(async () => {
            const id = await containerId('api-gateway');
            const result = await command(['exec', id, 'node', '-e', `Promise.all(${JSON.stringify(applications.map((name, index) => `http://${name}:${({ 'identity-service':4001,'application-service':4004,'notification-service':4005,'admin-service':4006,'job-core-service':4002,'search-service':4003,'api-gateway':4000 })[name]}/readyz`))}.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(4000)});await r.body?.cancel();if(!r.ok)throw Error(url)})).then(()=>console.log('ready')).catch(()=>process.exit(1))`]);
            return result === 'ready';
        }, 'Các dịch vụ API', 180000);
        await update('Khởi động giao diện tuyển dụng');
        await launchNode('frontend', path.join(root, 'frontend/node_modules/react-scripts/scripts/start.js'), [], path.join(root, 'frontend'), {
            ...process.env, NODE_ENV: 'development', BROWSER: 'none', HOST: '127.0.0.1', PORT: String(webPort),
            REACT_APP_BACKEND_URL: state.apiUrl,
        });
        await waitFor(() => httpOk(state.webUrl), 'Giao diện', 180000);
        state.status = 'running'; await update(`Ứng dụng sẵn sàng: ${state.webUrl}`);
    } catch (error) {
        if (!stopping) await shutdown(error);
    }
}

await fs.mkdir(local, { recursive: true });
if (action === 'serve') await serve();
else if (action === 'start') {
    await withStartLock(root, async () => {
    const existing = await readState();
    if (existing?.workspace === root && await ownedSupervisor(existing.pid, script)) {
        console.log(`${existing.phase}\n${existing.webUrl || ''}`);
    } else {
        try { const pid = Number(await fs.readFile(lockFile, 'utf8')); if (pid && await ownedSupervisor(pid, script)) throw new Error('Đang có tiến trình khởi chạy.'); await fs.rm(lockFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // Detect missing local setup in the foreground rather than reporting a detached success.
        for (const relative of ['backend/.env', 'microservices/.env', 'frontend/node_modules/react-scripts/scripts/start.js']) {
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
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', output, output] });
        let spawnError;
        child.once('error', error => { spawnError = error; });
        child.unref(); closeSync(output);
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            if (spawnError) throw new Error('Không thể tạo tiến trình JobFind.');
            const current = await readState();
            if (current?.pid === child.pid && current.status === 'failed') throw new Error(current.error || current.phase);
            if (current?.pid === child.pid && current.phase !== 'Kiểm tra cấu hình') break;
            if (!alive(child.pid)) throw new Error('Tiến trình JobFind đã dừng; xem .local/runtime.log.');
            await sleep(200);
        }
        console.log('Đang khởi chạy JobFind. Xem tiến độ bằng npm run dev:status; nhật ký: .local/runtime.log.');
    }
    });
} else if (action === 'status') {
    const state = await readState();
    if (!state) console.log('Chưa khởi chạy. Dùng npm start.');
    else { const result = effectiveState(state, await ownedSupervisor(state.pid, script)); console.log(JSON.stringify(result, null, 2)); if (result.status === 'failed') process.exitCode = 1; }
} else if (action === 'stop') {
    const state = await readState();
    if (state?.workspace === root && await ownedSupervisor(state.pid, script)) {
        await fs.writeFile(stopFile, JSON.stringify({ instance: state.instance }));
        console.log('Đã yêu cầu dừng JobFind. Cơ sở dữ liệu và volume được giữ.');
    } else console.log('Không có phiên JobFind do trình khởi chạy quản lý.');
} else { console.error('Dùng start, status hoặc stop.'); process.exitCode = 1; }
