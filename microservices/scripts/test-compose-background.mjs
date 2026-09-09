import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone Compose project: no project .env, host services, external volumes,
// production ports or Docker socket in containers. Browser mode adds a test-only
// loopback ingress; application/provider containers stay internal.
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--browser'), 'Only --browser is supported');
const browserMode = process.argv[2] === '--browser';
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = fileURLToPath(new URL('./compose-acceptance/', import.meta.url));
const project = `jobfind-accept-${randomUUID().slice(0, 8)}`;
const secret = randomUUID() + randomUUID();
const image = `${project}:test`;
const legacyImage = `${project}:legacy-test`;
const execute = promisify(execFile);
const docker = async (...args) => {
    try { return (await execute('docker', args, { timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout.trim(); }
    catch (error) { throw new Error([error.message, error.stdout, error.stderr].filter(Boolean).join('\n')); }
};
const directory = await mkdtemp(path.join(tmpdir(), 'jobfind-compose-'));
const file = path.join(directory, 'compose.json');
const emptyEnv = path.join(directory, 'empty.env');
await writeFile(emptyEnv, '');
const compose = (...args) => docker('compose', '--env-file', emptyEnv, '-p', project, '-f', file, ...args);
const common = {
    NODE_ENV: 'production', MYSQL_HOST: 'mysql', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: secret,
    MYSQL_DATABASE: 'acceptance', INTERNAL_SECRET: secret, JWT_SECRET: secret + secret,
    JWT_ISSUER: 'jobfind-auth', JWT_AUDIENCE: 'jobfind-api', JWT_ACCESS_TTL_SECONDS: '900',
    RABBITMQ_URL: `amqp://acceptance:${secret}@rabbitmq:5672`, REDIS_URL: 'redis://redis:6379',
    JOB_CORE_URL: 'http://job-core-service:4002', SEARCH_URL: 'http://search-service:4003',
    ADMIN_URL: 'http://admin-service:4006', LEGACY_URL: 'http://legacy:4011',
    IDENTITY_URL: 'http://identity-service:4001', APPLICATION_URL: 'http://application-service:4004',
    POSTGRES_URL: `postgres://acceptance:${secret}@postgres:5432/application_db`,
    ELASTICSEARCH_URL: 'http://elasticsearch:9200', RECONCILE_MINUTES: '60', LOG_LEVEL: 'warn',
    EMAIL_APP: '', EMAIL_APP_PASSWORD: '', FRONTEND_URL: 'http://fixture.invalid', FIXTURE_PASSWORD: secret
};
const app = (name, port, extra = {}) => ({ image, pull_policy: 'never', working_dir: `/app/${name}`,
    command: ['node', 'src/app.js'], environment: { ...common, PORT: String(port), ...extra },
    read_only: true, tmpfs: ['/tmp'], cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
    stop_grace_period: '70s', healthcheck: { test: ['CMD', 'node', '/app/scripts/healthcheck.mjs'], interval: '2s', timeout: '5s', retries: 60 },
    mem_limit: '384m' });
const config = { services: {
    mysql: { image: 'mysql:8.0', environment: { MYSQL_ROOT_PASSWORD: secret, MYSQL_ROOT_HOST: '%', MYSQL_DATABASE: 'acceptance' },
        command: ['--lower-case-table-names=1'], volumes: ['mysql-data:/var/lib/mysql'], mem_limit: '768m' },
    mongo: { image: 'mongo:7', volumes: ['mongo-data:/data/db'], mem_limit: '384m' },
    postgres: { image: 'postgres:16-alpine', environment: { POSTGRES_USER: 'acceptance', POSTGRES_PASSWORD: secret, POSTGRES_DB: 'application_db' }, volumes: ['pg-data:/var/lib/postgresql/data'], mem_limit: '256m' },
    redis: { image: 'redis:7-alpine', mem_limit: '128m' },
    rabbitmq: { image: 'rabbitmq:4-management-alpine', environment: { RABBITMQ_DEFAULT_USER: 'acceptance', RABBITMQ_DEFAULT_PASS: secret }, volumes: ['rabbit-data:/var/lib/rabbitmq'], mem_limit: '512m' },
    elasticsearch: { image: 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0', environment: { 'discovery.type': 'single-node', 'xpack.security.enabled': 'false', ES_JAVA_OPTS: '-Xms256m -Xmx256m' }, volumes: ['es-data:/usr/share/elasticsearch/data'], mem_limit: '768m' },
    mock: { image, pull_policy: 'never', command: ['node', '/app/acceptance/mock.mjs'], working_dir: '/app',
        volumes: [`${fixture}:/app/acceptance:ro`], environment: { INTERNAL_SECRET: secret }, init: true, healthcheck: { disable: true } },
    legacy: { image: legacyImage, pull_policy: 'never', init: true, read_only: true, tmpfs: ['/tmp'],
        cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], stop_grace_period: '70s', mem_limit: '384m',
        volumes: [`${fixture}:/acceptance:ro`], environment: { ...common, NODE_ENV: 'development',
            DB_HOST: 'mysql', DB_PORT: '3306', DB_USER: 'root', DB_PASSWORD: secret, DB_NAME: 'acceptance' } },
    'job-core-service': app('job-core-service', 4002),
    'search-service': app('search-service', 4003),
    'notification-service': app('notification-service', 4005),
    'admin-service': app('admin-service', 4006, { MONGO_URL: 'mongodb://mongo:27017/admin_db' }),
    'identity-service': app('identity-service', 4001, { MONGO_URL: 'mongodb://mongo:27017/identity_db' }),
    'application-service': app('application-service', 4004),
    'api-gateway': app('api-gateway', 4000),
    'ai-worker': app('ai-worker', 4007, { AI_MONGO_URL: 'mongodb://mongo:27017/ai_worker_db',
        ANTHROPIC_API_KEY: 'synthetic-not-a-provider-key', ANTHROPIC_BASE_URL: 'http://mock:4010', CLAUDE_MODEL: 'fixture', AI_CONCURRENCY: '2' }),
    runner: { image, pull_policy: 'never', working_dir: '/app', command: ['node', '/app/acceptance/checks.mjs'],
        environment: common, volumes: [`${fixture}:/app/acceptance:ro`], healthcheck: { disable: true }, profiles: ['test'] }
}, networks: { default: { internal: true } }, volumes: Object.fromEntries(['mysql-data','mongo-data','pg-data','rabbit-data','es-data'].map(key => [key, {}])) };
if (browserMode) {
    config.networks.browser = {};
    config.services['browser-edge'] = { image, pull_policy: 'never', working_dir: '/app',
        command: ['node', '/app/acceptance/browser-edge.mjs'], volumes: [`${fixture}:/app/acceptance:ro`],
        networks: ['default', 'browser'], ports: ['127.0.0.1::4012'], read_only: true,
        cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], healthcheck: { disable: true } };
}
await writeFile(file, JSON.stringify(config, null, 2));
let started = false;
try {
    console.log(`Isolated project: ${project}; building current production source`);
    if (browserMode) {
        assert.ok(process.env.npm_execpath, 'Run browser acceptance with npm run test:compose-browser:integration');
        console.log('Building candidate-enabled frontend into the owned temporary directory');
        await execute(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
            cwd: path.resolve(root, '../frontend'), windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, BUILD_PATH: path.join(directory, 'frontend'), REACT_APP_BACKEND_URL: '/',
                REACT_APP_CANDIDATE_AI_ENABLED: 'true', REACT_APP_APPLICATION_PROGRESS_ENABLED: 'true',
                REACT_APP_PREPARED_CV_APPLICATION_ENABLED: 'true', REACT_APP_JOB_SEARCH_MODE: 'core' }
        });
    }
    await docker('build', '-t', image, root);
    await docker('build', '-t', legacyImage, '-f', path.join(fixture, 'legacy.Dockerfile'), path.resolve(root, '../backend'));
    await compose('config', '--quiet');
    started = true;
    await compose('up', '-d', '--pull', 'never', 'mysql', 'mongo', 'postgres', 'redis', 'rabbitmq', 'elasticsearch', 'mock');
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'seed'));
    const services = ['job-core-service','search-service','notification-service','admin-service','identity-service','application-service','api-gateway','ai-worker'];
    await compose('up', '-d', '--pull', 'never', 'legacy', ...services);
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'main'));
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'candidate'));
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/applications.mjs', 'main'));
    await compose('restart', 'application-service', 'identity-service', 'legacy');
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/applications.mjs', 'restart'));
    if (browserMode) {
        console.log(await compose('run', '--rm', '--no-deps', 'legacy', 'node', '/acceptance/browser-seed.cjs'));
        await compose('up', '-d', '--pull', 'never', 'browser-edge');
        const gateway = JSON.parse(await docker('inspect', await compose('ps', '-q', 'browser-edge')))[0];
        const binding = gateway.NetworkSettings.Ports['4012/tcp'][0];
        assert.equal(binding.HostIp, '127.0.0.1');
        const { runComposeBrowser } = await import('./test-compose-browser.mjs');
        await runComposeBrowser({ gateway: `http://127.0.0.1:${binding.HostPort}`, password: secret,
            build: path.join(directory, 'frontend'), directory, compose });
    }
    // Stop consumers, commit through HTTP and prove durable backlog before restart.
    await compose('stop', 'ai-worker', 'search-service', 'notification-service');
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'offline'));
    await compose('start', 'ai-worker', 'search-service', 'notification-service');
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'recovery'));
    await compose('stop', 'rabbitmq');
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'broker-offline'));
    await compose('start', 'rabbitmq');
    console.log(await compose('run', '--rm', '--no-deps', 'runner', 'node', '/app/acceptance/checks.mjs', 'broker-recovery'));
    const net = JSON.parse(await docker('network', 'inspect', `${project}_default`))[0];
    assert.equal(net.Internal, true);
    const ids = (await compose('ps', '-aq')).split(/\s+/).filter(Boolean);
    for (const id of ids) {
        const container = JSON.parse(await docker('inspect', id))[0];
        assert.equal(container.Config.Labels['com.docker.compose.project'], project);
        if (browserMode && container.Config.Labels['com.docker.compose.service'] === 'browser-edge') {
            assert.deepEqual(Object.keys(container.HostConfig.PortBindings), ['4012/tcp']);
            assert.equal(container.HostConfig.PortBindings['4012/tcp'][0].HostIp, '127.0.0.1');
            assert.deepEqual(Object.keys(container.NetworkSettings.Networks).sort(), [`${project}_browser`, `${project}_default`]);
        } else {
            assert.deepEqual(Object.keys(container.HostConfig.PortBindings || {}), []);
            assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [`${project}_default`]);
        }
    }
    console.log(`PASS: network isolation, ${browserMode ? 'only fixed Gateway ingress published to loopback' : 'no published ports'}, project ownership`);
    const stopping = ['legacy', ...services, ...(browserMode ? ['browser-edge'] : [])];
    await compose('stop', ...stopping);
    for (const service of stopping) {
        const id = await compose('ps', '-aq', service);
        const state = JSON.parse(await docker('inspect', id))[0].State;
        assert.equal(state.ExitCode, 0, `${service} graceful shutdown`);
        assert.equal(state.OOMKilled, false, `${service} OOM`);
    }
    console.log('PASS: eight services and legacy HTTP fixture shut down cleanly');
    console.log('Compose background acceptance PASSED');
} catch (error) {
    console.error(error.message.replaceAll(secret, '[test-secret]'));
    if (started) console.error((await compose('logs', '--no-color', '--tail', '35').catch(() => '')).replaceAll(secret, '[test-secret]'));
    throw error;
} finally {
    // Only this generated project can be removed; never use the repository Compose.
    if (started) await compose('down', '--volumes', '--remove-orphans', '--timeout', '75');
    await docker('image', 'rm', image).catch(() => {});
    await docker('image', 'rm', legacyImage).catch(() => {});
    assert.ok(path.basename(directory).startsWith('jobfind-compose-'));
    await rm(directory, { recursive: true, force: true });
    console.log(`Cleaned owned fixture: ${project}`);
}
