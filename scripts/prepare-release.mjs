import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, copyFile, cp, stat, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, sha256 } from './release/verify.mjs';
import { scanPrivateBindings } from './release/scan-private-bindings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = (command, args, options = {}) => {
    const value = execFileSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024, ...options });
    return typeof value === 'string' ? value.trim() : value;
};
const json = (command, args) => JSON.parse(run(command, args));
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const commit = run('git', ['rev-parse', 'HEAD']);
const inputs = ['backend/src', 'backend/package.json', 'backend/package-lock.json', 'backend/.babelrc', 'frontend/src', 'frontend/public', 'frontend/package.json', 'frontend/package-lock.json', 'microservices', 'scripts/run-backend.cjs'];
if (run('git', ['status', '--porcelain', '--', ...inputs])) throw new Error('Application inputs must match the fixed commit');
const releaseId = `${commit.slice(0, 12)}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const kit = path.join(root, '.local/releases', releaseId);
const work = path.join(root, '.local/release-work', releaseId);
await mkdir(kit, { recursive: true }); await mkdir(work, { recursive: true });
await writeFile(path.join(root, '.local/releases/LATEST'), releaseId);
const snapshot = path.join(work, 'source'); await mkdir(snapshot);
run('git', ['archive', '--format=tar', '-o', path.join(kit, 'source.tar'), commit, '--', ...inputs]);
run('tar', ['-xf', path.join(kit, 'source.tar'), '-C', snapshot]);
await writeFile(path.join(snapshot, '.dockerignore'), '*\n!backend\n!backend/**\n!scripts\n!scripts/run-backend.cjs\n');
await cp(path.join(root, 'scripts/release'), path.join(kit, 'recipes'), { recursive: true });
await copyFile(fileURLToPath(import.meta.url), path.join(kit, 'recipes/prepare-release.mjs'));
await copyFile(path.join(root, 'scripts/test-release.mjs'), path.join(kit, 'recipes/test-release.mjs'));
await copyFile(path.join(root, 'scripts/release/verify.mjs'), path.join(kit, 'verify.mjs'));
await writeFile(path.join(work, 'empty.env'), '');

// Only sanitized inspect metadata is retained; never write Config.Env or raw inspect output.
function sourceState() {
    const ids = run('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal']).split(/\s+/).filter(Boolean);
    if (!ids.length) throw new Error('Expected source project is absent');
    return json('docker', ['inspect', ...ids]).map(c => ({
        id: c.Id, service: c.Config.Labels['com.docker.compose.service'], image: c.Image,
        hostname: c.Config.Hostname, status: c.State.Status, startedAt: c.State.StartedAt, finishedAt: c.State.FinishedAt,
        mounts: c.Mounts.filter(m => m.Type === 'volume').map(m => ({ name: m.Name, target: m.Destination }))
    })).sort((a, b) => a.service.localeCompare(b.service));
}
const sourceBefore = sourceState();
await writeJson(path.join(kit, 'target.json'), { project: 'ai-job-portal', network: 'ai-job-portal_default', nativeMysql: { version: 'MariaDB 10.4.32', database: 'jobfindtest', installation: 'existing Windows host; not included as an installer' }, containers: sourceBefore });
const imageRecord = (role, ref) => {
    const image = json('docker', ['image', 'inspect', ref])[0];
    return { role, id: image.Id, os: image.Os, architecture: image.Architecture, repoDigests: image.RepoDigests || [] };
};
const images = [];
const build = async (role, context, dockerfile, args = []) => {
    console.log('Building fixed image: ' + role);
    const log = await open(path.join(kit, `build-${role}.log`), 'w');
    const tag = `jobfind-release-${role}:${releaseId.toLowerCase()}`;
    try {
        run('docker', ['build', '--progress=plain', '--label', `org.opencontainers.image.revision=${commit}`, '--label', `jobfind.release=${releaseId}`, '-t', tag, '-f', dockerfile, ...args, context], { stdio: ['ignore', log.fd, log.fd], timeout: 1800000 });
    } finally { await log.close(); }
    const image = imageRecord(role, tag); images.push(image); console.log('Built ' + role + ': ' + image.id);
    return image.id;
};
const micro = await build('microservices', path.join(snapshot, 'microservices'), path.join(snapshot, 'microservices/Dockerfile'));
const backend = await build('backend', snapshot, path.join(kit, 'recipes/backend.Dockerfile'));
const flagNames = ['JOB_SEARCH_MODE', 'JOB_WORKSPACE_MODE', 'JOB_CREATE_MODE', 'JOB_EDIT_MODE', 'JOB_REPOST_MODE', 'CANDIDATE_AI_ENABLED', 'APPLICATION_PROGRESS_ENABLED', 'PREPARED_CV_APPLICATION_ENABLED'].map(n => 'REACT_APP_' + n);
const variants = {};
await mkdir(path.join(snapshot, 'frontend/.release'));
await copyFile(path.join(kit, 'recipes/nginx.conf'), path.join(snapshot, 'frontend/.release/nginx.conf'));
for (const variant of ['deployment', 'rollback']) {
    const flags = Object.fromEntries(flagNames.map(n => [n, n.endsWith('_MODE') ? (variant === 'deployment' ? 'core' : 'legacy') : String(variant === 'deployment')]));
    const info = { releaseId, applicationCommit: commit, variant, gatewayUrl: '/', flags };
    await writeJson(path.join(snapshot, 'frontend/.release/release-info.json'), info);
    const image = await build('web-' + variant, path.join(snapshot, 'frontend'), path.join(kit, 'recipes/web.Dockerfile'), Object.entries(flags).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]));
    variants[variant] = { ...info, image };
}
await writeJson(path.join(kit, 'variants.json'), variants);
for (const service of ['mongo', 'postgres', 'rabbitmq', 'redis', 'elasticsearch']) {
    const found = sourceBefore.filter(c => c.service === service);
    if (found.length !== 1) throw new Error('Ambiguous infrastructure: ' + service);
    images.push(imageRecord(service, found[0].image));
}

// Convert the committed runtime recipe, excluding infrastructure and build-time tools.
// The application-only compose cannot create/replace database or broker volumes.
const config = json('docker', ['compose', '--env-file', path.join(work, 'empty.env'), '-f', path.join(snapshot, 'microservices/docker-compose.yml'), '-f', path.join(snapshot, 'microservices/compose.local.yml'), 'config', '--no-interpolate', '--no-env-resolution', '--format', 'json']);
const services = {};
const required = name => '${' + name + ':?Provide ' + name + ' outside the release kit}';
for (const name of ['api-gateway', 'identity-service', 'job-core-service', 'search-service', 'application-service', 'notification-service', 'admin-service', 'ai-worker']) {
    const service = config.services[name];
    delete service.build; delete service.depends_on; delete service.volumes;
    service.image = micro; service.pull_policy = 'never';
    for (const [key, value] of Object.entries(service.environment || {})) {
        // Freeze non-secret defaults; credentials continue to be required bindings.
        service.environment[key] = typeof value === 'string' ? value.replace(/\$\{[A-Z_]+:-([^}]*)\}/g, '$1') : value;
        if (key.startsWith('MYSQL_')) service.environment[key] = required(key);
    }
    if (name === 'api-gateway') Object.assign(service.environment, { LEGACY_URL: 'http://backend:5000', CORS_ORIGIN: 'http://localhost:3001,http://127.0.0.1:3001', TRUST_PROXY: '' });
    if (name === 'notification-service') Object.assign(service.environment, { FRONTEND_URL: 'http://localhost:3001', LEGACY_URL: 'http://backend:5000', EMAIL_APP: '', EMAIL_APP_PASSWORD: '', EMAIL_DEMO_RECIPIENT: '' });
    if (name === 'ai-worker') Object.assign(service.environment, { ANTHROPIC_API_KEY: required('ANTHROPIC_API_KEY'), CLAUDE_MODEL: required('CLAUDE_MODEL'), AI_CONCURRENCY: '2' });
    services[name] = service;
}
const protection = { init: true, read_only: true, tmpfs: ['/tmp:size=64m,mode=1777'], cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], pids_limit: 128, mem_limit: '768m', restart: 'unless-stopped', stop_grace_period: '40s', logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } } };
services.backend = { ...protection, image: backend, pull_policy: 'never', extra_hosts: ['host.docker.internal:host-gateway'], environment: {
    NODE_ENV: 'development', PORT: '5000', SCHEDULED_JOBS_ENABLED: 'false', BABEL_DISABLE_CACHE: '1',
    DB_HOST: required('MYSQL_HOST'), DB_PORT: required('MYSQL_PORT'), DB_USER: required('MYSQL_USER'), DB_PASSWORD: required('MYSQL_PASSWORD'), DB_NAME: required('MYSQL_DATABASE'),
    JWT_SECRET: required('JWT_SECRET'), JWT_ISSUER: 'jobfind-auth', JWT_AUDIENCE: 'jobfind-api', JWT_ACCESS_TTL_SECONDS: '900',
    INTERNAL_SECRET: required('INTERNAL_SECRET'), RABBITMQ_URL: 'amqp://' + required('RABBITMQ_USER') + ':' + required('RABBITMQ_PASSWORD') + '@rabbitmq:5672',
    CLOUD_NAME: required('CLOUD_NAME'), API_KEY: required('API_KEY'), API_SECRET: required('API_SECRET'),
    PAYPAL_MODE: 'sandbox', PAYPAL_CLIENT_ID: required('PAYPAL_CLIENT_ID'), PAYPAL_CLIENT_SECRET: required('PAYPAL_CLIENT_SECRET'), PAYMENT_INTENT_TTL_MINUTES: '30',
    URL_REACT: 'http://localhost:3001,http://127.0.0.1:3001', EMAIL_APP: '', EMAIL_APP_PASSWORD: ''
} };
services.web = { ...protection, image: variants.rollback.image, pull_policy: 'never', ports: ['127.0.0.1:3001:8080'] };
const compose = { name: 'ai-job-portal', services, networks: { default: { external: true, name: 'ai-job-portal_default' } }, secrets: { metrics_token: { file: required('METRICS_TOKEN_FILE') } } };
await writeJson(path.join(kit, 'compose.json'), compose);
await writeJson(path.join(kit, 'compose.deployment.json'), { services: { web: { image: variants.deployment.image } } });
await writeJson(path.join(kit, 'compose.rollback.json'), { services: { web: { image: variants.rollback.image } } });
await writeJson(path.join(kit, 'compose.web.rollback.json'), { name: 'ai-job-portal', services: { web: services.web }, networks: compose.networks });
const env = ['MYSQL_HOST=host.docker.internal', 'MYSQL_PORT=3333', 'MYSQL_DATABASE=jobfindtest', 'MYSQL_USER=', 'MYSQL_PASSWORD=', 'POSTGRES_USER=', 'POSTGRES_PASSWORD=', 'RABBITMQ_USER=', 'RABBITMQ_PASSWORD=', 'JWT_SECRET=', 'INTERNAL_SECRET=', 'METRICS_TOKEN_FILE=', 'ANTHROPIC_API_KEY=', 'CLAUDE_MODEL=', 'CLOUD_NAME=', 'API_KEY=', 'API_SECRET=', 'PAYPAL_CLIENT_ID=', 'PAYPAL_CLIENT_SECRET='];
await writeFile(path.join(kit, 'runtime.env.example'), env.join('\n') + '\n');
await copyFile(path.join(root, 'microservices/docs/backup-restore-rehearsal.json'), path.join(kit, 'backup-reference.json'));
await copyFile(path.join(root, 'scripts/release/README.md'), path.join(kit, 'README.md'));
console.log('Saving 4 application images and 5 exact infrastructure images for offline loading');
run('docker', ['image', 'save', '-o', path.join(kit, 'images.tar'), ...new Set(images.map(i => i.id))], { timeout: 1200000 });
if (JSON.stringify(sourceState()) !== JSON.stringify(sourceBefore)) throw new Error('Source container state changed during packaging');
const privateBindingsScan = await scanPrivateBindings(root, kit);
const files = [];
for (const name of await inventory(kit)) files.push({ path: name, bytes: (await stat(path.join(kit, name))).size, sha256: await sha256(path.join(kit, name)) });
const manifest = { schemaVersion: 1, releaseId, createdAt: new Date().toISOString(), applicationCommit: commit, applicationInputsClean: true, recipeProvenance: 'Recipes are separately checksummed inputs; applicationCommit identifies source.tar only.', defaultVariant: 'rollback', activationStatus: 'HOLD', gatewayUrl: '/', target: 'existing local Windows/Docker Desktop stack only', toolchain: { hostNode: process.version, buildNode: run('docker', ['run', '--rm', '--network', 'none', 'node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32', 'node', '-p', 'process.version']), docker: run('docker', ['version', '--format', '{{.Client.Version}}']), compose: run('docker', ['compose', 'version', '--short']), nodeBase: 'node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32', nginxBase: 'nginx@sha256:5a88c9c45479443d7be2eadc894b4ed0a9801bae03d97a5760ae13b5c2005942' }, variants, images, sourceUnchanged: true, privateBindingsScan, files };
await writeJson(path.join(kit, 'manifest.json'), manifest);
await writeFile(path.join(kit, 'manifest.sha256'), await sha256(path.join(kit, 'manifest.json')) + '\n');
console.log('Release kit prepared: ' + kit);
