import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// An offline physical copy only. Never starts/stops the source, mounts it writable,
// connects to its broker, or reads its environment/credentials into the rehearsal.
assert.equal(process.argv.length, 4, 'Usage: node scripts/rehearse-worker-admin.mjs --source-project NAME');
assert.equal(process.argv[2], '--source-project');
const sourceProject = process.argv[3];
assert.match(sourceProject, /^[a-z0-9][a-z0-9_-]+$/);
const token = randomUUID();
const project = `jobfind-rehearse-${token.slice(0, 8)}`;
const image = `${project}:test`;
const volume = `${project}-mongo-copy`;
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'scripts');
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, {
    timeout: 240000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
})).stdout.trim();
const inspect = async id => JSON.parse(await docker('inspect', id))[0];
const sourceIds = (await docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${sourceProject}`)).split(/\s+/).filter(Boolean);
assert.ok(sourceIds.length, 'Source project not found');
const sources = await Promise.all(sourceIds.map(inspect));
const mongoSources = sources.filter(c => c.Config.Labels['com.docker.compose.service'] === 'mongo');
assert.equal(mongoSources.length, 1, 'Source MongoDB must be unambiguous');
const source = mongoSources[0];
assert.equal(source.State.Running, false, 'Offline copy requires an already stopped source MongoDB');
assert.equal(source.State.ExitCode, 0, 'Source MongoDB must have stopped cleanly');
const mount = source.Mounts.find(m => m.Destination === '/data/db');
assert.equal(mount?.Type, 'volume', 'Only a named Docker data volume is supported');
const assertOffline = async () => {
    const ids = (await docker('ps', '-q', '--filter', `volume=${mount.Name}`)).split(/\s+/).filter(Boolean);
    for (const id of ids) {
        const c = await inspect(id);
        assert.ok(!c.Mounts.some(m => m.Name === mount.Name && m.RW), 'A running container can write source data');
    }
    assert.equal((await inspect(source.Id)).State.Running, false);
};
await assertOffline();
const hashCommand = 'find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum';
const hashVolume = name => docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'sh',
    '--mount', `type=volume,src=${name},dst=/snapshot,readonly`, '-w', '/snapshot', source.Image, '-ec', hashCommand);
const directory = await mkdtemp(path.join(tmpdir(), 'jobfind-rehearse-'));
const file = path.join(directory, 'compose.json');
const envFile = path.join(directory, 'empty.env');
await writeFile(envFile, '');
const compose = (...args) => docker('compose', '--env-file', envFile, '-p', project, '-f', file, ...args);
const secret = randomUUID() + randomUUID();
const common = { NODE_ENV: 'production', LOG_LEVEL: 'warn', INTERNAL_SECRET: secret,
    MYSQL_HOST: 'mysql', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: secret, MYSQL_DATABASE: 'rehearsal',
    POSTGRES_URL: `postgres://rehearsal:${secret}@postgres:5432/rehearsal`,
    RABBITMQ_URL: `amqp://rehearsal:${secret}@rabbitmq:5672`, REHEARSAL_ID: token };
const workerEnv = { ...common, PORT: '4007', AI_MONGO_URL: 'mongodb://mongo:27017/ai_worker_db',
    ANTHROPIC_API_KEY: 'synthetic-not-a-provider-key', ANTHROPIC_BASE_URL: 'http://mock:4010', CLAUDE_MODEL: 'fixture' };
const app = (name, environment) => ({ image, pull_policy: 'never', working_dir: `/app/${name}`,
    command: ['node', 'src/app.js'], environment, read_only: true, tmpfs: ['/tmp'],
    cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], mem_limit: '384m', stop_grace_period: '70s',
    healthcheck: { disable: true } });
const config = { services: {
    mongo: { image: source.Image, pull_policy: 'never', volumes: [`${volume}:/data/db`], mem_limit: '512m',
        command: ['mongod', '--bind_ip_all', '--setParameter', 'ttlMonitorEnabled=false'] },
    mysql: { image: 'mysql:8.0', environment: { MYSQL_ROOT_PASSWORD: secret, MYSQL_ROOT_HOST: '%', MYSQL_DATABASE: 'rehearsal' }, mem_limit: '512m' },
    postgres: { image: 'postgres:16-alpine', environment: { POSTGRES_USER: 'rehearsal', POSTGRES_PASSWORD: secret, POSTGRES_DB: 'rehearsal' }, mem_limit: '256m' },
    rabbitmq: { image: 'rabbitmq:4-management-alpine', environment: { RABBITMQ_DEFAULT_USER: 'rehearsal', RABBITMQ_DEFAULT_PASS: secret }, mem_limit: '512m' },
    mock: { image, init: true, command: ['node', '/rehearsal/compose-acceptance/mock.mjs'], environment: common,
        volumes: [`${fixture}:/rehearsal:ro`], healthcheck: { disable: true } },
    'admin-service': app('admin-service', { ...common, PORT: '4006', MONGO_URL: 'mongodb://mongo:27017/admin_db' }),
    'ai-worker': app('ai-worker', workerEnv),
    runner: { image, working_dir: '/app', command: ['node', '/rehearsal/worker-admin-checks.mjs'],
        environment: common, volumes: [`${fixture}:/rehearsal:ro`], profiles: ['test'], healthcheck: { disable: true } }
}, networks: { default: { internal: true } }, volumes: { [volume]: { external: true, name: volume } } };
await writeFile(file, JSON.stringify(config));
let copied = false, started = false, sourceHash;
const report = { observedAt: new Date().toISOString(), sourceProject, project, sourceMongoImage: source.Image,
    sourceMongoContainer: source.Id, sourceVolume: mount.Name, provider: 'isolated-http-fixture', checks: [] };
const sourceWorker = sources.find(c => c.Config.Labels['com.docker.compose.service'] === 'ai-worker');
const sourceWorkerEnv = Object.fromEntries((sourceWorker?.Config.Env || []).map(entry => {
    const split = entry.indexOf('='); return [entry.slice(0, split), entry.slice(split + 1)];
}));
report.sourceWorkerConfiguration = { taskStoreUrlPresent: Boolean(sourceWorkerEnv.AI_MONGO_URL?.trim()),
    providerKeyPresent: Boolean(sourceWorkerEnv.ANTHROPIC_API_KEY?.trim()), realProviderVerified: false };
const check = async phase => {
    const output = await compose('run', '--rm', '--no-deps', 'runner', 'node', '/rehearsal/worker-admin-checks.mjs', phase);
    for (const line of output.split('\n')) {
        if (line.startsWith('EVIDENCE: ')) report[phase] = JSON.parse(line.slice(10));
        else if (line.startsWith('PASS: ')) { report.checks.push(line.slice(6)); console.log(line); }
    }
};
try {
    console.log(`Rehearsal project: ${project}; source remains stopped`);
    sourceHash = await hashVolume(mount.Name);
    await docker('volume', 'create', '--label', `jobfind.rehearsal=${token}`, volume);
    copied = true;
    await assertOffline();
    await docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'sh',
        '--mount', `type=volume,src=${mount.Name},dst=/source,readonly`,
        '--mount', `type=volume,src=${volume},dst=/copy`, source.Image, '-ec', 'cp -a /source/. /copy/');
    assert.equal(await hashVolume(volume), sourceHash, 'Physical copy checksum differs');
    assert.equal(await hashVolume(mount.Name), sourceHash, 'Source changed during copy');
    console.log('PASS: read-only offline copy matches source file checksum');
    report.checks.push('read-only offline copy matches source file checksum');
    report.sourceChecksum = sourceHash.split(/\s/)[0];
    await docker('build', '-t', image, root);
    report.applicationImage = (await inspect(image)).Id;
    started = true;
    await compose('up', '-d', '--pull', 'never', 'mongo', 'mysql', 'postgres', 'rabbitmq', 'mock');
    await check('baseline');
    // The probe queue contains synthetic work before either incomplete worker starts.
    for (const missing of ['ANTHROPIC_API_KEY', 'AI_MONGO_URL']) {
        const name = `${project}-missing-${missing.toLowerCase().replaceAll('_', '-')}`;
        await compose('run', '-d', '--no-deps', '--name', name, '-e', `${missing}=`, 'ai-worker');
        assert.equal(await docker('wait', name), '1', `${missing}: worker must refuse startup`);
        const logOutput = await execute('docker', ['logs', name], { timeout: 10000, maxBuffer: 128 * 1024, windowsHide: true });
        const logs = logOutput.stdout + logOutput.stderr;
        assert.ok(logs.includes(`${missing} is required`), 'Missing configuration diagnostic');
        await check('blocked');
        await docker('rm', name);
    }
    await compose('up', '-d', '--pull', 'never', 'admin-service');
    await check('admin-ready');
    await compose('up', '-d', '--pull', 'never', 'ai-worker');
    await check('running');
    await compose('restart', 'admin-service', 'ai-worker');
    await check('restart');
    const network = JSON.parse(await docker('network', 'inspect', `${project}_default`))[0];
    assert.equal(network.Internal, true);
    for (const id of (await compose('ps', '-aq')).split(/\s+/).filter(Boolean)) {
        const c = await inspect(id);
        assert.equal(c.Config.Labels['com.docker.compose.project'], project);
        assert.deepEqual(Object.keys(c.HostConfig.PortBindings || {}), []);
        assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [`${project}_default`]);
        assert.ok(!c.Mounts.some(m => m.Name === mount.Name));
    }
    await compose('stop', 'admin-service', 'ai-worker');
    for (const name of ['admin-service', 'ai-worker']) {
        const c = await inspect(await compose('ps', '-aq', name));
        assert.equal(c.State.ExitCode, 0); assert.equal(c.State.OOMKilled, false);
    }
    report.checks.push('internal network, no published ports or source mounts; clean shutdown');
    report.status = 'passed';
} catch (error) {
    report.status = 'failed';
    // Never dump copied documents, environment values or complete container logs.
    console.error('Rehearsal failed:', String(error.message).replaceAll(secret, '[rehearsal-secret]'));
    throw error;
} finally {
    if (started) await compose('down', '--volumes', '--remove-orphans', '--timeout', '75');
    if (copied) {
        const owned = JSON.parse(await docker('volume', 'inspect', volume))[0];
        assert.equal(owned.Labels['jobfind.rehearsal'], token);
        await docker('volume', 'rm', volume);
    }
    await docker('image', 'rm', image).catch(() => {});
    await assertOffline();
    if (sourceHash) assert.equal(await hashVolume(mount.Name), sourceHash, 'Source files changed');
    for (const before of sources) {
        const after = await inspect(before.Id);
        assert.deepEqual(after.State, before.State, 'Source container state changed');
    }
    report.sourceUnchanged = true;
    report.cleaned = true;
    await writeFile(path.join(root, 'docs', 'worker-admin-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('jobfind-rehearse-'));
    await rm(directory, { recursive: true, force: true });
    console.log('PASS: source files/container states unchanged; owned rehearsal resources removed');
}
