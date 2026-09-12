import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupMysql, backupContainer, writeBackupManifest } from './backup-local.mjs';
import { verify, sha256 } from './release/verify.mjs';
import { activationProbe } from './activation-probes.mjs';
import { verifyBackup } from './backup-integrity.mjs';
import { composeEnvironment } from './release/compose-environment.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'backend/package.json'));
const mysql = require('mysql2/promise'), dotenv = require('dotenv');
const exec = promisify(execFile);
const jsonFile = async p => JSON.parse(await readFile(p, 'utf8'));
const writeJson = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const run = async (args, options = {}) => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 12 * 1024 * 1024, ...options })).stdout.trim(); }
    catch (e) { throw new Error(`Docker ${args[0]} ${args[1] || ''} failed (${e.code || 'unknown'}); private output withheld`); }
};
const input = (args, data) => new Promise((resolve, reject) => {
    const c = spawn('docker', args, { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let diagnostic=''; c.stdout.resume(); c.stderr.on('data',part=>{diagnostic=(diagnostic+part.toString()).slice(-8192);}); c.on('error', reject);
    const timer = setTimeout(() => c.kill(), 180000);
    c.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('Private Docker input operation failed: ' + code + ' ' + (diagnostic.match(/ERROR\s+\d+/)?.[0] || 'details withheld'))); });
    c.stdin.on('error', () => {}); c.stdin.end(data);
});
const inspect = async ref => JSON.parse(await run(['inspect', ref]))[0];
const envOf = c => Object.fromEntries(c.Config.Env.map(v => { const i = v.indexOf('='); return [v.slice(0, i), v.slice(i + 1)]; }));
const sourceContainers = async () => {
    const ids = (await run(['ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal'])).split(/\s+/).filter(Boolean);
    return JSON.parse(await run(['inspect', ...ids]));
};
const summary = list => list.map(c => ({ id: c.Id, service: c.Config.Labels['com.docker.compose.service'], image: c.Image, running: c.State.Running,
    hostname: c.Config.Hostname, volumes: c.Mounts.filter(m => m.Type === 'volume').map(m => ({ name: m.Name, target: m.Destination })) }));
const wait = async (fn, ms = 180000) => { const end = Date.now() + ms; let err; do { try { const v = await fn(); if (v) return v; } catch(e) {err=e;} await new Promise(r => setTimeout(r,1000)); } while(Date.now()<end); throw err || Error('Readiness timeout'); };
const backendEnv = dotenv.parse(await readFile(path.join(root, 'backend/.env')));
const microEnv = dotenv.parse(await readFile(path.join(root, 'microservices/.env')));
const action = process.argv[2];
assert.ok(['prepare', 'rehearse', 'reset-clone-mysql', 'probe-clone', 'deploy', 'verify'].includes(action), 'Unknown activation phase');
let directory, state;
const latest = path.join(root, '.local/deployments/LATEST');
if (action === 'prepare') {
    const name = 'activation-' + new Date().toISOString().replace(/[:.]/g, '-');
    directory = path.join(root, '.local/deployments', name); await mkdir(directory, { recursive: true });
    state = { name, startedAt: new Date().toISOString(), status: 'preparing', checks: [] };
    await writeFile(latest, name);
} else {
    directory = path.join(root, '.local/deployments', (await readFile(latest, 'utf8')).trim());
    state = await jsonFile(path.join(directory, 'state.json'));
}
const save = () => writeJson(path.join(directory, 'state.json'), state);
const pass = async (name, detail) => { state.checks.push({ name, status: 'passed', at: new Date().toISOString(), ...(detail && { detail }) }); await save(); console.log('PASS ' + name); };
const kit = path.join(root, '.local/releases', 'bc9cb1c4e070-2026-09-11T14-26-04-972Z');
const manifest = await verify(kit);
assert.equal(await sha256(path.join(kit, 'manifest.json')), 'f2ec068f3f83f9fc36501df84c45bbf220efc7b5200d5ab9b6fd21f3562cd7e1');
const image = role => manifest.images.find(i => i.role === role).id;
const backup = path.join(directory, 'backup');
const configPath = path.join(directory, 'private.json');
const quote = s => '`' + String(s).replace(/`/g, '``') + '`';
const dbConnection = () => mysql.createConnection({ host: backendEnv.DB_HOST, port: Number(backendEnv.DB_PORT), user: backendEnv.DB_USER, password: backendEnv.DB_PASSWORD, database: backendEnv.DB_NAME, connectTimeout: 8000, dateStrings: true });

async function provisionMysql(db, settings) {
    for (const [role, credential] of Object.entries(settings.mysqlRoles)) {
        const [exists] = await db.query('SELECT User FROM mysql.user WHERE User=?', [credential.user]);
        assert.equal(exists.length, 0, 'Refuse to replace an existing account');
        await db.query('CREATE USER ?@\'%\' IDENTIFIED BY ?', [credential.user, credential.password]);
        const principal = db.escape(credential.user) + "@'%'";
        const database = '`' + settings.database.replace(/`/g,'``') + '`';
        const rights = ['backend','core'].includes(role) ? 'SELECT, INSERT, UPDATE, DELETE' : 'SELECT';
        await db.query(`GRANT ${rights} ON ${database}.* TO ${principal}`);
        const creation = role === 'core' ? ['ai_tasks','outbox_events','job_moderation_state','ai_result_inbox','ai_request_keys','job_request_keys'] : role === 'notification' ? ['notification_inbox','notification_deliveries'] : [];
        for (const table of creation) await db.query(`GRANT CREATE ON ${database}.\`${table}\` TO ${principal}`);
        if (role === 'notification') for (const table of ['notifications','notification_inbox','notification_deliveries']) await db.query(`GRANT INSERT, UPDATE, DELETE ON ${database}.\`${table}\` TO ${principal}`);
    }
}
async function pgSetup(container, settings) {
    const q = v => "'" + String(v).replace(/'/g, "''") + "'";
    const app = settings.pgRoles.application, admin = settings.pgRoles.admin;
    const sql = `CREATE ROLE ${app.user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${q(app.password)};
CREATE ROLE ${admin.user} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${q(admin.password)};
GRANT CONNECT ON DATABASE application_db TO ${app.user}, ${admin.user};
GRANT USAGE, CREATE ON SCHEMA public TO ${app.user};
GRANT USAGE ON SCHEMA public TO ${admin.user};
${['applications','application_events','application_notes','talent_pool','outbox_events'].map(t => `ALTER TABLE public.${t} OWNER TO ${app.user};`).join('\n')}
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${admin.user};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${app.user};`;
    await input(['exec','-i',container,'psql','-v','ON_ERROR_STOP=1','-U',microEnv.POSTGRES_USER,'-d','application_db'], sql);
}
async function makeCompose(settings, clone) {
    const base = await jsonFile(path.join(kit, 'compose.json'));
    for (const service of Object.values(base.services)) {
        service.environment = composeEnvironment(service.environment);
    }
    delete base.services['ai-worker'];
    base.name = clone ? settings.clone : 'ai-job-portal';
    base.networks.default.name = clone ? settings.clone : 'ai-job-portal_default';
    const binds = { ...microEnv, MYSQL_PASSWORD: settings.mysqlRoles.backend.password, MYSQL_HOST: clone ? 'mysql' : microEnv.MYSQL_HOST, MYSQL_PORT: clone ? '3306' : microEnv.MYSQL_PORT,
        JWT_SECRET: backendEnv.JWT_SECRET, INTERNAL_SECRET: microEnv.INTERNAL_SECRET, METRICS_TOKEN_FILE: path.join(directory, 'metrics-token'),
        CLOUD_NAME: backendEnv.CLOUD_NAME, API_KEY: backendEnv.API_KEY, API_SECRET: backendEnv.API_SECRET,
        PAYPAL_CLIENT_ID: backendEnv.PAYPAL_CLIENT_ID || backendEnv.CLIENT_ID, PAYPAL_CLIENT_SECRET: backendEnv.PAYPAL_CLIENT_SECRET || backendEnv.CLIENT_SECRET };
    function resolve(v) {
        if (typeof v === 'string') return v.replace(/\$\{([A-Z_]+)(?::\?[^}]*)?\}/g, (_,key) => { assert.ok(binds[key], 'Missing binding ' + key); return binds[key]; });
        if (Array.isArray(v)) return v.map(resolve);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]));
        return v;
    }
    const result = resolve(base);
    const roles = { backend:'backend', 'api-gateway':'gateway', 'job-core-service':'core', 'application-service':'application', 'notification-service':'notification', 'admin-service':'admin' };
    for (const [name,role] of Object.entries(roles)) {
        const e = result.services[name].environment, credential = settings.mysqlRoles[role];
        e[name === 'backend' ? 'DB_USER' : 'MYSQL_USER'] = credential.user;
        e[name === 'backend' ? 'DB_PASSWORD' : 'MYSQL_PASSWORD'] = credential.password;
        e[name === 'backend' ? 'DB_HOST' : 'MYSQL_HOST'] = clone ? 'mysql' : microEnv.MYSQL_HOST;
        e[name === 'backend' ? 'DB_PORT' : 'MYSQL_PORT'] = clone ? '3306' : microEnv.MYSQL_PORT;
        if (clone && name === 'backend') { e.DB_HOST='mysql'; e.DB_PORT='3306'; }
    }
    for(const service of Object.values(result.services)) if(service.environment?.JWT_SECRET) service.environment.JWT_SECRET=backendEnv.JWT_SECRET;
    Object.assign(result.services['notification-service'].environment,{EMAIL_APP:'',EMAIL_APP_PASSWORD:'',EMAIL_DEMO_RECIPIENT:'',LEGACY_URL:'http://backend:5000',FRONTEND_URL:'http://localhost:3001'});
    Object.assign(result.services['api-gateway'].environment,{LEGACY_URL:'http://backend:5000',CORS_ORIGIN:'http://localhost:3001,http://127.0.0.1:3001'});
    for(const [name,role] of [['application-service','application'],['admin-service','admin']]) {
        const c = settings.pgRoles[role]; result.services[name].environment.POSTGRES_URL=`postgres://${c.user}:${c.password}@postgres:5432/application_db`;
    }
    // Web is the only host entrypoint. Provider-dependent writes are gated by its fixed config.
    delete result.services['api-gateway'].ports;
    if (clone) {
        for (const service of Object.values(result.services)) { delete service.ports; service.restart = 'no'; }
        delete result.services.web;
    } else {
        result.services.web.volumes = [{ type:'bind', source:path.join(directory,'nginx-gated.conf'), target:'/etc/nginx/nginx.conf', read_only:true }];
    }
    return result;
}
const composeRun = (file, args) => run(['compose','-f',file,...args]);
async function startService(file, name, project) {
    await composeRun(file, ['up','-d','--no-deps','--no-build','--pull','never',name]);
    const id = (await run(['ps','-aq','--filter',`label=com.docker.compose.project=${project}`,'--filter',`label=com.docker.compose.service=${name}`])).split(/\s+/).filter(Boolean);
    assert.equal(id.length,1);
    const port = {backend:5000,'api-gateway':4000,'identity-service':4001,'job-core-service':4002,'search-service':4003,'application-service':4004,'notification-service':4005,'admin-service':4006}[name];
    await wait(async () => {
        const c=await inspect(id[0]); if(!c.State.Running)throw Error(name+' stopped');
        return (await run(['exec',id[0],'node','-e',`fetch('http://127.0.0.1:${port}/${name==='backend'?'health':'readyz'}',{signal:AbortSignal.timeout(4000)}).then(r=>console.log(r.status)).catch(()=>console.log(0))`])) === '200';
    });
    await pass((project==='ai-job-portal'?'live ':'clone ')+name+' ready');
}

try {
    if (action === 'prepare') {
        const containers = await sourceContainers(); assert.ok(containers.every(c=>!c.State.Running),'Source applications must be stopped before checkpoint');
        state.sourceBefore = summary(containers); state.applicationCommit = manifest.applicationCommit;
        await mkdir(backup);
        const db = await dbConnection();
        try {
            const [[pending]]=await db.query('SELECT COUNT(*) n FROM outbox_events WHERE publishedAt IS NULL');
            assert.equal(Number(pending.n),0,'Unpublished MySQL events need explicit drain review');
            const [active]=await db.query("SELECT status, COUNT(*) n FROM ai_tasks GROUP BY status"); state.aiTasksBefore=active;
            const [accounts]=await db.query("SELECT a.roleCode, COUNT(*) n FROM accounts a WHERE a.statusCode='S1' GROUP BY a.roleCode"); state.accountRoles=accounts;
            const [columns]=await db.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
            const [grants]=await db.query('SELECT USER() currentUser'); assert.ok(grants.length);
            await writeJson(path.join(directory,'mysql-schema-before.json'),columns);
        } finally {await db.end();}
        const mysqlBackup = await backupMysql(root, backendEnv, backup);
        state.backupMysql = mysqlBackup;
        for (const [service,destination] of [['mongo','/data/db'],['postgres','/var/lib/postgresql/data'],['rabbitmq','/var/lib/rabbitmq'],['elasticsearch','/usr/share/elasticsearch/data']]) {
            const c=containers.find(c=>c.Config.Labels['com.docker.compose.service']===service); assert.ok(c);
            const mount=c.Mounts.find(m=>m.Destination===destination);assert.equal(mount.Type,'volume');
            assert.equal(await run(['ps','-q','--filter',`volume=${mount.Name}`]),'','Live volume writer');
            await backupContainer(root,['run','--rm','--network','none','--read-only','--entrypoint','tar','--mount',`type=volume,src=${mount.Name},dst=/snapshot,readonly`,image('mongo'),'-czf','-','-C','/snapshot','.'],path.join(backup,service+'.tar.gz'));
            await pass('offline checkpoint '+service);
        }
        await writeBackupManifest(backup,{reason:'pre-activation checkpoint',sourceProject:'ai-job-portal',mysql:mysqlBackup,source:state.sourceBefore});
        const suffix=randomBytes(3).toString('hex'), secret=()=>randomBytes(24).toString('hex');
        const settings={clone:'jobfind-activate-'+suffix,database:backendEnv.DB_NAME,cloneRootPassword:secret(),mysqlRoles:{},pgRoles:{}};
        for(const role of ['backend','gateway','core','application','notification','admin']) settings.mysqlRoles[role]={user:'jf_'+role+'_'+suffix,password:secret()};
        for(const role of ['application','admin']) settings.pgRoles[role]={user:'jf_'+role+'_'+suffix,password:secret()};
        await writeJson(configPath,settings); await writeFile(path.join(directory,'metrics-token'),secret(),{mode:0o600});
        let nginx=await readFile(path.join(root,'scripts/release/nginx.conf'),'utf8');
        nginx=nginx.replace('        location /api/ {', `        location ~* ^/api/ai/(parse-resume|match-cv|cover-letter)/?$ {\n            default_type application/json;\n            return 503 '{"errCode":503,"errMessage":"AI provider is not configured"}';\n        }\n        location ~* ^/api/jobs(?:/[0-9]+(?:/repost)?)?/?$ {\n            if ($request_method !~ ^(GET|HEAD|OPTIONS)$) { return 503; }\n            set $gateway http://api-gateway:4000;\n            proxy_pass $gateway;\n            proxy_set_header Host $host;\n        }\n        location /api/ {`);
        await writeFile(path.join(directory,'nginx-gated.conf'),nginx);
        await writeJson(path.join(directory,'compose.live.json'),await makeCompose(settings,false));
        await writeJson(path.join(directory,'compose.clone-apps.json'),await makeCompose(settings,true));
        state.status='prepared'; await pass('fresh backup and service-scoped credentials prepared; no source mutations');
    }
    if (action === 'rehearse') {
        assert.ok(['prepared','failed','rehearsing'].includes(state.status));
        const settings=await jsonFile(configPath), clone=settings.clone;
        await writeJson(path.join(directory,'compose.clone-apps.json'),await makeCompose(settings,true));
        await writeJson(path.join(directory,'compose.live.json'),await makeCompose(settings,false));
        const sources=await sourceContainers();assert.deepEqual(summary(sources),state.sourceBefore);
        const container=async service=>(await run(['ps','-aq','--filter',`label=com.docker.compose.project=${clone}`,'--filter',`label=com.docker.compose.service=${service}`])).trim();
        if (!state.cloneInfrastructureRestored) {
        const volumes={};
        await run(['network','create','--internal','--label',`jobfind.activation=${clone}`,clone]);
        for(const service of ['mongo','postgres','rabbitmq','elasticsearch']) {
            const name=clone+'-'+service;volumes[service]=name;
            await run(['volume','create','--label',`jobfind.activation=${clone}`,name]);
            await run(['run','--rm','--network','none','--read-only','--entrypoint','sh','--mount',`type=volume,src=${name},dst=/target`,'--mount',`type=bind,src=${backup},dst=/backup,readonly`,image('mongo'),'-ec','test -z "$(ls -A /target)"; tar -xzf /backup/"$1" -C /target','restore',service+'.tar.gz']);
        }
        const infrastructure={name:clone,services:{},networks:{default:{external:true,name:clone}},volumes:{}};
        for(const service of ['mongo','postgres','rabbitmq','elasticsearch']) {
            const source=sources.find(c=>c.Config.Labels['com.docker.compose.service']===service);
            const destination=source.Mounts.find(m=>m.Type==='volume' && (service!=='mongo'||m.Destination==='/data/db')).Destination;
            infrastructure.volumes[service]={external:true,name:volumes[service]};
            const def={image:image(service),hostname:source.Config.Hostname,volumes:[`${service}:${destination}`],restart:'no'};
            if(service==='postgres')def.environment={POSTGRES_USER:microEnv.POSTGRES_USER,POSTGRES_PASSWORD:microEnv.POSTGRES_PASSWORD,POSTGRES_DB:'application_db'};
            if(service==='rabbitmq')def.environment={RABBITMQ_DEFAULT_USER:microEnv.RABBITMQ_USER,RABBITMQ_DEFAULT_PASS:microEnv.RABBITMQ_PASSWORD};
            if(service==='elasticsearch')def.environment={'discovery.type':'single-node','xpack.security.enabled':'false',ES_JAVA_OPTS:'-Xms512m -Xmx512m'};
            if(service==='mongo')def.command=['mongod','--setParameter','ttlMonitorEnabled=false'];
            infrastructure.services[service]=def;
        }
        infrastructure.services.redis={image:image('redis')};
        infrastructure.services.mysql={image:JSON.parse(await run(['image','inspect','mariadb:10.4.32']))[0].Id,environment:{MYSQL_ROOT_PASSWORD:settings.cloneRootPassword,MYSQL_DATABASE:settings.database},command:['--lower-case-table-names=1'],tmpfs:['/var/lib/mysql']};
        const infraFile=path.join(directory,'compose.clone-infra.json');await writeJson(infraFile,infrastructure);
        await composeRun(infraFile,['up','-d','--no-build','--pull','never']);
        const my=await container('mysql'), pg=await container('postgres'), rabbit=await container('rabbitmq');
        await wait(async()=>{await run(['exec','-e',`MYSQL_PWD=${settings.cloneRootPassword}`,my,'mysql','-uroot',settings.database,'-N','-e','SELECT 1']);return true;});
        await input(['exec','-i','-e',`MYSQL_PWD=${settings.cloneRootPassword}`,my,'mysql','-uroot',settings.database],await readFile(path.join(backup,'mysql.sql')));
        state.cloneInfrastructureRestored=true;await save();
        }
        const pg=await container('postgres'),rabbit=await container('rabbitmq');
        await wait(async()=>{await run(['exec',pg,'pg_isready','-U',microEnv.POSTGRES_USER,'-d','application_db']);return true;});
        const queues=await wait(async()=>JSON.parse(await run(['exec',rabbit,'rabbitmqctl','list_queues','--formatter','json','name','messages_ready','messages_unacknowledged','consumers'])));
        const resumed=state.checks.some(c=>c.name==='clone application-service ready');
        assert.ok(queues.every(q=>q.messages_ready===0&&q.messages_unacknowledged===0&&(resumed||q.consumers===0)),'Broker backlog requires compatibility review before starting consumers');
        await pass('restored source broker has no pending/unacked messages before consumer transition',{queues:queues.length});
        const code=`import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import mysql from'mysql2/promise';const settings=JSON.parse(await readFile('/run/deploy.json','utf8'));const db=await mysql.createConnection({host:'mysql',user:'root',password:settings.cloneRootPassword,database:settings.database});try{await (${provisionMysql.toString()})(db,settings);}finally{await db.end();}`;
        if(!state.cloneMysqlRolesReady) {await run(['run','--rm','--network',clone,'--mount',`type=bind,src=${configPath},dst=/run/deploy.json,readonly`,'-w','/app',image('microservices'),'node','--input-type=module','-e',code]);state.cloneMysqlRolesReady=true;await save();}
        if(!state.clonePgRolesReady) {await pgSetup(pg,settings);state.clonePgRolesReady=true;await save();}
        await pass('dedicated MySQL and PostgreSQL roles provisioned on clone; no global administration grants');
        const apps=path.join(directory,'compose.clone-apps.json');
        for(const name of ['application-service','notification-service','admin-service','identity-service','job-core-service','search-service','backend','api-gateway'])await startService(apps,name,clone);
        const core=await container('job-core-service');
        const compare=`import assert from'node:assert/strict';import mysql from'mysql2/promise';const db=await mysql.createConnection({host:process.env.MYSQL_HOST,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE});try{const[cols]=await db.query('SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');console.log(JSON.stringify(cols));}finally{await db.end();}`;
        const after=JSON.parse(await run(['exec',core,'node','--input-type=module','-e',compare]));
        assert.deepEqual(after,await jsonFile(path.join(directory,'mysql-schema-before.json')),'Startup changed MySQL columns');
        const gateway=await container('api-gateway');
        const evidence=JSON.parse(await run(['exec',gateway,'node','--input-type=module','-e',activationProbe]));
        await writeJson(path.join(directory,'clone-verification.json'),evidence);
        state.clone=clone;state.status='rehearsed';delete state.failure;await pass('exact packaged services start against restored data with unchanged MySQL schema');
        await pass('restored-data role, search, CV and audit checks',evidence);
    }
    if (action === 'deploy') {
        assert.equal(state.status,'rehearsed','Require successful restored-data rehearsal');
        const settings=await jsonFile(configPath);
        const sources=await sourceContainers();assert.deepEqual(summary(sources),state.sourceBefore,'Source changed since checkpoint');
        await verifyBackup(backup);
        const db=await dbConnection();
        try {
            // Confirm source application data has not changed since the checkpoint.
            const {fingerprintRows}=await import('./backup-integrity.mjs');
            for(const [table,evidence] of Object.entries(state.backupMysql.tables)) {
                const[rows]=await db.query('SELECT * FROM '+quote(table));
                assert.equal(fingerprintRows(rows).sha256,evidence.sha256,'Source data changed: '+table);
            }
            await provisionMysql(db,settings);state.liveMysqlRolesReady=true;await save();
        }finally{await db.end();}
        await pass('unchanged source data and verified checkpoint; dedicated MySQL accounts installed');
        for(const name of ['mongo','postgres','rabbitmq','redis','elasticsearch']) {
            const c=sources.find(c=>c.Config.Labels['com.docker.compose.service']===name);
            await run(['start',c.Id]);
        }
        const pg=sources.find(c=>c.Config.Labels['com.docker.compose.service']==='postgres');
        await wait(async()=>{await run(['exec',pg.Id,'pg_isready','-U',microEnv.POSTGRES_USER,'-d','application_db']);return true;});
        const rabbit=sources.find(c=>c.Config.Labels['com.docker.compose.service']==='rabbitmq');
        const queues=await wait(async()=>JSON.parse(await run(['exec',rabbit.Id,'rabbitmqctl','list_queues','--formatter','json','name','messages_ready','messages_unacknowledged','consumers'])));
        assert.ok(queues.every(q=>q.messages_ready===0&&q.messages_unacknowledged===0&&q.consumers===0));
        await pgSetup(pg.Id,settings);state.livePgRolesReady=true;await save();
        await pass('existing infrastructure started without recreate; same RabbitMQ node and volumes; PostgreSQL roles installed');
        const file=path.join(directory,'compose.live.json');
        for(const name of ['application-service','notification-service','admin-service','identity-service','job-core-service','search-service','backend','api-gateway'])await startService(file,name,'ai-job-portal');
        const current=await sourceContainers();
        for(const name of ['mongo','postgres','rabbitmq','redis','elasticsearch']) {
            const original=state.sourceBefore.find(c=>c.service===name),now=summary(current).find(c=>c.service===name);
            assert.equal(now.id,original.id);assert.deepEqual(now.volumes,original.volumes);assert.equal(now.hostname,original.hostname);
        }
        const gateway=current.find(c=>c.Config.Labels['com.docker.compose.service']==='api-gateway');
        const evidence=JSON.parse(await run(['exec',gateway.Id,'node','--input-type=module','-e',activationProbe]));
        const prior=await jsonFile(path.join(directory,'clone-verification.json'));
        assert.equal(evidence.cvRowsSha256,prior.cvRowsSha256,'Submitted CV rows changed');
        assert.ok(evidence.counts.auditLogs>=prior.counts.auditLogs,'Historical audits lost');
        await writeJson(path.join(directory,'live-verification.json'),evidence);
        await pass('live roles, search, historical application/CV bytes and audit preservation verified',evidence);
        await composeRun(file,['up','-d','--no-deps','--no-build','--pull','never','web']);
        await wait(async()=>{const r=await fetch('http://127.0.0.1:3001/release-info.json');return r.ok&&(await r.json()).variant==='rollback';});
        for(const route of ['/api/ai/match-cv','/api/jobs','/api/jobs/1/repost']) {const r=await fetch('http://127.0.0.1:3001'+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,503);}
        state.status='runtime-deployed-flags-off';state.runtimeDeployedAt=new Date().toISOString();await pass('live immutable runtime serving rollback frontend; unavailable-provider writes blocked at entrypoint');
    }
    if(action==='probe-clone') {
        const settings=await jsonFile(configPath);
        const gateway=(await run(['ps','-q','--filter',`label=com.docker.compose.project=${settings.clone}`,'--filter','label=com.docker.compose.service=api-gateway'])).trim();
        const evidence=JSON.parse(await run(['exec',gateway,'node','--input-type=module','-e',activationProbe]));
        await writeJson(path.join(directory,'clone-verification.json'),evidence);state.status='rehearsed';delete state.failure;await pass('restored-data role, search, CV and audit checks',evidence);
    }
    if(action==='reset-clone-mysql') {
        const settings=await jsonFile(configPath);assert.match(settings.clone,/^jobfind-activate-[a-f0-9]{6}$/);
        const file=path.join(directory,'compose.clone-infra.json'),config=await jsonFile(file);
        config.services.mysql.command=['--lower-case-table-names=1'];await writeJson(file,config);
        await composeRun(file,['up','-d','--no-deps','--no-build','--pull','never','mysql']);
        const my=(await run(['ps','-q','--filter',`label=com.docker.compose.project=${settings.clone}`,'--filter','label=com.docker.compose.service=mysql'])).trim();
        await wait(async()=>{await run(['exec','-e',`MYSQL_PWD=${settings.cloneRootPassword}`,my,'mysql','-uroot',settings.database,'-N','-e','SELECT 1']);return true;});
        await input(['exec','-i','-e',`MYSQL_PWD=${settings.cloneRootPassword}`,my,'mysql','-uroot',settings.database],await readFile(path.join(backup,'mysql.sql')));
        const code=`import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import mysql from'mysql2/promise';const settings=JSON.parse(await readFile('/run/deploy.json','utf8'));const db=await mysql.createConnection({host:'mysql',user:'root',password:settings.cloneRootPassword,database:settings.database});try{await (${provisionMysql.toString()})(db,settings);}finally{await db.end();}`;
        await run(['run','--rm','--network',settings.clone,'--mount',`type=bind,src=${configPath},dst=/run/deploy.json,readonly`,'-w','/app',image('microservices'),'node','--input-type=module','-e',code]);
        await pass('clone MySQL restored with Windows-compatible table name policy');
    }
    if (action === 'verify') {
        const current=await sourceContainers(),gateway=current.find(c=>c.Config.Labels['com.docker.compose.service']==='api-gateway');
        const evidence=JSON.parse(await run(['exec',gateway.Id,'node','--input-type=module','-e',activationProbe]));
        await writeJson(path.join(directory,'live-verification.json'),evidence);await pass('live verification repeated',evidence);
    }
} catch(e) { state.status='failed'; state.failure=e.message; await save(); throw e; }
