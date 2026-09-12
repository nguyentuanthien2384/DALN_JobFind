import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeEnvironment } from './release/compose-environment.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), exec = promisify(execFile);
const require = createRequire(path.join(root, 'backend/package.json'));
const name = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
const directory = path.join(root, '.local/deployments', name);
const json = async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'));
const state = await json('state.json'), settings = await json('private.json'), compose = await json('compose.live.json');
const env = require('dotenv').parse(await readFile(path.join(root, 'backend/.env')));
const micro = require('dotenv').parse(await readFile(path.join(root, 'microservices/.env')));
const docker = async args => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
    catch { throw Error('Runtime check failed; private Docker output withheld'); }
};
const ids = (await docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal'])).split(/\s+/).filter(Boolean);
const containers = JSON.parse(await docker(['inspect', ...ids]));
const container = service => { const found = containers.filter(c => c.Config.Labels['com.docker.compose.service'] === service); assert.equal(found.length, 1); return found[0]; };
const report = { checkedAt: new Date().toISOString(), checks: [], services: [] };
for (const name of ['mongo', 'postgres', 'rabbitmq', 'redis', 'elasticsearch']) {
    const current = container(name), before = state.sourceBefore.find(c => c.service === name);
    assert.equal(current.Id, before.id); assert.equal(current.Config.Hostname, before.hostname); assert.equal(current.Image, before.image); assert.ok(current.State.Running);
    assert.deepEqual(current.Mounts.filter(m => m.Type === 'volume').map(m => ({ name: m.Name, target: m.Destination })), before.volumes);
}
report.checks.push('original infrastructure IDs, node identity, image IDs and data volumes retained');
for (const [name, config] of Object.entries(compose.services)) {
    const c = container(name); assert.equal(c.Image, config.image); assert.ok(c.State.Running);
    assert.equal(c.HostConfig.ReadonlyRootfs, true); assert.notEqual(c.Config.User, 'root'); assert.notEqual(c.Config.User, '');
    if (name !== 'web') assert.equal(Object.values(c.NetworkSettings.Ports || {}).filter(Boolean).length, 0);
    report.services.push({ name, image: c.Image, running: c.State.Running });
}
assert.ok(!containers.some(c => c.Config.Labels['com.docker.compose.service'] === 'ai-worker' && c.State.Running));
report.checks.push('all pinned application images running, non-root and read-only; Web is only app host port; AI worker stopped');
const ports = { backend: 5000, 'api-gateway': 4000, 'identity-service': 4001, 'job-core-service': 4002, 'search-service': 4003, 'application-service': 4004, 'notification-service': 4005, 'admin-service': 4006 };
for (const [name, port] of Object.entries(ports)) assert.equal(await docker(['exec', container(name).Id, 'node', '-e', `fetch('http://127.0.0.1:${port}/${name === 'backend' ? 'health' : 'readyz'}',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status))`]), '200');
report.checks.push('all eight HTTP runtime readiness checks passed');
const queues = JSON.parse(await docker(['exec', container('rabbitmq').Id, 'rabbitmqctl', 'list_queues', '--formatter', 'json', 'name', 'messages_ready', 'messages_unacknowledged', 'consumers']));
assert.ok(queues.every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0));
report.broker = { queues: queues.length, ready: 0, unacked: 0, consumers: queues.reduce((n, q) => n + q.consumers, 0) };
const db = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true });
try {
    const [[pending]] = await db.query('SELECT COUNT(*) n FROM outbox_events WHERE publishedAt IS NULL'); assert.equal(Number(pending.n), 0);
    const [[tasks]] = await db.query('SELECT COUNT(*) n FROM ai_tasks'); assert.equal(Number(tasks.n), 0);
    const [deliveries] = await db.query('SELECT channel, status, COUNT(*) n FROM notification_deliveries GROUP BY channel, status ORDER BY channel, status');
    report.notificationDeliveries = {
        total: deliveries.reduce((total, row) => total + Number(row.n), 0),
        counts: deliveries.map(row => ({ channel: row.channel, status: row.status, count: Number(row.n) }))
    };
    assert.ok(deliveries.every(row => ['sent', 'skipped'].includes(row.status)),
        'Notification deliveries must be settled with no pending, processing, failed or unknown outcomes');
    const [columns] = await db.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
    assert.deepEqual(columns, await json('mysql-schema-before.json'));
    report.checks.push('MySQL schema unchanged; outbox drained; no new AI tasks; notification deliveries settled without failed or unknown outcomes');
    for (const [role, c] of Object.entries(settings.mysqlRoles)) {
        const [global] = await db.query('SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=?', [`'${c.user}'@'%'`]);
        assert.ok(global.every(p => p.PRIVILEGE_TYPE === 'USAGE'), 'Unexpected global MySQL privilege');
        const [privileges] = await db.query('SELECT TABLE_SCHEMA,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=?', [`'${c.user}'@'%'`]);
        assert.ok(privileges.length > 0); assert.ok(privileges.every(p => p.TABLE_SCHEMA === env.DB_NAME && p.IS_GRANTABLE === 'NO'));
        if (['gateway', 'application', 'admin', 'notification'].includes(role)) assert.ok(privileges.every(p => p.PRIVILEGE_TYPE === 'SELECT'));
    }
    report.checks.push('six MySQL service accounts scoped to application database without global administration privileges');
} finally { await db.end(); }
const pg = await docker(['exec', container('postgres').Id, 'psql', '-U', micro.POSTGRES_USER, '-d', 'application_db', '-tA', '-c', `SELECT count(*) FROM pg_roles WHERE rolname IN ('${settings.pgRoles.application.user}','${settings.pgRoles.admin.user}') AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole;`]);
assert.equal(pg, '2'); report.checks.push('both PostgreSQL runtime roles are non-superuser without role/database creation');
const runtimeEnvironment = name => composeEnvironment(container(name).Config.Env);
const backendMail = runtimeEnvironment('backend');
assert.ok(backendMail.EMAIL_APP === '' && backendMail.EMAIL_APP_PASSWORD === '',
    'Legacy backend mail delivery must remain disabled');
const notificationMail = runtimeEnvironment('notification-service');
if (state.mailDelivery?.enabled === true) {
    // Keep resolved Compose and runtime secrets in memory; assertion values are
    // booleans so configuration mismatches never print credentials.
    const resolvedCompose = JSON.parse(await docker(['compose', '-f', path.join(directory, 'compose.live.json'), 'config', '--format', 'json']));
    const expectedMail = composeEnvironment(resolvedCompose.services?.['notification-service']?.environment);
    for (const key of ['EMAIL_APP', 'EMAIL_APP_PASSWORD']) {
        assert.ok(typeof expectedMail[key] === 'string' && expectedMail[key].trim().length > 0,
            'Enabled notification mail requires nonempty resolved Compose credentials');
        assert.ok(typeof notificationMail[key] === 'string' && notificationMail[key].trim().length > 0,
            'Enabled notification mail requires nonempty runtime credentials');
        assert.ok(notificationMail[key] === expectedMail[key],
            'Notification mail credentials must match resolved Compose configuration');
    }
    report.mailDelivery = { enabled: true, credentialsMatch: true, backendDisabled: true };
    report.checks.push('automatic notification mail enabled with matching runtime configuration; legacy backend mail remains disabled');
} else {
    assert.ok(notificationMail.EMAIL_APP === '' && notificationMail.EMAIL_APP_PASSWORD === '',
        'Notification mail must remain disabled until explicitly enabled in deployment state');
    report.mailDelivery = { enabled: false, backendDisabled: true };
    report.checks.push('external mail delivery remains disabled');
}
await writeFile(path.join(directory, 'runtime-health.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
