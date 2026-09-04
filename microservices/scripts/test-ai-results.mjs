import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';

// Real MySQL in a disposable container. Never uses the project's DB credentials,
// deploys a service, or calls RabbitMQ/Claude/SMTP. Requires a cached mysql:8.0 image.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const token = randomUUID();
const database = 'jobfind_ai_result_test';
let containerId;
let pool;
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS: ${name}`); };
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const req = (body = {}, id) => ({ body, params: { id: String(id) }, headers: { 'x-user-id': '5', 'x-user-role': 'ADMIN' } });

try {
    await docker('image', 'inspect', 'mysql:8.0', '--format', '{{.Id}}');
    containerId = await docker('run', '--detach', '--rm', '--pull=never',
        '--name', `jobfind-ai-results-${token.slice(0, 8)}`, '--label', `jobfind.ai-results-test=${token}`,
        '--publish', '127.0.0.1::3306', '--env', `MYSQL_ROOT_PASSWORD=${token}`,
        '--env', 'MYSQL_ROOT_HOST=%', '--env', `MYSQL_DATABASE=${database}`, 'mysql:8.0');
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const port = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}', containerId);
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
    // Override ALL fields read by the production pool before importing any source module.
    Object.assign(process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: port, MYSQL_USER: 'root', MYSQL_PASSWORD: token, MYSQL_DATABASE: database });
    const db = await import('../job-core-service/src/libs/db.js');
    pool = db.pool;
    assert.equal((await pool.query('SELECT DATABASE() AS name'))[0][0].name, database);
    const { ensureAiTaskTable } = await import('../job-core-service/src/controllers/aiController.js');
    const { ensureOutboxTable, enqueueOutboxEvent } = await import('../job-core-service/src/libs/outbox.js');
    const { ensureAiResultTables, requestJobModeration } = await import('../job-core-service/src/libs/moderationState.js');
    const { createAiResultHandler, handleAiResult } = await import('../job-core-service/src/libs/aiResultHandler.js');
    const { createJob, updateJob, deleteJob } = await import('../job-core-service/src/controllers/jobController.js');
    // Minimal legacy business fixtures; new AI tables use the actual production DDL.
    await pool.query(`CREATE TABLE detailposts (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), descriptionHTML LONGTEXT, descriptionMarkdown LONGTEXT,
        categoryJobCode VARCHAR(30), addressCode VARCHAR(30), salaryJobCode VARCHAR(30), amount INT,
        categoryJoblevelCode VARCHAR(30), categoryWorktypeCode VARCHAR(30), experienceJobCode VARCHAR(30), genderPostCode VARCHAR(30)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query(`CREATE TABLE posts (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, detailPostId INT, statusCode VARCHAR(10), userId INT,
        timeEnd VARCHAR(50), timePost VARCHAR(50), isHot BOOLEAN, createdAt DATETIME(3), updatedAt DATETIME(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await pool.query('CREATE TABLE users (id INT PRIMARY KEY, companyId INT) ENGINE=InnoDB');
    await pool.query('CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(100), thumbnail VARCHAR(100), statusCode VARCHAR(10), censorCode VARCHAR(10)) ENGINE=InnoDB');
    await pool.query("INSERT INTO companies VALUES (3, 'Company', NULL, 'S1', 'CS1')");
    await pool.query('INSERT INTO users VALUES (5, 3)');
    await ensureAiTaskTable();
    await ensureOutboxTable();
    await ensureAiResultTables();

    const state = async (id) => (await pool.query('SELECT * FROM job_moderation_state WHERE jobId = ?', [id]))[0][0];
    const post = async (id) => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const emitted = async (id) => (await pool.query("SELECT * FROM outbox_events WHERE aggregateId = ? AND eventType = 'job.moderated'", [String(id)]))[0];
    const result = (id, requestId, approved = true) => ({ jobId: id, moderationRequestId: requestId, type: 'moderate_job', ok: true, result: { approved, reason: 'test' } });
    const receive = (data, eventId = randomUUID()) => handleAiResult(data, { eventId, aggregateId: String(data.taskId || data.jobId) });
    const create = async (name = 'A') => {
        const res = response();
        await createJob(req({ name, descriptionHTML: '<p>Build services</p>', categoryJobCode: 'IT' }), res);
        assert.equal(res.statusCode, 201, JSON.stringify(res.body));
        return res.body.data.id;
    };
    const edit = async (id, name) => {
        const res = response();
        await updateJob(req({ name }, id), res);
        assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.statusCode, 'PS3');
        return (await state(id)).requestId;
    };

    await check('additive startup and job creation atomically save a matching request token and outbox event', async () => {
        const id = await create();
        const s = await state(id);
        const [[event]] = await pool.query("SELECT * FROM outbox_events WHERE id = ? AND eventType = 'ai.moderate_job'", [s.requestId]);
        assert.equal(JSON.parse(event.payload).moderationRequestId, s.requestId);
        assert.equal((await post(id)).statusCode, 'PS3');
        await ensureAiResultTables();
        assert.deepEqual(await state(id), s);
    });

    await check('30 concurrent copies apply one moderation decision and create one outgoing notification event', async () => {
        const id = await create();
        const data = result(id, (await state(id)).requestId);
        const eventId = randomUUID();
        const outcomes = await Promise.all(Array.from({ length: 30 }, () => receive(data, eventId)));
        assert.equal(outcomes.filter((item) => item.outcome === 'applied').length, 1);
        assert.equal(outcomes.filter((item) => item.outcome === 'duplicate').length, 29);
        assert.equal((await emitted(id)).length, 1);
        const before = await post(id);
        await assert.rejects(receive({ ...data, result: { approved: false } }, eventId), { code: 'AI_RESULT_ID_CONFLICT' });
        assert.deepEqual(await post(id), before);
        assert.equal((await receive({ ...data, result: { approved: false } })).outcome, 'stale');
        assert.equal((await post(id)).statusCode, 'PS1');
    });

    await check('result, request fence, inbox and outbox all roll back when the outgoing insert path fails', async () => {
        const id = await create();
        const data = result(id, (await state(id)).requestId);
        const eventId = randomUUID();
        const broken = createAiResultHandler({ enqueue: async (...args) => { await enqueueOutboxEvent(...args); throw new Error('simulated after outbox insert'); } });
        await assert.rejects(broken(data, { eventId }), /after outbox insert/);
        assert.equal((await post(id)).statusCode, 'PS3');
        assert.equal((await state(id)).state, 'pending');
        assert.equal((await emitted(id)).length, 0);
        assert.equal((await pool.query('SELECT * FROM ai_result_inbox WHERE eventId = ?', [eventId]))[0].length, 0);
        await receive(data, eventId);
        assert.equal((await emitted(id)).length, 1);
    });

    await check('lost response after a real commit is safe to replay without another status update or notification', async () => {
        const id = await create();
        const data = result(id, (await state(id)).requestId);
        const eventId = randomUUID();
        const ambiguous = createAiResultHandler({ transaction: async (work) => {
            await db.withTransaction(work);
            throw Object.assign(new Error('simulated commit reply lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
        } });
        await assert.rejects(ambiguous(data, { eventId }), /commit reply lost/);
        const before = await post(id);
        assert.equal((await receive(data, eventId)).outcome, 'duplicate');
        assert.deepEqual(await post(id), before);
        assert.equal((await emitted(id)).length, 1);
    });

    await check('A -> B -> A uses a new request token even when content returns to its original value', async () => {
        const id = await create('A');
        const first = (await state(id)).requestId;
        const second = await edit(id, 'B');
        const latest = await edit(id, 'A');
        assert.notEqual(first, latest);
        assert.equal((await receive(result(id, first))).outcome, 'stale');
        assert.equal((await receive(result(id, second))).outcome, 'stale');
        assert.equal((await post(id)).statusCode, 'PS3');
        assert.equal((await receive(result(id, latest))).outcome, 'applied');
    });

    await check('a result waiting behind an uncommitted edit reads the newly committed request and stays stale', async () => {
        const id = await create();
        const old = (await state(id)).requestId;
        const locked = deferred();
        const release = deferred();
        const editing = db.withTransaction(async (conn) => {
            const [[p]] = await conn.query('SELECT * FROM posts WHERE id = ? FOR UPDATE', [id]);
            await conn.query('UPDATE detailposts SET name = ? WHERE id = ?', ['New content', p.detailPostId]);
            await requestJobModeration(conn, { id, name: 'New content', descriptionHTML: '<p>Build services</p>' });
            locked.resolve();
            await release.promise;
        });
        await locked.promise;
        const attemptingRead = deferred();
        const waitingHandler = createAiResultHandler({ transaction: (work) => db.withTransaction((conn) => work({
            query: (sql, args) => { if (sql.startsWith('SELECT id, detailPostId')) attemptingRead.resolve(); return conn.query(sql, args); }
        })) });
        const waiting = waitingHandler(result(id, old), { eventId: randomUUID() });
        try { await attemptingRead.promise; } finally { release.resolve(); }
        await editing;
        assert.equal((await waiting).outcome, 'stale');
        assert.equal((await post(id)).statusCode, 'PS3');
        assert.equal((await emitted(id)).length, 0);
    });

    await check('an edit after an applying result returns the job to pending with a fresh request', async () => {
        const id = await create();
        const old = (await state(id)).requestId;
        const applying = deferred();
        const release = deferred();
        const holdingHandler = createAiResultHandler({ enqueue: async (...args) => {
            await enqueueOutboxEvent(...args); applying.resolve(); await release.promise;
        } });
        const receiving = holdingHandler(result(id, old), { eventId: randomUUID() });
        await applying.promise;
        const editing = edit(id, 'After approval');
        release.resolve();
        await receiving;
        const latest = await editing;
        assert.notEqual(latest, old);
        assert.equal((await post(id)).statusCode, 'PS3');
        assert.equal((await receive(result(id, old))).outcome, 'stale');
    });

    await check('deletion cancels pending moderation and blocks later results and edits', async () => {
        const id = await create();
        const old = (await state(id)).requestId;
        const res = response();
        await deleteJob(req({}, id), res);
        assert.equal(res.statusCode, 200);
        assert.equal((await state(id)).state, 'cancelled');
        assert.equal((await receive(result(id, old))).outcome, 'stale');
        assert.equal((await post(id)).statusCode, 'PS4');
        const edited = response();
        await updateJob(req({ name: 'Resurrect' }, id), edited);
        assert.equal(edited.statusCode, 409);
        assert.equal((await emitted(id)).length, 0);
    });

    await check('manual decisions and direct legacy content changes cannot be overwritten by matching-token results', async () => {
        const manual = await create();
        const manualRequest = (await state(manual)).requestId;
        await pool.query("UPDATE posts SET statusCode = 'PS1' WHERE id = ?", [manual]);
        assert.equal((await receive(result(manual, manualRequest, false))).outcome, 'stale');
        assert.equal((await post(manual)).statusCode, 'PS1');
        const legacy = await create();
        const legacyRequest = (await state(legacy)).requestId;
        await pool.query("UPDATE detailposts SET name = 'Edited outside Job Core' WHERE id = ?", [(await post(legacy)).detailPostId]);
        assert.equal((await receive(result(legacy, legacyRequest))).outcome, 'stale');
        assert.equal((await post(legacy)).statusCode, 'PS3');
        assert.equal((await emitted(legacy)).length, 0);
    });

    await check('provider failure keeps the job pending; uncorrelated or malformed approvals never change it', async () => {
        const id = await create();
        const requestId = (await state(id)).requestId;
        assert.equal((await receive({ jobId: id, moderationRequestId: requestId, type: 'moderate_job', ok: false, error: 'timeout' })).outcome, 'failed');
        assert.equal((await post(id)).statusCode, 'PS3');
        await assert.rejects(receive({ ...result(id, requestId), moderationRequestId: undefined }), { code: 'AI_RESULT_UNCORRELATED' });
        await assert.rejects(receive({ ...result(id, requestId), result: { approved: 'false' } }), { code: 'AI_RESULT_INVALID' });
        assert.equal((await emitted(id)).length, 0);
    });

    await check('different result IDs and legacy replay cannot overwrite a completed CV task; large JSON remains valid', async () => {
        const taskId = randomUUID();
        await pool.query("INSERT INTO ai_tasks (id,type,status,createdAt,updatedAt) VALUES (?,'parse_resume','pending',NOW(),NOW())", [taskId]);
        const outcomes = await Promise.all(Array.from({ length: 10 }, (_, i) => receive({ taskId, type: 'parse_resume', ok: true, result: { text: 'ắ'.repeat(65000), source: i } })));
        assert.equal(outcomes.filter((item) => item.outcome === 'applied').length, 1);
        const [[before]] = await pool.query('SELECT * FROM ai_tasks WHERE id = ?', [taskId]);
        assert.equal(JSON.parse(before.result).text.length, 65000);
        assert.equal((await handleAiResult({ taskId, type: 'parse_resume', ok: false, error: 'late failure' })).outcome, 'already_completed');
        const [[after]] = await pool.query('SELECT * FROM ai_tasks WHERE id = ?', [taskId]);
        assert.deepEqual(after, before);
    });
    console.log(`AI result integration: ${passed} checks passed; no real RabbitMQ, AI or SMTP calls.`);
} finally {
    try { await pool?.end(); }
    finally {
        if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
            const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', containerId));
            assert.equal(labels['jobfind.ai-results-test'], token, 'Refusing to remove an unowned container');
            await docker('rm', '--force', '--volumes', containerId);
            console.log('Removed only the temporary test container and its disposable data.');
        }
    }
}
