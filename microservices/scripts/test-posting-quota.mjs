import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import express from 'express';

// Only disposable MySQL, a loopback HTTP server and synthetic data. Requires
// cached mysql:8.0 plus npm dependencies in BOTH backend and microservices.
// Never imports either app/server, starts a relay, calls AI, SMTP or PayPal.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const token = randomUUID();
const database = 'jobfind_posting_quota_test';
const label = 'jobfind.posting-quota-test';
const legacyRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
let container, pool, legacyDb, server;
let passed = 0;
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS: ${name}`); };

try {
    await docker('image', 'inspect', 'mysql:8.0', '--format', '{{.Id}}');
    container = await docker('run', '--detach', '--rm', '--pull=never', '--name', `jobfind-posting-quota-${token.slice(0, 8)}`,
        '--label', `${label}=${token}`, '--publish', '127.0.0.1::3306',
        '--env', `MYSQL_ROOT_PASSWORD=${token}`, '--env', 'MYSQL_ROOT_HOST=%', '--env', `MYSQL_DATABASE=${database}`,
        'mysql:8.0', '--lower-case-table-names=1');
    assert.match(container, /^[a-f0-9]{64}$/);
    const port = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}', container);
    assert.match(port, /^\d+$/);
    for (let attempt = 0; ; attempt += 1) {
        let probe;
        try {
            probe = await mysql.createConnection({ host: '127.0.0.1', port: Number(port), user: 'root', password: token, database, connectTimeout: 1000 });
            await probe.ping();
            break;
        } catch (error) { if (attempt === 89) throw error; await delay(500); }
        finally { await probe?.end(); }
    }
    // Override all DB/transport settings BEFORE importing either writer. This
    // script never reads project .env credentials, even on a developer machine.
    Object.assign(process.env, {
        MYSQL_HOST: '127.0.0.1', MYSQL_PORT: port, MYSQL_USER: 'root', MYSQL_PASSWORD: token, MYSQL_DATABASE: database,
        DB_HOST: '127.0.0.1', DB_PORT: port, DB_USER: 'root', DB_PASSWORD: token, DB_NAME: database,
        NODE_ENV: 'development', INTERNAL_SECRET: token, RABBITMQ_URL: 'amqp://127.0.0.1:1', DOTENV_CONFIG_QUIET: 'true'
    });
    // Legacy modules call dotenv.config() on import; prevent loading any local
    // secrets into this test process. DB/ORM/transaction code remains real.
    legacyRequire('dotenv').config = () => ({ parsed: {} });
    ({ pool } = await import('../job-core-service/src/libs/db.js'));
    assert.equal((await pool.query('SELECT DATABASE() AS name'))[0][0].name, database);
    legacyRequire('@babel/register')({
        babelrc: false, configFile: false, cache: false,
        only: [file => file.startsWith(fileURLToPath(new URL('../../backend/src/', import.meta.url)))],
        presets: [[legacyRequire.resolve('@babel/preset-env'), { targets: { node: 'current' } }]]
    });
    legacyDb = legacyRequire('./src/models/index.js');
    assert.equal((await legacyDb.sequelize.query('SELECT DATABASE() AS name'))[0][0].name, database);
    const legacy = legacyRequire('./src/services/postService.js');
    const legacyController = legacyRequire('./src/controllers/postController.js');
    const { moderateLegacyPost } = legacyRequire('./src/utils/jobModeration.js');
    const { createJob, updateJob, repostJob, getJob } = await import('../job-core-service/src/controllers/jobController.js');
    const { getManagedJob } = await import('../job-core-service/src/controllers/jobManagementController.js');
    const { ensureJobRequestTable } = await import('../job-core-service/src/libs/jobRequest.js');
    const { ensureAiTaskTable } = await import('../job-core-service/src/controllers/aiController.js');
    const { ensureOutboxTable } = await import('../job-core-service/src/libs/outbox.js');
    const { ensureAiResultTables } = await import('../job-core-service/src/libs/moderationState.js');
    const { contractRoute, createContractValidator } = await import('../shared/requestContract.js');
    const { schemas } = await import('../shared/contracts/schemas.js');
    const { responseValidationSchema } = await import('../shared/contracts/responses.js');
    const { operationById } = await import('../shared/contracts/operations.js');
    const { PERMISSIONS, requireTrustedGateway, requireServicePermission } = await import('../shared/accessControl.js');
    const validSuccess = createContractValidator().compile(responseValidationSchema(operationById.jobCreate));
    const validEdit = createContractValidator().compile(responseValidationSchema(operationById.jobUpdate));
    const validManaged = createContractValidator().compile(responseValidationSchema(operationById.jobManageGet));
    const validError = createContractValidator().compile(schemas.Error);

    await pool.query(`CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(255), thumbnail VARCHAR(255),
        statusCode VARCHAR(10), censorCode VARCHAR(10), allowPost INT, allowHotPost INT,
        createdAt DATETIME, updatedAt DATETIME) ENGINE=InnoDB`);
    await pool.query('CREATE TABLE users (id INT PRIMARY KEY, companyId INT) ENGINE=InnoDB');
    await pool.query(`CREATE TABLE followcompanies (id INT AUTO_INCREMENT PRIMARY KEY, companyId INT, userId INT,
        createdAt DATETIME, updatedAt DATETIME) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE detailposts (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255),
        descriptionHTML LONGTEXT, descriptionMarkdown LONGTEXT, categoryJobCode VARCHAR(64), addressCode VARCHAR(64),
        salaryJobCode VARCHAR(64), amount INT, categoryJoblevelCode VARCHAR(64), categoryWorktypeCode VARCHAR(64),
        experienceJobCode VARCHAR(64), genderPostCode VARCHAR(64)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE posts (id INT AUTO_INCREMENT PRIMARY KEY, statusCode VARCHAR(10), timeEnd VARCHAR(32),
        timePost VARCHAR(32), userId INT, isHot TINYINT, detailPostId INT, createdAt DATETIME, updatedAt DATETIME) ENGINE=InnoDB`);
    await pool.query("INSERT INTO companies VALUES (3,'Synthetic company',NULL,'S1','CS1',50,50,NOW(),'2026-01-01'), (4,'Other company',NULL,'S1','CS1',50,50,NOW(),'2026-01-01')");
    await pool.query('INSERT INTO users (id,companyId) VALUES ?', [Array.from({ length: 20 }, (_, i) => [7 + i, 3]).concat([[88, null], [99, 4]])]);
    await ensureAiTaskTable();
    await ensureOutboxTable();
    await ensureAiResultTables();
    await ensureJobRequestTable();

    const app = express();
    app.use(express.json(), requireTrustedGateway);
    app.use((req, res, next) => {
        // Test-only response loss AFTER controller commit, never a production hook.
        if (req.headers['x-test-drop-response'] === '1') res.json = () => res.destroy();
        next();
    });
    // Fixture-only trusted identity: test the REAL legacy controller, transaction
    // and lost HTTP response, not authentication. No Socket.IO server is started.
    app.put('/test/manual/:action', (req, res) => {
        req.user = { id: 88, companyId: null, userAccountData: { roleCode: 'ADMIN' } };
        const methods = { approve: 'handleAcceptPost', reject: 'handleAcceptPost', ban: 'handleBanPost', reopen: 'handleActivePost' };
        if (!Object.hasOwn(methods, req.params.action)) return res.status(404).end();
        return legacyController[methods[req.params.action]](req, res);
    });
    app.put('/test/legacy-edit', (req, res) => {
        req.user = { id: 7, companyId: 3, userAccountData: { roleCode: 'COMPANY' },
            userCompanyData: { id: 3, statusCode: 'S1', censorCode: 'CS1' } };
        return legacyController.handleUpdatePost(req, res);
    });
    app.post('/test/legacy-create', (req, res) => {
        req.user = { id: 7, companyId: 3, userAccountData: { roleCode: 'COMPANY' } };
        return legacyController.handleCreateNewPost(req, res);
    });
    app.post('/test/legacy-repost', (req, res) => {
        // Fixture-only role selection, behind the random internal test secret.
        // Production still obtains identity from its authentication middleware.
        const role = req.headers['x-test-actor-role'] || 'COMPANY';
        if (!['COMPANY', 'EMPLOYER', 'ADMIN'].includes(role)) return res.status(403).end();
        req.user = { id: 7, companyId: 3, userAccountData: { roleCode: role },
            userCompanyData: { id: 3, statusCode: 'S1', censorCode: 'CS1' } };
        return legacyController.handleReupPost(req, res);
    });
    contractRoute(app, 'jobCreate', requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }), createJob);
    contractRoute(app, 'jobRepost', requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }), repostJob);
    contractRoute(app, 'jobUpdate', requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }), updateJob);
    contractRoute(app, 'jobManageGet', requireServicePermission(PERMISSIONS.JOB_MANAGE, { companyRequired: true }), getManagedJob);
    contractRoute(app, 'jobGet', getJob);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const url = `http://127.0.0.1:${server.address().port}/jobs`;
    const manualHttp = async (job, action, { drop = false, ...patch } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/test/manual/${action}`, {
            method: 'PUT', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
                'x-internal-secret': token, ...(drop && { 'x-test-drop-response': '1' }) },
            body: JSON.stringify({ id: job.id, postId: job.id, userId: 99999, roleCode: 'EMPLOYER',
                expectedRevision: job.editRevision, note: 'Synthetic HTTP decision',
                statusCode: action === 'approve' ? 'PS1' : 'PS2', ...patch })
        });
        return { status: response.status, body: await response.json() };
    };
    const body = (isHot = 0) => ({ name: 'Synthetic developer', descriptionHTML: '<p>Test only</p>', descriptionMarkdown: 'Test only',
        categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', amount: 1,
        categoryJoblevelCode: 'JL1', categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1',
        timeEnd: String(Date.now() + 86400000), isHot });
    const legacyEditHttp = async (job, { drop = false, ...patch } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/test/legacy-edit`, {
            method: 'PUT', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
                'x-internal-secret': token, ...(drop && { 'x-test-drop-response': '1' }) },
            body: JSON.stringify({ ...job, id: job.id, postId: 999999, userId: 99, companyId: 4, roleCode: 'ADMIN',
                expectedRevision: job.editRevision, ...patch })
        });
        return { status: response.status, body: await response.json() };
    };
    const legacyCreateHttp = async ({ drop = false, key, ...patch } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/test/legacy-create`, {
            method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
                'x-internal-secret': token, ...(drop && { 'x-test-drop-response': '1' }) },
            body: JSON.stringify({ ...body(), id: 99999, postId: 99999, userId: 99, companyId: 4, statusCode: 'PS1', timePost: 1, ...patch }),
            ...(key !== undefined && { headers: { 'content-type': 'application/json', 'x-internal-secret': token,
                'idempotency-key': key, ...(drop && { 'x-test-drop-response': '1' }) } })
        });
        return { status: response.status, body: await response.json() };
    };
    const core = async (isHot = 0, userId = 7, headers = {}, overrides = {}) => {
        const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000), headers: {
            'content-type': 'application/json', 'x-internal-secret': token, 'x-user-id': String(userId),
            'x-user-role': 'COMPANY', 'x-company-id': '3', 'x-company-status': 'S1', 'x-company-censor': 'CS1', ...headers
        }, body: JSON.stringify({ ...body(isHot), ...overrides }) });
        const data = await response.json();
        const validate = response.status === 201 ? validSuccess : validError;
        assert.ok(validate(data), JSON.stringify(validate.errors));
        return { status: response.status, body: data, ok: data.errCode === 0, id: data.data?.id };
    };
    const oldCreate = async (isHot = 0, userId = 7) => {
        const data = await legacy.handleCreateNewPost({ ...body(isHot), userId });
        return { body: data, ok: data.errCode === 0, id: data.postId };
    };
    const managed = async (id, userId = 7, headers = {}, publicRead = false) => {
        const response = await fetch(`${url}/${id}${publicRead ? '' : '/manage'}`, { signal: AbortSignal.timeout(15000), headers: {
            'x-internal-secret': token, 'x-user-id': String(userId), 'x-user-role': 'COMPANY',
            'x-company-id': '3', 'x-company-status': 'S1', 'x-company-censor': 'CS1', ...headers
        } });
        const data = await response.json();
        const validate = response.status === 200 ? (publicRead ? validSuccess : validManaged) : validError;
        assert.ok(validate(data), JSON.stringify({ errors: validate.errors, data }));
        return { status: response.status, body: data, cacheControl: response.headers.get('cache-control') };
    };
    const repost = async (id, key, timeEnd = String(Date.now() + 86400000), userId = 7, headers = {}, overrides = {}) => {
        const response = await fetch(`${url}/${id}/repost`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: {
            'content-type': 'application/json', 'x-internal-secret': token, 'x-user-id': String(userId),
            'x-user-role': 'COMPANY', 'x-company-id': '3', 'x-company-status': 'S1', 'x-company-censor': 'CS1',
            ...(key !== undefined && { 'idempotency-key': key }), ...headers
        }, body: JSON.stringify({ timeEnd, ...overrides }) });
        const data = await response.json();
        const validate = response.status === 201 ? validSuccess : validError;
        assert.ok(validate(data), JSON.stringify(validate.errors));
        return { status: response.status, body: data, ok: data.errCode === 0, id: data.data?.id };
    };
    const edit = async (id, patch, userId = 7, headers = {}) => {
        const response = await fetch(`${url}/${id}`, { method: 'PUT', signal: AbortSignal.timeout(15000), headers: {
            'content-type': 'application/json', 'x-internal-secret': token, 'x-user-id': String(userId),
            'x-user-role': 'COMPANY', 'x-company-id': '3', 'x-company-status': 'S1', 'x-company-censor': 'CS1', ...headers
        }, body: JSON.stringify(patch) });
        const data = await response.json();
        const validate = response.status === 200 ? validEdit : validError;
        assert.ok(validate(data), JSON.stringify(validate.errors));
        return { status: response.status, body: data };
    };
    const oldReup = async (postId, userId = 7) => {
        const data = await legacy.handleReupPost({ postId, userId, timeEnd: body().timeEnd });
        return { body: data, ok: data.errCode === 0, id: data.postId };
    };
    const legacyReupHttp = async (job, { drop = false, key, actorRole = 'COMPANY', ...patch } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/test/legacy-repost`, {
            method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json',
                'x-internal-secret': token, 'x-test-actor-role': actorRole,
                ...(key !== undefined && { 'idempotency-key': key }), ...(drop && { 'x-test-drop-response': '1' }) },
            body: JSON.stringify({ postId: job.id, expectedRevision: job.editRevision, timeEnd: body().timeEnd,
                id: 99999, userId: 99, companyId: 4, roleCode: 'ADMIN', isHot: Number(job.isHot) ? 0 : 1, name: 'Ignored body', ...patch })
        });
        return { status: response.status, body: await response.json() };
    };
    const counts = async () => {
        const values = await Promise.all(['posts', 'detailposts', 'outbox_events', 'job_moderation_state'].map(async table =>
            (await pool.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n));
        return values;
    };
    const balance = async () => {
        const [[row]] = await pool.query('SELECT allowPost,allowHotPost FROM companies WHERE id = 3');
        return [row.allowPost, row.allowHotPost];
    };
    const setQuota = (normal, hot) => pool.query('UPDATE companies SET allowPost = ?, allowHotPost = ? WHERE id = 3', [normal, hot]);
    const delta = async before => (await counts()).map((n, i) => n - before[i]);
    const sourceNormal = (await oldCreate(0)).id;
    const sourceHot = (await oldCreate(1)).id;
    assert.ok(sourceNormal && sourceHot);
    // Repost fixtures model genuinely expired paid sources (2o policy).
    await pool.query("UPDATE posts SET timeEnd = '1700000000000' WHERE id IN (?, ?)", [sourceNormal, sourceHot]);

    await check('Job Core creates PS3, charges one correct slot and saves both outbox records + moderation state', async () => {
        await setQuota(3, 3);
        const before = await counts();
        for (const hot of [0, 1]) {
            const result = await core(hot);
            assert.equal(result.status, 201, JSON.stringify(result.body));
            assert.equal(result.body.data.statusCode, 'PS3');
            assert.equal(result.body.data.isHot, hot);
            const [events] = await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ?', [String(result.id)]);
            assert.deepEqual(events.map(e => e.eventType).sort(), ['ai.moderate_job', 'job.created']);
            assert.ok(events.every(e => e.publishedAt === null));
        }
        assert.deepEqual(await balance(), [2, 2]);
        assert.deepEqual(await delta(before), [2, 2, 4, 2]);
    });

    await check('legacy string flags and re-posting consume the source bucket without changing the original post', async () => {
        await setQuota(5, 5);
        const before = await counts();
        for (const hot of ['0', '1']) assert.ok((await oldCreate(hot)).ok);
        for (const source of [sourceNormal, sourceHot]) {
            const [[original]] = await pool.query('SELECT * FROM posts WHERE id = ?', [source]);
            const result = await oldReup(source);
            assert.ok(result.ok);
            assert.notEqual(result.id, source);
            const [[unchanged]] = await pool.query('SELECT * FROM posts WHERE id = ?', [source]);
            assert.deepEqual(unchanged, original);
        }
        assert.deepEqual(await balance(), [3, 3]);
        assert.deepEqual(await delta(before), [4, 2, 4, 0]);
    });

    await check('zero, negative and NULL quota reject all writers without rows or charges', async () => {
        for (const quota of [0, -1, null]) {
            await setQuota(quota, quota);
            const before = await counts();
            for (const hot of [0, 1]) {
                assert.equal((await core(hot)).status, 409);
                assert.equal((await oldCreate(hot)).ok, false);
                assert.equal((await oldReup(hot ? sourceHot : sourceNormal)).ok, false);
            }
            assert.deepEqual(await counts(), before);
            assert.deepEqual(await balance(), [quota, quota]);
        }
    });

    await check('invalid requests, candidate role, missing company and stale membership never consume quota', async () => {
        await setQuota(5, 5);
        const before = await counts();
        assert.equal((await core('0')).status, 400);
        assert.equal((await core(0, 7, {}, { userId: 99 })).status, 400);
        assert.equal((await core(0, 7, { 'x-user-role': 'CANDIDATE' })).status, 403);
        for (const id of [88, 99, 999]) assert.equal((await core(0, id)).status, 403);
        assert.equal((await core(0, 88, { 'x-user-role': 'ADMIN', 'x-company-id': '' })).status, 403);
        assert.equal((await oldCreate(0, 88)).ok, false);
        assert.equal((await oldReup(999999)).ok, false);
        assert.deepEqual(await balance(), [5, 5]);
        assert.deepEqual(await counts(), before);
    });

    await check('both writers recheck company approval/status instead of trusting stale headers', async () => {
        for (const [status, censor] of [['S2', 'CS1'], ['S1', 'CS2']]) {
            await pool.query('UPDATE companies SET statusCode = ?, censorCode = ? WHERE id = 3', [status, censor]);
            const before = await counts();
            assert.equal((await core()).status, 403);
            assert.equal((await oldCreate()).ok, false);
            assert.equal((await oldReup(sourceNormal)).ok, false);
            assert.deepEqual(await balance(), [5, 5]);
            assert.deepEqual(await counts(), before);
        }
        await pool.query("UPDATE companies SET statusCode = 'S1', censorCode = 'CS1' WHERE id = 3");
    });

    for (const table of ['companies', 'detailposts', 'posts', 'outbox_events', 'job_moderation_state']) {
        await check(`Job Core rolls back quota, post and events when ${table} fails`, async () => {
            await setQuota(5, 5);
            const before = await counts();
            await pool.query(`CREATE TRIGGER fail_posting AFTER ${table === 'companies' ? 'UPDATE' : 'INSERT'} ON ${table}
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic posting failure'`);
            try {
                for (const hot of [0, 1]) {
                    const result = await core(hot);
                    assert.equal(result.status, 500);
                    assert.equal(JSON.stringify(result.body).includes('synthetic posting failure'), false);
                    assert.deepEqual(await counts(), before);
                    assert.deepEqual(await balance(), [5, 5]);
                }
            } finally { await pool.query('DROP TRIGGER fail_posting'); }
        });
    }

    await check('real legacy insert failures roll back quota/detail; re-post failures also refund neither too much nor too little', async () => {
        for (const table of ['detailposts', 'posts']) {
            const before = await counts();
            await pool.query(`CREATE TRIGGER fail_legacy AFTER INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic legacy failure'`);
            try {
                for (const hot of [0, 1]) {
                    await assert.rejects(oldCreate(hot), /synthetic legacy failure/);
                    if (table === 'posts') await assert.rejects(oldReup(hot ? sourceHot : sourceNormal), /synthetic legacy failure/);
                }
                assert.deepEqual(await counts(), before);
                assert.deepEqual(await balance(), [5, 5]);
            } finally { await pool.query('DROP TRIGGER fail_legacy'); }
        }
    });

    for (const hot of [0, 1]) {
        await check(`20 concurrent Job Core requests from different users cannot overspend ${hot ? 'featured' : 'normal'} slots`, async () => {
            await setQuota(3, 3);
            const before = await counts();
            const results = await Promise.all(Array.from({ length: 20 }, (_, i) => core(hot, 7 + i)));
            assert.equal(results.filter(r => r.status === 201).length, 3);
            assert.equal(results.filter(r => r.status === 409).length, 17);
            assert.deepEqual(await balance(), hot ? [3, 0] : [0, 3]);
            assert.deepEqual(await delta(before), [3, 3, 6, 3]);
        });

        await check(`mixed concurrent core/create/re-post writers share a single ${hot ? 'featured' : 'normal'} balance`, async () => {
            await setQuota(4, 4);
            const before = await counts();
            const results = await Promise.all(Array.from({ length: 18 }, async (_, i) => {
                const kind = i % 3;
                const result = await (kind === 0 ? core(hot, 7 + i) : kind === 1 ? oldCreate(String(hot), 7 + i) : oldReup(hot ? sourceHot : sourceNormal, 7 + i));
                return { ...result, kind };
            }));
            const successes = results.filter(r => r.ok);
            assert.equal(successes.length, 4, JSON.stringify(results.map(r => r.body)));
            assert.ok(results.filter(r => !r.ok).every(r => r.body.errCode === 2));
            assert.deepEqual(await balance(), hot ? [4, 0] : [0, 4]);
            const coreCount = successes.filter(r => r.kind === 0).length;
            assert.deepEqual(await delta(before), [4, successes.filter(r => r.kind !== 2).length, coreCount + successes.length, coreCount]);
        });
    }

    await check('a concurrent atomic quota credit is preserved across mixed posting writers', async () => {
        await setQuota(3, 3);
        const results = await Promise.all([
            ...Array.from({ length: 18 }, (_, i) => i % 2 ? core(0, 7 + i) : oldCreate(0, 7 + i)),
            // This exercises the company lock, not the PayPal provider workflow.
            pool.query('UPDATE companies SET allowPost = allowPost + 5 WHERE id = 3').then(() => null)
        ]);
        const successes = results.filter(r => r?.ok).length;
        assert.ok(successes <= 8);
        assert.deepEqual(await balance(), [8 - successes, 3]);
    });

    const waitForRowWait = async () => {
        for (let i = 0; i < 200; i += 1) {
            const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits');
            if (row.n > 0) return;
            await delay(10);
        }
        assert.fail('Expected posting request to wait on an actual InnoDB row lock');
    };
    await check('membership changed while posting waits is reread after the lock, without charging either company', async () => {
        await setQuota(5, 5);
        const before = await counts();
        const blocker = await pool.getConnection();
        let pending;
        try {
            await blocker.beginTransaction();
            await blocker.query('UPDATE users SET companyId = 4 WHERE id = 7');
            pending = core();
            await waitForRowWait();
            await blocker.commit();
            assert.equal((await pending).status, 403);
            assert.deepEqual(await balance(), [5, 5]);
            assert.deepEqual(await counts(), before);
            assert.equal((await pool.query('SELECT allowPost FROM companies WHERE id = 4'))[0][0].allowPost, 50);
        } finally {
            await blocker.rollback(); blocker.release();
            await pending;
            await pool.query('UPDATE users SET companyId = 3 WHERE id = 7');
        }
    });

    await check('company banned while posting waits is reread after the lock, without a charge', async () => {
        const before = await counts();
        const blocker = await pool.getConnection();
        let pending;
        try {
            await blocker.beginTransaction();
            await blocker.query("UPDATE companies SET statusCode = 'S2' WHERE id = 3");
            pending = core();
            await waitForRowWait();
            await blocker.commit();
            assert.equal((await pending).status, 403);
            assert.deepEqual(await balance(), [5, 5]);
            assert.deepEqual(await counts(), before);
        } finally {
            await blocker.rollback(); blocker.release();
            await pending;
            await pool.query("UPDATE companies SET statusCode = 'S1' WHERE id = 3");
        }
    });

    await check('nontransactional legacy company table fails closed in both writers', async () => {
        const before = await counts();
        await pool.query('ALTER TABLE companies ENGINE=MyISAM');
        try {
            assert.equal((await core()).status, 503);
            assert.equal((await oldCreate()).ok, false);
            assert.equal((await oldReup(sourceNormal)).ok, false);
            assert.deepEqual(await counts(), before);
            assert.deepEqual(await balance(), [5, 5]);
        } finally { await pool.query('ALTER TABLE companies ENGINE=InnoDB'); }
    });
    const { runJobEditChecks } = await import('./job-edit-checks.mjs');
    await runJobEditChecks({ pool, check, core, edit, legacy, oldReup, counts, balance, waitForRowWait });
    const { runJobRequestChecks } = await import('./job-request-checks.mjs');
    await runJobRequestChecks({ pool, check, core, repost, edit, counts, balance, waitForRowWait });
    const { runJobManagementChecks } = await import('./job-management-checks.mjs');
    await runJobManagementChecks({ pool, check, core, managed, edit, counts, balance });
    const { runJobConcurrencyChecks } = await import('./job-concurrency-checks.mjs');
    await runJobConcurrencyChecks({ pool, check, core, managed, edit, legacy, counts, balance, waitForRowWait });
    const { runManualModerationChecks } = await import('./manual-moderation-checks.mjs');
    await runManualModerationChecks({ pool, check, core, repost, managed, edit, legacy, moderateLegacyPost, manualHttp, counts, balance, waitForRowWait });
    const { runLegacyEditOutboxChecks } = await import('./legacy-edit-outbox-checks.mjs');
    await runLegacyEditOutboxChecks({ pool, check, core, managed, legacyEditHttp, counts, balance, waitForRowWait });
    const { runLegacyCreateOutboxChecks } = await import('./legacy-create-outbox-checks.mjs');
    await runLegacyCreateOutboxChecks({ pool, check, legacyCreateHttp, counts, balance, waitForRowWait });
    const { runLegacyRepostChecks } = await import('./legacy-repost-checks.mjs');
    await runLegacyRepostChecks({ pool, check, core, managed, legacyReupHttp, edit, counts, balance, waitForRowWait });
    const { runLegacyCreateRequestChecks } = await import('./legacy-create-request-checks.mjs');
    await runLegacyCreateRequestChecks({ pool, check, core, legacyCreateHttp, counts, balance, waitForRowWait });
    const { runLegacyRepostRequestChecks } = await import('./legacy-repost-request-checks.mjs');
    await runLegacyRepostRequestChecks({ pool, check, core, managed, edit, legacyReupHttp, legacyCreateHttp, counts, balance, waitForRowWait });
    const { runRepostPolicyChecks } = await import('./repost-policy-checks.mjs');
    await runRepostPolicyChecks({ pool, check, core, managed, repost, edit, legacyReupHttp, counts, balance, waitForRowWait });
    const { runEditReviewLifecycleChecks } = await import('./edit-review-lifecycle-checks.mjs');
    await runEditReviewLifecycleChecks({ pool, check, core, managed, edit, legacyEditHttp, legacyCreateHttp,
        manualHttp, counts, balance, waitForRowWait });
    console.log(`Posting integration: ${passed} checks passed (quotas + edits + idempotent Core create/repost + private reads + concurrency + manual/AI moderation + legacy create/edit/repost outbox); disposable MySQL, actual Job Core/legacy HTTP and Sequelize writers; no external providers.`);
} finally {
    server?.closeAllConnections();
    const closed = await Promise.allSettled([
        server && new Promise(resolve => server.close(resolve)), pool?.end(), legacyDb?.sequelize.close()
    ]);
    for (const item of closed) if (item.status === 'rejected') { console.error('Test cleanup failed:', item.reason.message); process.exitCode = 1; }
    if (container) {
        assert.match(container, /^[a-f0-9]{64}$/);
        const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', container));
        assert.equal(labels[label], token, 'Refusing to remove an unowned container');
        await docker('rm', '--force', '--volumes', container);
        console.log('Removed only the owned temporary MySQL container and its disposable data.');
    }
}
