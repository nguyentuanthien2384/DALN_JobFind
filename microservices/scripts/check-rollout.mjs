import { execFile } from 'node:child_process';
import { promisify, parseEnv } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { featureFlags, mysqlChecks, evaluateFeatures, manualGates } from './rollout-policy.mjs';
import { mysqlProbe, postgresProbe } from './rollout-probes.mjs';
import { assertSecureJwtSecret } from '../shared/securityConfig.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--project' || !/^[a-z0-9][a-z0-9_-]*$/.test(args[1])) {
    console.error('Usage: npm run local:preflight -- --project ai-job-portal (read-only; JSON to stdout; exit 2 means hold)');
    process.exit(1);
}
const project = args[1], root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
const command = async (bin, values, timeout = 15000) => (await execute(bin, values,
    { cwd: root, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
const envOf = container => Object.fromEntries((container.Config.Env || []).map(value => {
    const index = value.indexOf('='); return [value.slice(0, index), value.slice(index + 1)];
}));
const diskEnv = async directory => { try { return parseEnv(await readFile(path.join(root, directory, '.env'), 'utf8')); } catch { return {}; } };
const checks = [];
const add = (id, status, detail) => checks.push({ id, status, ...(detail && { detail }) });
const report = { version: 1, observedAt: new Date().toISOString(), project, mode: 'read-only', checks };
try {
    report.sourceCommit = await command('git', ['rev-parse', 'HEAD']);
    report.dirtyCheckout = Boolean(await command('git', ['status', '--porcelain']));
    const ids = (await command('docker', ['ps','-aq','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);
    const containers = ids.length ? JSON.parse(await command('docker', ['inspect', ...ids])) : [];
    if (!containers.every(c => c.Config.Labels['com.docker.compose.project'] === project)) throw new Error('ownership');
    const byService = name => containers.filter(c => c.Config.Labels['com.docker.compose.service'] === name);
    const one = name => byService(name).length === 1 ? byService(name)[0] : null;
    const services = ['api-gateway','identity-service','job-core-service','search-service','application-service','notification-service','admin-service','ai-worker'];
    const ports = [4000,4001,4002,4003,4004,4005,4006,4007];
    report.containers = containers.map(c => ({ service: c.Config.Labels['com.docker.compose.service'], id: c.Id.slice(0,12),
        imageId: c.Image, status: c.State.Status, exitCode: c.State.ExitCode, readOnly: c.HostConfig.ReadonlyRootfs,
        user: c.Config.User || 'root', sourceBindMounted: c.Mounts.some(m => m.Type === 'bind' && m.Destination.startsWith('/app')),
        mounts: c.Mounts.map(m => ({ type: m.Type, destination: m.Destination, ...(m.Type === 'volume' && { name: m.Name }) })) }));
    report.stoppedDiagnostics = {};
    for (const name of services.filter(name => one(name) && !one(name).State.Running)) {
        try {
            const result = await execute('docker',['logs','--tail','60',one(name).Id],{windowsHide:true,timeout:10000,maxBuffer:128*1024});
            const logs = result.stdout + result.stderr;
            const missing = logs.match(/Cannot find (?:package|module) ['"]([^'"]+)['"]/);
            report.stoppedDiagnostics[name] = missing && /^[@a-zA-Z0-9_./-]+$/.test(missing[1])
                ? { missingModule:missing[1] } : { classified: /already exists.*different options|different options/s.test(logs) ? 'index-options-conflict'
                    : /AI_MONGO_URL is required/.test(logs) ? 'missing-ai-mongo-url'
                    : /ANTHROPIC_API_KEY is required/.test(logs) ? 'missing-ai-provider-key'
                    : /E11000/.test(logs) ? 'duplicate-index-data' : /ECONNREFUSED/.test(logs) ? 'dependency-connection-refused' : 'needs-log-review' };
        } catch { report.stoppedDiagnostics[name]={ unavailable:true }; }
    }
    await Promise.all(services.map(async (name, index) => {
        const c = one(name);
        if (!c || !c.State.Running) return add('runtime.' + name, 'blocked', c ? 'stopped' : 'missing-or-ambiguous');
        try {
            const status = await command('docker', ['exec', c.Id, 'node', '-e',
                `fetch('http://127.0.0.1:${ports[index]}/readyz',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(r.status)).catch(()=>console.log(0))`]);
            add('runtime.' + name, status === '200' ? 'pass' : 'blocked', 'readyz HTTP ' + (/^\d+$/.test(status) ? status : 'unknown'));
        } catch { add('runtime.' + name, 'unknown', 'probe-unavailable'); }
    }));
    const rabbit = one('rabbitmq');
    const rabbitVolume = rabbit?.Mounts.find(m => m.Destination === '/var/lib/rabbitmq');
    // An anonymous Docker volume survives stop/start, but is not a verified recreate/restore plan.
    add('broker.persistence', rabbitVolume?.Type === 'volume' && !/^[a-f0-9]{64}$/.test(rabbitVolume.Name)
        ? 'unknown' : 'blocked', rabbitVolume ? 'restore-and-recreate-plan-not-verified' : 'no-data-mount');
    if (rabbit?.State.Running) {
        try {
            const queues = await command('docker', ['exec', rabbit.Id, 'rabbitmqctl','list_queues','--formatter','json',
                'name','messages_ready','messages_unacknowledged','consumers'], 20000);
            report.queues = JSON.parse(queues).map(q => ({ name:q.name, ready:q.messages_ready, unacked:q.messages_unacknowledged, consumers:q.consumers }));
        } catch { report.queues = { unavailable: true }; }
    }
    const probe = async (service, code) => {
        const c = one(service); if (!c?.State.Running) return { unavailable: true };
        try { return JSON.parse(await command('docker', ['exec', c.Id, 'node','--input-type=module','-e', code], 25000)); }
        catch { return { unavailable: true }; }
    };
    [report.mysql, report.postgres] = await Promise.all([probe('job-core-service',mysqlProbe), probe('application-service',postgresProbe)]);
    const worker = one('ai-worker');
    report.workerConfiguration = { taskStoreUrlPresent: Boolean(worker && envOf(worker).AI_MONGO_URL),
        providerKeyPresent: Boolean(worker && envOf(worker).ANTHROPIC_API_KEY), providerCallMade:false };
    report.mongo = await probe('identity-service', `
        const {MongoClient}=await import('mongodb');const db=new MongoClient(process.env.MONGO_URL,{serverSelectionTimeoutMS:5000});
        try {await db.connect();const result={};for(const [name,collection] of [['admin_db','auditlogs'],['ai_worker_db','task_executions']]){
            const metadata=await db.db(name).listCollections({name:collection}).toArray();
            result[name]={exists:metadata.length===1,indexes:metadata.length?await db.db(name).collection(collection).listIndexes().toArray():[]};
        }console.log(JSON.stringify(result));}catch{console.log(JSON.stringify({unavailable:true}));}finally{await db.close();}`);
    checks.push(...mysqlChecks(report.mysql));
    const required = { applications: ['id','legacy_cv_id','job_id','candidate_id','company_id','stage','cv_snapshot'],
        application_events: ['application_id','from_stage','to_stage'], application_notes: ['application_id','author_id','body'] };
    const pg = report.postgres;
    const pgPresent = pg.columns && Object.entries(required).every(([table, columns]) => columns.every(name => pg.columns.some(c => c.table_name === table && c.column_name === name)));
    const pgUnique = pg.indexes?.some(i => i.tablename === 'applications' && /CREATE UNIQUE INDEX/.test(i.indexdef)
        && /\(legacy_cv_id\)$/.test(i.indexdef));
    add('postgres.application-schema', !pg.columns ? 'unknown' : pgPresent && pgUnique ? 'pass' : 'blocked', 'partial-columns-and-legacy-id-unique-only');
    const backend = await diskEnv('backend'), frontend = await diskEnv('frontend');
    const gateway = one('api-gateway'); const gatewayEnv = gateway ? envOf(gateway) : {};
    const policy = env => [env.JWT_SECRET, env.JWT_ISSUER || 'jobfind-auth',env.JWT_AUDIENCE || 'jobfind-api',Number(env.JWT_ACCESS_TTL_SECONDS || 900)];
    add('jwt.disk-to-gateway', backend.JWT_SECRET && gatewayEnv.JWT_SECRET && JSON.stringify(policy(backend)) === JSON.stringify(policy(gatewayEnv))
        ? 'pass' : 'blocked', 'disk-backend-policy-compared-with-container; running-backend-not-proven');
    // Worker only consumes/publishes through RabbitMQ; it has no trusted business HTTP route.
    const secretMismatches = services.filter(name => name !== 'ai-worker').filter(name => !one(name) || !envOf(one(name)).INTERNAL_SECRET
        || envOf(one(name)).INTERNAL_SECRET !== gatewayEnv.INTERNAL_SECRET);
    add('internal-secret-consistency', !secretMismatches.length && gatewayEnv.INTERNAL_SECRET !== gatewayEnv.JWT_SECRET ? 'pass' : 'blocked',
        secretMismatches.length ? 'missing-or-mismatched: ' + secretMismatches.join(', ') : 'distinct JWT/internal keys');
    try { assertSecureJwtSecret(gatewayEnv.JWT_SECRET); assertSecureJwtSecret(gatewayEnv.INTERNAL_SECRET); add('secret-policy','pass'); }
    catch { add('secret-policy','blocked','missing-or-insufficient-secret'); }
    report.frontendDiskFlags = Object.fromEntries(Object.values(featureFlags).map(([key, off, on]) =>
        [key, frontend[key] == null ? off : [off,on].includes(frontend[key]) ? frontend[key] : 'invalid']));
    report.frontendDiskFlagsAreServedEvidence = false;
    report.runtimeArtifactsImmutable = report.containers.filter(c => services.includes(c.service)).length === services.length
        && report.containers.filter(c => services.includes(c.service)).every(c => c.readOnly && !c.sourceBindMounted && c.user !== 'root');
    for (const id of manualGates) add(id,'unknown');
    add('provider-approved','unknown','No provider request issued');
    report.features = evaluateFeatures(checks);
    report.decision = 'hold'; // Collector deliberately cannot attest the manual release gates.
    checks.sort((a,b) => a.id.localeCompare(b.id));
    console.log(JSON.stringify(report,null,2));
    process.exitCode = 2;
} catch {
    // Never echo exec errors: Docker inspect/env or DB messages can contain credentials.
    console.log(JSON.stringify({ ...report, decision:'hold', collectionError:'read-only observation unavailable' },null,2));
    process.exitCode = 2;
}
