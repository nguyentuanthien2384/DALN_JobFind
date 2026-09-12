// Enable the existing Gmail sender on the current local deployment.
// Credentials are read privately from microservices/.env and never printed.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isValidEmailRecipient } from '../microservices/notification-service/src/libs/emailAddress.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'microservices/package.json'));
const requireBackend = createRequire(path.join(root, 'backend/package.json'));
const exec = promisify(execFile);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
const docker = async args => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
    catch { throw new Error('Docker operation failed; private output withheld'); }
};
const envOf = container => Object.fromEntries(container.Config.Env.map(value => {
    const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)];
}));
const containers = async () => {
    const ids = (await docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal'])).split(/\s+/).filter(Boolean);
    assert.ok(ids.length > 0, 'Current deployment must be running');
    return JSON.parse(await docker(['inspect', ...ids]));
};
const notification = all => {
    const selected = all.filter(c => c.Config.Labels['com.docker.compose.service'] === 'notification-service');
    assert.equal(selected.length, 1, 'Expected one notification service'); return selected[0];
};

let lock, lockFile, phase = 'preflight';
try {
    const name = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
    assert.match(name, /^activation-[0-9TZ-]+$/);
    const directory = path.join(root, '.local/deployments', name);
    lockFile = path.join(directory, 'mail-enable.lock');
    lock = await open(lockFile, 'wx', 0o600);
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const configFile = path.join(directory, 'compose.live.json'), stateFile = path.join(directory, 'state.json');
    const config = await readJson(configFile);
    const credentials = requireBackend('dotenv').parse(await readFile(path.join(root, 'microservices/.env')));
    const sender = String(credentials.EMAIL_APP || '').trim();
    const password = String(credentials.EMAIL_APP_PASSWORD || '');
    assert.ok(isValidEmailRecipient(sender) && !sender.includes('youremail') && password.trim(), 'Existing Gmail configuration is required');
    const before = await containers(), previous = notification(before);
    assert.ok(config.name === 'ai-job-portal' && config.services['notification-service'].image === previous.Image, 'Current pinned deployment must match');
    const smtp = require('nodemailer').createTransport({ service: 'gmail', auth: { user: sender, pass: password },
        connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
    try { await smtp.verify(); } finally { smtp.close(); }
    const mysql = require('mysql2/promise'), runningEnv = envOf(previous);
    const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(runningEnv.MYSQL_PORT || 3333),
        user: runningEnv.MYSQL_USER, password: runningEnv.MYSQL_PASSWORD, database: runningEnv.MYSQL_DATABASE, connectTimeout: 8000 });
    let backlog;
    try { [backlog] = await db.query("SELECT status, COUNT(*) AS count FROM notification_deliveries WHERE channel='email' GROUP BY status"); }
    finally { await db.end(); }
    const checkpoint = path.join(directory, 'mail-' + new Date().toISOString().replace(/[:.]/g, '-'));
    await mkdir(checkpoint, { recursive: true, mode: 0o700 });
    await save(path.join(checkpoint, 'compose.before.json'), config);
    await save(path.join(checkpoint, 'state.before.json'), await readJson(stateFile));
    // Compose uses $$ for literal dollars. Validate its resolved result before applying.
    config.services['notification-service'].environment.EMAIL_APP = sender.replaceAll('$', '$$');
    config.services['notification-service'].environment.EMAIL_APP_PASSWORD = password.replaceAll('$', '$$');
    const candidateFile = path.join(directory, 'compose.mail.preview.json');
    await save(candidateFile, config);
    const resolved = JSON.parse(await docker(['compose', '-f', candidateFile, 'config', '--format', 'json']));
    const targetEnv = resolved.services['notification-service'].environment;
    assert.ok(targetEnv.EMAIL_APP === sender && targetEnv.EMAIL_APP_PASSWORD === password, 'SMTP values must resolve exactly');
    phase = 'applying';
    await save(configFile, config);
    await unlink(candidateFile);
    await docker(['compose', '-f', configFile, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'notification-service']);
    let current;
    const end = Date.now() + 45000;
    do {
        current = notification(await containers());
        if (current.State.Running && current.State.Health?.Status === 'healthy') break;
        await delay(1000);
    } while (Date.now() < end);
    assert.ok(current.State.Running && current.State.Health?.Status === 'healthy', 'Notification service must become healthy');
    const actual = envOf(current);
    assert.ok(actual.EMAIL_APP === sender && actual.EMAIL_APP_PASSWORD === password, 'Live SMTP settings must match source');
    assert.ok(current.Image === previous.Image, 'Application image must stay pinned');
    const afterIds = new Set((await containers()).map(c => c.Id));
    assert.ok(before.filter(c => c.Id !== previous.Id).every(c => afterIds.has(c.Id)), 'Other containers must remain unchanged');
    const state = await readJson(stateFile);
    state.mailDelivery = { enabled: true, provider: 'gmail', source: 'microservices/.env', enabledAt: new Date().toISOString(), checkpoint };
    await save(stateFile, state);
    const report = { enabled: true, healthy: true, source: 'microservices/.env', service: 'notification-service',
        credentialsMatch: true, onlyNotificationRecreated: true, emailBacklogBefore: backlog, checkedAt: new Date().toISOString() };
    await save(path.join(directory, 'mail-enabled.json'), report);
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    const location = String(error.stack || '').split('\n').find(line => line.includes('enable-live-mail.mjs:'))?.match(/enable-live-mail\.mjs:\d+:\d+/)?.[0];
    console.error(`Mail enablement failed during ${phase}${location ? ' at ' + location : ''}; credentials and private diagnostics withheld. Inspect the current deployment before retrying.`);
    process.exitCode = 1;
} finally {
    if (lock) { await lock.close(); await unlink(lockFile); }
}
