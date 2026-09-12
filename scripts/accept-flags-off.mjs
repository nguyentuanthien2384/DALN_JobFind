import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintRows } from './backup-integrity.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), exec = promisify(execFile);
const require = createRequire(path.join(root, 'backend/package.json'));
const { chromium, expect } = createRequire(path.join(root, 'microservices/package.json'))('playwright/test');
const env = require('dotenv').parse(await readFile(path.join(root, 'backend/.env')));
const deployment = (await readFile(path.join(root, '.local/deployments/LATEST'), 'utf8')).trim();
assert.match(deployment, /^activation-[0-9TZ-]+$/);
const directory = path.join(root, '.local/deployments', deployment);
const runId = randomUUID(), output = path.join(directory, 'flags-off-' + runId);
await mkdir(output);
const report = { runId, startedAt: new Date().toISOString(), status: 'running', checks: [], cleaned: false };
const save = () => writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const pass = async name => { report.checks.push(name); await save(); console.log('PASS ' + name); };
const docker = async args => {
    try { return (await exec('docker', args, { cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
    catch (e) { const kind = String(e.stderr || '').match(/(?:SyntaxError|TypeError|ReferenceError|Error):[^\r\n]*/)?.[0]?.split(':')[0] || 'process'; throw Error('Docker acceptance operation failed (' + kind + '); private diagnostics withheld'); }
};
const ids = (await docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=ai-job-portal'])).split(/\s+/).filter(Boolean);
const containers = JSON.parse(await docker(['inspect', ...ids]));
const container = service => { const c = containers.filter(c => c.Config.Labels['com.docker.compose.service'] === service); assert.equal(c.length, 1); assert.ok(c[0].State.Running); return c[0].Id; };
const inside = async (service, code) => JSON.parse(await docker(['exec', container(service), 'node', '--input-type=module', '-e', code]));
const origin = 'http://127.0.0.1:3001';
const http = async (route, { token, body, headers = {}, method = body ? 'POST' : 'GET' } = {}) => {
    const r = await fetch(origin + route, { method, headers: { ...(token && { authorization: 'Bearer ' + token }), ...(body && { 'content-type': 'application/json' }), ...headers },
        ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
    return { status: r.status, body: await r.json() };
};
const wait = async fn => {
    const end = Date.now() + 45000;
    do { if (await fn()) return; await new Promise(r => setTimeout(r, 500)); } while (Date.now() < end);
    throw Error('Acceptance confirmation timeout');
};
const db = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true });
const sqlSnapshot = async () => {
    const [tables] = await db.query('SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\' ORDER BY TABLE_NAME');
    const result = {};
    for (const { name } of tables) { const [rows] = await db.query('SELECT * FROM `' + name.replace(/`/g, '``') + '`'); result[name] = fingerprintRows(rows); }
    return result;
};
const pgSnapshot = () => inside('application-service', `import pg from'pg';import{createHash}from'node:crypto';const db=new pg.Client(process.env.POSTGRES_URL);await db.connect();try{const out={};for(const t of ['applications','application_events','application_notes','talent_pool','outbox_events']){const{rows}=await db.query('SELECT * FROM '+t);out[t]={count:rows.length,sha256:createHash('sha256').update(rows.map(r=>JSON.stringify(r)).sort().join(String.fromCharCode(10))).digest('hex')};}console.log(JSON.stringify(out));}finally{await db.end();}`);
const mongoSnapshot = () => inside('api-gateway', `import{MongoClient}from'mongodb';import{createHash}from'node:crypto';const m=new MongoClient('mongodb://mongo:27017');await m.connect();try{const out={};for(const n of ['admin_db','identity_db'])for(const c of await m.db(n).listCollections().toArray()){const rows=await m.db(n).collection(c.name).find().sort({_id:1}).toArray();out[n+'.'+c.name]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};}console.log(JSON.stringify(out));}finally{await m.close();}`);
const queueState = async () => JSON.parse(await docker(['exec', container('rabbitmq'), 'rabbitmqctl', 'list_queues', '--formatter', 'json', 'name', 'messages_ready', 'messages_unacknowledged', 'consumers']));
const auditCount = () => inside('api-gateway', `import{MongoClient}from'mongodb';const m=new MongoClient('mongodb://mongo:27017');await m.connect();try{console.log(JSON.stringify(await m.db('admin_db').collection('auditlogs').countDocuments({eventId:${JSON.stringify(runId)}})));}finally{await m.close();}`);
let userId, accountId, browser, eventCreated = false, before;
try {
    const flags = await (await fetch(origin + '/release-info.json')).json();
    assert.equal(flags.variant, 'rollback'); assert.ok(Object.entries(flags.flags).every(([k, v]) => v === (k.endsWith('_MODE') ? 'legacy' : 'false')));
    report.frontend = flags; await pass('all eight feature flags off before acceptance');
    const mysqlBefore = await sqlSnapshot(); console.log('Snapshot MySQL completed');
    const postgresBefore = await pgSnapshot(); console.log('Snapshot PostgreSQL completed');
    before = { mysql: mysqlBefore, postgres: postgresBefore, mongo: await mongoSnapshot() };
    await writeFile(path.join(output, 'before-fingerprints.json'), JSON.stringify(before, null, 2) + '\n');
    assert.ok((await queueState()).every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0));
    // Only this new fixture is changed. Never reset passwords or lock existing users.
    const phone = '000' + String(randomBytes(4).readUInt32BE() % 10000000).padStart(7, '0');
    const password = randomBytes(24).toString('hex');
    const [[existing]] = await db.query('SELECT COUNT(*) n FROM accounts WHERE phonenumber=?', [phone]); assert.equal(Number(existing.n), 0);
    await db.beginTransaction();
    try {
        const [u] = await db.query('INSERT INTO users(firstName,lastName,email) VALUES(?,?,?)', ['Deployment acceptance', runId, runId + '@example.invalid']); userId = u.insertId;
        const [a] = await db.query('INSERT INTO accounts(phonenumber,password,roleCode,statusCode,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,NOW(),NOW())',
            [phone, require('bcryptjs').hashSync(password, 10), 'CANDIDATE', 'S1', userId]); accountId = a.insertId;
        await db.commit();
    } catch (e) { await db.rollback(); throw e; }
    await writeFile(path.join(output, 'owned-fixture.json'), JSON.stringify({ runId, userId, accountId, eventId: runId }) + '\n');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(); let errors = 0;
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.on('pageerror', () => errors++);
    await page.goto(origin + '/login');
    await page.getByPlaceholder('Số điện thoại', { exact: true }).fill(phone);
    await page.getByPlaceholder('Mật khẩu', { exact: true }).fill(password);
    const loginResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/login' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    assert.equal((await loginResponse).status(), 200);
    await page.waitForURL(origin + '/');
    await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('token_user')))).toBe(true);
    const login = await page.evaluate(() => ({ user: JSON.parse(localStorage.getItem('userData')), token: localStorage.getItem('token_user') }));
    assert.equal(Number(login.user.id), userId); assert.ok(login.token);
    const token = login.token;
    assert.equal((await http('/api/auth/me', { token })).body.data.roleCode, 'CANDIDATE');
    const history = page.waitForResponse(r => new URL(r.url()).pathname === '/api/get-all-cv-by-userId');
    await page.goto(origin + '/candidate/cv-post'); assert.equal((await (await history).json()).errCode, 0);
    await expect(page.getByRole('heading', { name: 'Danh sách Công Việc Đã Nộp' })).toBeVisible();
    assert.equal(await page.getByRole('columnheader', { name: 'Tiến trình tuyển dụng', exact: true }).count(), 0);
    assert.equal(errors, 0); await context.close();
    await pass('real password login through browser, session persistence and legacy history with flags off');
    const bad = await http('/api/login', { body: { phonenumber: phone, password: password + '-wrong' } }); assert.notEqual(bad.body.errCode, 0); assert.ok(!bad.body.token);
    for (const route of ['/api/jobs/manage', '/api/admin/reports/overview']) assert.equal((await http(route, { token })).status, 403);
    assert.equal((await http('/api/profile', { headers: { 'x-user-id': String(userId), 'x-user-role': 'ADMIN' } })).status, 401);
    const policy = { issuer: 'jobfind-auth', audience: 'jobfind-api', algorithm: 'HS256' };
    const expired = require('jsonwebtoken').sign({ sub: String(userId) }, env.JWT_SECRET, { ...policy, expiresIn: -5 });
    assert.equal((await http('/api/profile', { token: expired })).status, 401);
    const tampered = token.slice(0, token.lastIndexOf('.') + 1) + 'invalid'; assert.equal((await http('/api/profile', { token: tampered })).status, 401);
    await db.query("UPDATE accounts SET statusCode='S2' WHERE id=? AND userId=?", [accountId, userId]);
    assert.equal((await http('/api/profile', { token })).status, 403);
    const locked = await http('/api/login', { body: { phonenumber: phone, password } }); assert.notEqual(locked.body.errCode, 0); assert.ok(!locked.body.token);
    await db.query("UPDATE accounts SET statusCode='S1' WHERE id=? AND userId=?", [accountId, userId]);
    assert.equal((await http('/api/profile', { token })).status, 200);
    // A token with an elevated stale claim must still resolve to the DB role.
    const forgedRole = require('jsonwebtoken').sign({ sub: String(userId), roleCode: 'ADMIN' }, env.JWT_SECRET, { ...policy, expiresIn: 120 });
    assert.equal((await http('/api/admin/reports/overview', { token: forgedRole })).status, 403);
    await pass('wrong password, locked account, revoked access, expired/tampered JWT and spoofed role denied');
    const [admins] = await db.query("SELECT userId FROM accounts WHERE roleCode='ADMIN' AND statusCode='S1' ORDER BY userId LIMIT 1"); assert.ok(admins.length);
    const adminToken = require('jsonwebtoken').sign({ sub: String(admins[0].userId) }, env.JWT_SECRET, { ...policy, expiresIn: 120 });
    const admin = await http('/api/admin/reports/overview', { token: adminToken }); assert.equal(admin.status, 200); assert.equal(admin.body.errCode, 0);
    await pass('existing administrator can read real aggregate reports');
    // Re-deliver an existing application's event; nullable posterId prevents all notifications.
    // Consumers must keep the original application even if replay text differs.
    const [[cv]] = await db.query('SELECT cv.id cvId,cv.postId jobId,cv.userId candidateId,u.companyId FROM cvs cv JOIN posts p ON p.id=cv.postId JOIN users u ON u.id=p.userId ORDER BY cv.id LIMIT 1'); assert.ok(cv);
    const stored = await inside('application-service', `import pg from'pg';const d=new pg.Client(process.env.POSTGRES_URL);await d.connect();try{const{rows}=await d.query('SELECT COUNT(*)::int n FROM applications WHERE legacy_cv_id=$1',[${Number(cv.cvId)}]);console.log(JSON.stringify(rows[0].n));}finally{await d.end();}`); assert.equal(stored, 1);
    const payload = { ...cv, posterId: null, jobTitle: 'Deployment replay verification', candidateName: 'Synthetic replay', candidateEmail: null, candidatePhone: null, coverLetter: null, appliedAt: '2026-09-12T00:00:00.000Z' };
    await db.query('INSERT INTO outbox_events(id,aggregateType,aggregateId,eventType,payload,createdAt) VALUES(?,?,?,?,?,NOW(3))',
        [runId, 'legacy-application', String(cv.cvId), 'application.submitted', JSON.stringify(payload)]); eventCreated = true;
    const published = async () => { const [[r]] = await db.query('SELECT publishedAt FROM outbox_events WHERE id=?', [runId]); return Boolean(r?.publishedAt); };
    await wait(published); await wait(async () => await auditCount() === 1);
    await wait(async () => (await queueState()).every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0));
    assert.deepEqual(await pgSnapshot(), before.postgres);
    await db.query('UPDATE outbox_events SET publishedAt=NULL,nextAttemptAt=NULL WHERE id=? AND publishedAt IS NOT NULL AND lockToken IS NULL', [runId]);
    await wait(published); await wait(async () => (await queueState()).every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0));
    assert.equal(await auditCount(), 1); assert.deepEqual(await pgSnapshot(), before.postgres);
    const [[relay]] = await db.query('SELECT attempts FROM outbox_events WHERE id=?', [runId]); assert.ok(Number(relay.attempts) >= 2);
    report.replay = { relayAttempts: Number(relay.attempts), auditRecords: 1, applicationRowsUnchanged: true, recipient: null };
    await pass('live MySQL outbox to RabbitMQ to consumers, duplicate replay preserves PostgreSQL rows and one audit record');
    await db.query('DELETE FROM outbox_events WHERE id=? AND aggregateType=? AND publishedAt IS NOT NULL AND lockToken IS NULL', [runId, 'legacy-application']); eventCreated = false;
    for (let i = 0; i < 2; i++) {
        const sync = await inside('application-service', `const r=await fetch('http://127.0.0.1:4004/internal/sync',{method:'POST',headers:{'x-internal-secret':process.env.INTERNAL_SECRET,'content-type':'application/json'},body:'{}'});console.log(JSON.stringify({status:r.status,body:await r.json()}));`);
        assert.equal(sync.status, 200); assert.equal(sync.body.errCode, 0); assert.equal(sync.body.data.imported, 0);
    }
    assert.deepEqual(await pgSnapshot(), before.postgres);
    await pass('historical application reconciliation repeated twice without duplicate rows or stage/note changes');
    report.status = 'passed';
} catch (e) {
    report.status = 'failed'; report.failure = e instanceof assert.AssertionError ? 'Acceptance assertion failed; private details withheld' : e.message;
    console.error(report.failure); process.exitCode = 1;
} finally {
    await browser?.close();
    // Exact run-owned identifiers only; never purge queues or revert customer changes.
    try {
        if (eventCreated) {
            await wait(async () => { const [[r]] = await db.query('SELECT lockedAt FROM outbox_events WHERE id=?', [runId]); return !r?.lockedAt; });
            await db.query('DELETE FROM outbox_events WHERE id=? AND aggregateType=? AND lockToken IS NULL', [runId, 'legacy-application']);
        }
        await wait(async () => (await queueState()).every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0));
        await inside('api-gateway', `import{MongoClient}from'mongodb';const m=new MongoClient('mongodb://mongo:27017');await m.connect();try{const r=await m.db('admin_db').collection('auditlogs').deleteMany({eventId:${JSON.stringify(runId)},kind:'event',name:'application.submitted'});console.log(JSON.stringify({removed:r.deletedCount}));}finally{await m.close();}`);
        // GET /profile creates the temporary account's empty Mongo profile lazily.
        if (userId) await inside('api-gateway', `import{MongoClient}from'mongodb';const m=new MongoClient('mongodb://mongo:27017');await m.connect();try{const r=await m.db('identity_db').collection('profiles').deleteMany({legacyUserId:${Number(userId)},roleCode:'CANDIDATE',cvs:{$size:0}});console.log(JSON.stringify({removed:r.deletedCount}));}finally{await m.close();}`);
        if (accountId) await db.query('DELETE FROM accounts WHERE id=? AND userId=?', [accountId, userId]);
        if (userId) await db.query('DELETE FROM users WHERE id=? AND lastName=? AND email=?', [userId, runId, runId + '@example.invalid']);
        if (before) {
            const after = { mysql: await sqlSnapshot(), postgres: await pgSnapshot(), mongo: await mongoSnapshot() };
            await writeFile(path.join(output, 'after-fingerprints.json'), JSON.stringify(after, null, 2) + '\n');
            assert.deepEqual(after, before, 'Historical data fingerprint changed');
        }
        report.cleaned = true; await pass(before ? 'run-owned fixtures removed; all MySQL/PostgreSQL rows and historical Mongo documents unchanged' : 'run-owned fixtures removed; baseline collection did not finish');
    } catch { report.cleaned = false; report.status = 'failed'; report.cleanupFailure = 'Check owned-fixture.json; cleanup or data preservation verification failed'; process.exitCode = 1; }
    await db.end(); report.finishedAt = new Date().toISOString(); await save();
    await writeFile(path.join(directory, 'FLAGS-OFF-LATEST'), path.basename(output));
    console.log('Acceptance ' + report.status + '; fixtures cleaned=' + report.cleaned);
}
