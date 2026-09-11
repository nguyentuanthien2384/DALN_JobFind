import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupMysql, backupContainer, writeBackupManifest } from './backup-local.mjs';
import { verifyBackup, verifyCrashData, markBackupVerified } from './backup-integrity.mjs';

assert.equal(process.argv.length, 4, 'Usage: node scripts/restore-drill.mjs --source-project NAME');
assert.equal(process.argv[2], '--source-project');
const sourceProject = process.argv[3];
assert.match(sourceProject, /^[a-z0-9][a-z0-9_-]+$/);
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'backend/package.json'));
const token = randomUUID();
const project = `jobfind-restore-${token.slice(0, 8)}`;
const label = `jobfind.restore=${token}`;
const image = `${project}:test`;
const directory = path.join(root, '.local', 'backups', `restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'jobfind-restore-'));
const execute = promisify(execFile);
const docker = async (...args) => {
    try { return (await execute('docker', args, { timeout: 240000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout.trim(); }
    catch { throw new Error(`Docker ${args[0]} failed; recovery stopped without publishing private logs`); }
};
const inspect = async id => JSON.parse(await docker('inspect', id))[0];
const envOf = c => Object.fromEntries(c.Config.Env.map(v => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)]; }));
const sourceIds = (await docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${sourceProject}`)).split(/\s+/).filter(Boolean);
assert.ok(sourceIds.length, 'Source project not found');
const sources = await Promise.all(sourceIds.map(inspect));
assert.ok(sources.every(c => !c.State.Running), 'All source project containers must already be stopped; this script never stops them');
const paths = { mongo: '/data/db', postgres: '/var/lib/postgresql/data', rabbitmq: '/var/lib/rabbitmq' };
const original = {};
for (const [service, destination] of Object.entries(paths)) {
    const candidates = sources.filter(c => c.Config.Labels['com.docker.compose.service'] === service);
    assert.equal(candidates.length, 1, 'Source service must be unambiguous');
    const c = candidates[0];
    const mount = c.Mounts.find(m => m.Destination === destination);
    assert.equal(mount?.Type, 'volume');
    original[service] = { container: c, volume: mount.Name, destination };
}
const assertOffline = async () => {
    for (const { volume, container } of Object.values(original)) {
        assert.equal((await inspect(container.Id)).State.Running, false);
        const ids = (await docker('ps', '-q', '--filter', `volume=${volume}`)).split(/\s+/).filter(Boolean);
        for (const id of ids) assert.ok(!(await inspect(id)).Mounts.some(m => m.Name === volume && m.RW), 'Source volume has a live writer');
    }
};
const helpers = new Set();
async function helper(args) {
    const name = `${project}-helper-${randomUUID().slice(0, 8)}`;
    helpers.add(name);
    try { return await docker('run', '--name', name, '--label', label, '--rm', '--network', 'none', '--read-only', ...args); }
    finally {
        const ids = await docker('ps', '-aq', '--filter', `name=^/${name}$`, '--filter', `label=${label}`);
        if (ids) await docker('rm', '-f', '-v', ids);
        helpers.delete(name);
    }
}
const hashVolume = volume => helper(['--entrypoint', 'sh', '--mount', `type=volume,src=${volume},dst=/snapshot,readonly`, '-w', '/snapshot',
    original.mongo.container.Image, '-ec', 'find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum']);
const archiveVolume = async (volume, file) => helper(['--entrypoint', 'sh',
    '--mount', `type=volume,src=${volume},dst=/source,readonly`, '--mount', `type=bind,src=${directory},dst=/backup`,
    original.mongo.container.Image, '-ec', 'tar -czf /backup/"$1" -C /source .', 'archive', file]);
const volumeNames = new Set();
async function restoreVolume(volume, file) {
    await docker('volume', 'create', '--label', label, volume); volumeNames.add(volume);
    await helper(['--entrypoint', 'sh', '--mount', `type=volume,src=${volume},dst=/target`,
        '--mount', `type=bind,src=${directory},dst=/backup,readonly`, original.mongo.container.Image, '-ec',
        'test -z "$(ls -A /target)"; tar -xzf /backup/"$1" -C /target', 'restore', file]);
}
const pgEnv = envOf(original.postgres.container), rabbitEnv = envOf(original.rabbitmq.container);
const sqlSecret = randomUUID() + randomUUID();
const brokerNode = rabbitEnv.RABBITMQ_NODENAME || `rabbit@${original.rabbitmq.container.Config.Hostname}`;
const config = { services: {}, networks: { default: { internal: true } }, volumes: {} };
const common = { MYSQL_HOST: 'mysql', MYSQL_PORT: '3306', MYSQL_USER: 'root', MYSQL_PASSWORD: sqlSecret,
    MYSQL_DATABASE: 'recovery', POSTGRES_USER: pgEnv.POSTGRES_USER,
    POSTGRES_PASSWORD: pgEnv.POSTGRES_PASSWORD, POSTGRES_DATABASE: pgEnv.POSTGRES_DB || 'application_db',
    BROKER_USER: rabbitEnv.RABBITMQ_DEFAULT_USER, BROKER_PASSWORD: rabbitEnv.RABBITMQ_DEFAULT_PASS,
    REHEARSAL_ID: token, RABBITMQ_NODENAME: brokerNode };
assert.ok(common.BROKER_USER && common.BROKER_PASSWORD && common.POSTGRES_USER);
const composeFile = path.join(temporary, 'compose.json'), envFile = path.join(temporary, 'empty.env');
await writeFile(envFile, '');
const compose = (...args) => docker('compose', '--env-file', envFile, '-p', project, '-f', composeFile, ...args);
const services = ['mysql', 'mongo', 'postgres', 'rabbitmq'];
let started = false;
const report = { observedAt: new Date().toISOString(), sourceProject, project,
    backupDirectory: path.relative(root, directory).replaceAll('\\', '/'), sourceReadOnly: true, checks: [], sources: {} };
const check = message => { report.checks.push(message); console.log(`PASS: ${message}`); };
const probes = async phase => {
    const output = await compose('run', '--rm', '--no-deps', 'runner', 'node', '/recovery/restore-probes.mjs', phase);
    const evidence = output.split('\n').find(line => line.startsWith('EVIDENCE: '));
    assert.ok(evidence, 'Missing probe evidence');
    return JSON.parse(evidence.slice(10));
};
async function configure(generation) {
    config.volumes = {};
    for (const service of services) {
        const volume = `${project}-${generation}-${service}`;
        config.volumes[volume] = { external: true, name: volume };
        const destination = paths[service] || '/var/lib/mysql';
        const base = { image: service === 'mysql' ? 'mariadb:10.4.32' : original[service].container.Image,
            pull_policy: 'never', volumes: [`${volume}:${destination}`, `${directory}:/backup:ro`],
            mem_limit: service === 'rabbitmq' ? '512m' : '384m', stop_grace_period: '60s' };
        if (service === 'mysql') Object.assign(base, { environment: { MYSQL_ROOT_PASSWORD: sqlSecret, MYSQL_ROOT_HOST: '%', MYSQL_DATABASE: 'recovery' },
            command: ['--lower-case-table-names=1', '--max-allowed-packet=64M'] });
        if (service === 'mongo') base.command = ['mongod', '--bind_ip_all', '--setParameter', 'ttlMonitorEnabled=false'];
        if (service === 'postgres') base.environment = { POSTGRES_USER: common.POSTGRES_USER, POSTGRES_PASSWORD: common.POSTGRES_PASSWORD, POSTGRES_DB: common.POSTGRES_DATABASE };
        if (service === 'rabbitmq') Object.assign(base, { hostname: original.rabbitmq.container.Config.Hostname,
            environment: { RABBITMQ_NODENAME: brokerNode, RABBITMQ_DEFAULT_USER: common.BROKER_USER, RABBITMQ_DEFAULT_PASS: common.BROKER_PASSWORD } });
        config.services[service] = base;
    }
    config.services.runner = { image, pull_policy: 'never', working_dir: '/app', environment: common,
        volumes: [`${path.join(root, 'scripts')}:/recovery:ro`], command: ['node', '/recovery/restore-probes.mjs', 'snapshot'],
        profiles: ['test'], init: true, healthcheck: { disable: true } };
    await writeFile(composeFile, JSON.stringify(config), { mode: 0o600 });
}
try {
    console.log(`Backup/restore rehearsal: ${project}`);
    await assertOffline();
    // Validate older backups without changing them. Only complete manifests are candidates.
    report.previousBackups = [];
    for (const entry of await readdir(path.join(root, '.local/backups'), { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\d{4}-/.test(entry.name)) continue;
        await verifyBackup(path.join(root, '.local/backups', entry.name));
        report.previousBackups.push({ directory: entry.name, integrity: 'passed' });
    }
    const backendEnv = require('dotenv').parse(await readFile(path.join(root, 'backend/.env')));
    const mysql = await backupMysql(root, backendEnv, directory);
    assert.equal(mysql.version, '10.4.32-MariaDB', 'This drill is pinned to the observed MariaDB version');
    report.mysql = mysql;
    check('fresh read-only MariaDB snapshot includes table schemas and full row/BLOB checksums');
    for (const [service, source] of Object.entries(original)) {
        await assertOffline();
        const sha = await hashVolume(source.volume);
        await archiveVolume(source.volume, `${service}-source.tar.gz`);
        assert.equal(await hashVolume(source.volume), sha);
        report.sources[service] = { image: source.container.Image, volume: source.volume,
            sourceExitCode: source.container.State.ExitCode, fileManifestSha256: sha.split(/\s/)[0],
            ...(service === 'rabbitmq' && { hostname: source.container.Config.Hostname, nodeName: brokerNode }) };
        await restoreVolume(`${project}-first-${service}`, `${service}-source.tar.gz`);
        assert.equal(await hashVolume(`${project}-first-${service}`), sha);
    }
    await writeBackupManifest(directory, { mysql, sources: report.sources, coordinatedCheckpoint: false });
    await verifyBackup(directory);
    check('MongoDB/PostgreSQL/RabbitMQ source archives restore byte-for-byte into new volumes');
    const sqlVolume = `${project}-first-mysql`;
    await docker('volume', 'create', '--label', label, sqlVolume); volumeNames.add(sqlVolume);
    await docker('build', '-t', image, path.join(root, 'microservices'));
    report.applicationImage = (await inspect(image)).Id;
    await configure('first'); started = true;
    await compose('up', '-d', '--pull', 'never', ...services);
    await probes('ready');
    await compose('exec', '-T', 'mysql', 'sh', '-ec', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --binary-mode=1 --max-allowed-packet=64M -uroot recovery < /backup/mysql.sql');
    report.baseline = await probes('snapshot');
    assert.deepEqual(report.baseline.mysql, mysql.tables, 'MariaDB restored data/schema checksums differ');
    check('original data, CV bytes and all MariaDB schemas match the saved transaction');
    // Export native logical backups as well; test their restore into separate empty namespaces.
    await backupContainer(root, ['exec', await compose('ps', '-q', 'postgres'), 'pg_dump', '-U', common.POSTGRES_USER, '-d', common.POSTGRES_DATABASE, '-Fc'], path.join(directory, 'postgres.dump'));
    await backupContainer(root, ['exec', await compose('ps', '-q', 'mongo'), 'mongodump', '--archive', '--gzip', '--quiet'], path.join(directory, 'mongo.archive.gz'));
    await compose('exec', '-T', 'postgres', 'createdb', '-U', common.POSTGRES_USER, 'restore_logical');
    await compose('exec', '-T', 'postgres', 'pg_restore', '--exit-on-error', '--single-transaction', '-U', common.POSTGRES_USER, '-d', 'restore_logical', '/backup/postgres.dump');
    for (const db of Object.keys(report.baseline.mongo)) {
        await compose('exec', '-T', 'mongo', 'mongorestore', '--archive=/backup/mongo.archive.gz', '--gzip', '--stopOnError',
            `--nsInclude=${db}.*`, `--nsFrom=${db}.*`, `--nsTo=restore_logical_${db}.*`, '--quiet');
    }
    const logical = await probes('logical');
    assert.deepEqual(logical.postgres, report.baseline.postgres);
    assert.deepEqual(logical.mongo, report.baseline.mongo);
    check('native pg_dump/pg_restore and mongodump/mongorestore preserve rows, indexes and sequences');
    await probes('seed');
    const holder = `${project}-unacked`;
    await compose('run', '-d', '--no-deps', '--name', holder, 'runner', 'node', '/recovery/restore-probes.mjs', 'hold');
    report.checkpoint = await probes('checkpoint');
    check('confirmed persistent messages include ready, unacked and dead-letter cases with a committed receipt');
    const crashStarted = Date.now();
    await compose('kill', '-s', 'SIGKILL', ...services);
    await docker('rm', '-f', holder);
    await compose('start', ...services);
    const recovered = await probes('recovered');
    report.afterCrash = recovered;
    report.sequenceAdvancesAfterCrash = verifyCrashData(report.checkpoint.data, recovered.data);
    assert.deepEqual(recovered.queues, report.checkpoint.expectedQueuesAfterRecovery);
    report.crashRecoverySeconds = (Date.now() - crashStarted) / 1000;
    check('forced database/broker crash recovers committed records and requeues the unacked message');
    await compose('stop', ...services);
    for (const service of services) {
        const c = await inspect(await compose('ps', '-aq', service));
        assert.equal(c.State.ExitCode, 0, 'Checkpoint source did not stop cleanly');
        await archiveVolume(`${project}-first-${service}`, `${service}-checkpoint.tar.gz`);
    }
    // Final manifest seals every retained artifact; archives contain private data, kept under .local.
    await rm(path.join(directory, 'manifest.json'));
    await writeBackupManifest(directory, { mysql, sources: report.sources, coordinatedCheckpoint: true,
        checkpointScope: 'isolated fixture only; not a distributed point-in-time snapshot of the live system' });
    await verifyBackup(directory);
    await compose('down', '--volumes', '--remove-orphans');
    const restoreStarted = Date.now();
    for (const service of services) {
        const volume = `${project}-first-${service}`;
        assert.equal(JSON.parse(await docker('volume', 'inspect', volume))[0].Labels['jobfind.restore'], token);
        await docker('volume', 'rm', volume); volumeNames.delete(volume);
        await restoreVolume(`${project}-replacement-${service}`, `${service}-checkpoint.tar.gz`);
    }
    await configure('replacement');
    await compose('up', '-d', '--pull', 'never', ...services);
    const replacement = await probes('recovered');
    assert.deepEqual(replacement, recovered);
    report.replacementRestoreSeconds = (Date.now() - restoreStarted) / 1000;
    check('after removing all test containers and data volumes, archived backups restore the same records and queues');
    report.delivery = await probes('deliver');
    assert.equal(report.delivery.effects, 6);
    assert.equal(report.delivery.duplicates, 1);
    await compose('restart', 'rabbitmq');
    await probes('empty');
    check('redelivery after commit/before ACK produces one effect per message; ACK survives broker restart');
    const network = JSON.parse(await docker('network', 'inspect', `${project}_default`))[0];
    assert.equal(network.Internal, true);
    for (const id of (await compose('ps', '-aq')).split(/\s+/).filter(Boolean)) {
        const c = await inspect(id);
        assert.equal(c.Config.Labels['com.docker.compose.project'], project);
        assert.deepEqual(Object.keys(c.HostConfig.PortBindings || {}), []);
        assert.deepEqual(Object.keys(c.NetworkSettings.Networks), [`${project}_default`]);
        assert.ok(!c.Mounts.some(m => Object.values(original).some(s => s.volume === m.Name)));
    }
    await verifyBackup(directory);
    report.status = 'passed';
} catch (error) {
    report.status = 'failed';
    // Assertion messages contain only metadata/checksums; driver errors are never emitted.
    console.error('Restore drill failed:', error.message);
    process.exitCode = 1;
} finally {
    if (started) await compose('down', '--volumes', '--remove-orphans', '--timeout', '60');
    for (const volume of volumeNames) {
        assert.equal(JSON.parse(await docker('volume', 'inspect', volume))[0].Labels['jobfind.restore'], token);
        await docker('volume', 'rm', volume);
    }
    await docker('image', 'rm', image).catch(() => {});
    await assertOffline();
    for (const [service, source] of Object.entries(original)) {
        if (report.sources[service]) assert.equal((await hashVolume(source.volume)).split(/\s/)[0], report.sources[service].fileManifestSha256);
    }
    for (const before of sources) assert.deepEqual((await inspect(before.Id)).State, before.State);
    report.sourceUnchanged = true;
    report.cleaned = true;
    if (report.status === 'passed') await markBackupVerified(directory, report);
    await writeFile(path.join(root, 'microservices/docs/backup-restore-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
    assert.equal(path.dirname(temporary), tmpdir());
    await rm(temporary, { recursive: true, force: true });
    console.log(`Source unchanged; test resources removed; backup retained at ${report.backupDirectory}`);
}
