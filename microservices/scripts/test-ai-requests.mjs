import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import mysql from 'mysql2/promise';
import amqplib from 'amqplib';

// Uses disposable MySQL/RabbitMQ only. No project credentials or real AI calls.
// Requires cached mysql:8.0 and rabbitmq:4-management-alpine images.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const token = randomUUID();
const database = 'jobfind_ai_request_test';
const label = 'jobfind.ai-requests-test';
const containers = [];
let pool;
let brokerConnection;
let closePublisher;
let httpServer;
let transportAttempts = 0;
let passed = 0;
const faultServer = createServer((socket) => { transportAttempts += 1; socket.destroy(); });
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS: ${name}`); };
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const req = (body, taskId) => ({ body, params: { taskId }, headers: { 'x-user-id': '9', 'x-user-role': 'CANDIDATE' } });
const launch = async (name, image, port, env) => {
    const id = await docker('run', '--detach', '--rm', '--pull=never',
        '--name', `jobfind-ai-requests-${name}-${token.slice(0, 8)}`, '--label', `${label}=${token}`,
        '--publish', `127.0.0.1::${port}`, ...env.flatMap((item) => ['--env', item]), image);
    assert.match(id, /^[a-f0-9]{64}$/);
    containers.push(id);
    const hostPort = await docker('inspect', '--format', `{{(index (index .NetworkSettings.Ports "${port}/tcp") 0).HostPort}}`, id);
    assert.match(hostPort, /^\d+$/);
    return hostPort;
};

try {
    await Promise.all(['mysql:8.0', 'rabbitmq:4-management-alpine'].map((image) => docker('image', 'inspect', image, '--format', '{{.Id}}')));
    await new Promise((resolve, reject) => { faultServer.once('error', reject); faultServer.listen(0, '127.0.0.1', resolve); });
    const faultUrl = `amqp://test:${token}@127.0.0.1:${faultServer.address().port}`;
    const mysqlPort = await launch('mysql', 'mysql:8.0', 3306, [`MYSQL_ROOT_PASSWORD=${token}`, 'MYSQL_ROOT_HOST=%', `MYSQL_DATABASE=${database}`]);
    for (let attempt = 0; ; attempt += 1) {
        let probe;
        try {
            probe = await mysql.createConnection({ host: '127.0.0.1', port: Number(mysqlPort), user: 'root', password: token, database, connectTimeout: 1000 });
            await probe.ping();
            break;
        } catch (error) { if (attempt === 89) throw error; await delay(500); }
        finally { await probe?.end(); }
    }
    // Override every production DB/transport setting before importing source modules.
    Object.assign(process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: mysqlPort, MYSQL_USER: 'root', MYSQL_PASSWORD: token, MYSQL_DATABASE: database, RABBITMQ_URL: faultUrl });
    ({ pool } = await import('../job-core-service/src/libs/db.js'));
    assert.equal((await pool.query('SELECT DATABASE() AS name'))[0][0].name, database);
    const { ensureAiTaskTable, parseResume, matchCv, coverLetter, getTask } = await import('../job-core-service/src/controllers/aiController.js');
    const { ensureOutboxTable, runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js');
    ({ closeOutboxPublisher: closePublisher } = await import('../shared/outboxPublisher.js'));
    const { ensureAiResultTables } = await import('../job-core-service/src/libs/moderationState.js');
    const { handleAiResult } = await import('../job-core-service/src/libs/aiResultHandler.js');
    const { MAX_AI_REQUEST_BYTES, ensureAiRequestTable } = await import('../job-core-service/src/libs/aiTaskRequest.js');
    const { EXCHANGE } = await import('../shared/events.js');
    const { readEventMessage } = await import('../shared/eventEnvelope.js');
    const { taskIdentity } = await import('../ai-worker/src/libs/taskIdentity.js');
    await pool.query('CREATE TABLE detailposts (id INT PRIMARY KEY, name VARCHAR(255), descriptionHTML LONGTEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await pool.query('CREATE TABLE posts (id INT PRIMARY KEY, detailPostId INT, userId INT, statusCode VARCHAR(10)) ENGINE=InnoDB');
    await pool.query('CREATE TABLE users (id INT PRIMARY KEY, companyId INT) ENGINE=InnoDB');
    await pool.query('CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(100), statusCode VARCHAR(10), censorCode VARCHAR(10)) ENGINE=InnoDB');
    await pool.query("INSERT INTO detailposts VALUES (1, 'Developer', '<p>Build services</p>')");
    await pool.query("INSERT INTO companies VALUES (3, 'Company', 'S1', 'CS1')");
    await pool.query('INSERT INTO users VALUES (5, 3)');
    await pool.query("INSERT INTO posts VALUES (1, 1, 5, 'PS1'), (2, 1, 5, 'PS3')");
    await ensureAiTaskTable();
    await ensureOutboxTable();
    await ensureAiResultTables();
    await ensureAiRequestTable();

    const count = async (table) => (await pool.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n;
    const event = async (id) => (await pool.query('SELECT * FROM outbox_events WHERE id = ?', [id]))[0][0];
    const task = async (id) => (await pool.query('SELECT * FROM ai_tasks WHERE id = ?', [id]))[0][0];
    const due = () => pool.query('UPDATE outbox_events SET nextAttemptAt = NULL WHERE publishedAt IS NULL');
    const submit = async (handler, body, expected = 202) => {
        const res = response();
        await handler(req(body), res);
        assert.equal(res.statusCode, expected, JSON.stringify(res.body));
        return res.body;
    };
    const cases = [
        { type: 'parse_resume', handler: parseResume, body: { fileBase64: Buffer.from('synthetic test CV').toString('base64'), fileName: 'ắ'.repeat(65000) + '.pdf' } },
        { type: 'match_cv', handler: matchCv, body: { resumeText: 'Synthetic CV', jobId: 1 } },
        { type: 'cover_letter', handler: coverLetter, body: { resumeText: 'Synthetic CV', jobId: '1', language: 'vi' } }
    ];
    const saved = new Map();
    const legacyId = randomUUID();
    await pool.query("INSERT INTO ai_tasks (id,type,status,userId,createdAt,updatedAt) VALUES (?,'parse_resume','pending',9,NOW(),NOW())", [legacyId]);

    await check('all three APIs accept and atomically save complete tasks/events while transport is unavailable', async () => {
        for (const item of cases) {
            const { taskId } = await submit(item.handler, item.body);
            const t = await task(taskId);
            const e = await event(taskId);
            assert.equal(t.type, item.type);
            assert.equal(t.status, 'pending');
            assert.equal(t.userId, 9);
            assert.equal(e.aggregateType, 'ai_task');
            assert.equal(e.aggregateId, taskId);
            assert.equal(e.eventType, `ai.${item.type}`);
            assert.equal(e.publishedAt, null);
            assert.equal(JSON.parse(e.payload).taskId, taskId);
            if (item.type === 'parse_resume') {
                assert.deepEqual(JSON.parse(t.input), { fileName: item.body.fileName });
                assert.equal(JSON.parse(e.payload).fileBase64, item.body.fileBase64);
            } else {
                assert.equal(JSON.parse(e.payload).resumeText, item.body.resumeText);
                assert.equal(JSON.parse(e.payload).jobDescription, '<p>Build services</p>');
                assert.equal(JSON.parse(t.input).resumeText, undefined);
            }
            saved.set(taskId, e);
        }
        assert.equal(transportAttempts, 0, 'HTTP must not connect to RabbitMQ');
    });

    await check('worker inputs remain the accepted snapshots after job/company data changes', async () => {
        await pool.query("UPDATE detailposts SET name = 'Changed', descriptionHTML = '<p>New content</p>' WHERE id = 1");
        await pool.query("UPDATE companies SET name = 'Changed company' WHERE id = 3");
        for (const [id, e] of saved) assert.equal((await event(id)).payload, e.payload);
    });

    await check('a real SQL failure after the outbox insert rolls back both rows for every API', async () => {
        const before = [await count('ai_tasks'), await count('outbox_events')];
        await pool.query("CREATE TRIGGER fail_ai_outbox AFTER INSERT ON outbox_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test failure after outbox insert'");
        try {
            for (const item of cases) {
                const body = await submit(item.handler, item.body, 500);
                assert.equal(body.taskId, undefined);
                assert.deepEqual([await count('ai_tasks'), await count('outbox_events')], before);
            }
        } finally { await pool.query('DROP TRIGGER fail_ai_outbox'); }
    });

    await check('a task insert failure leaves no outgoing event', async () => {
        const before = [await count('ai_tasks'), await count('outbox_events')];
        await pool.query("CREATE TRIGGER fail_ai_task BEFORE INSERT ON ai_tasks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test task insert failure'");
        try { await submit(parseResume, { fileBase64: 'test' }, 500); }
        finally { await pool.query('DROP TRIGGER fail_ai_task'); }
        assert.deepEqual([await count('ai_tasks'), await count('outbox_events')], before);
    });

    await check('invalid, oversized and non-public job requests do not leave durable work', async () => {
        const before = [await count('ai_tasks'), await count('outbox_events')];
        await submit(parseResume, { fileBase64: {} }, 400);
        await submit(parseResume, { fileBase64: 'x'.repeat(MAX_AI_REQUEST_BYTES) }, 413);
        for (const handler of [matchCv, coverLetter]) {
            await submit(handler, { resumeText: 'CV', jobId: 2 }, 404);
            await submit(handler, { resumeText: 'CV', jobId: 404 }, 404);
        }
        await pool.query("UPDATE companies SET censorCode = 'CS2' WHERE id = 3");
        try { await submit(matchCv, { resumeText: 'CV', jobId: 1 }, 404); }
        finally { await pool.query("UPDATE companies SET censorCode = 'CS1' WHERE id = 3"); }
        assert.deepEqual([await count('ai_tasks'), await count('outbox_events')], before);
    });

    await check('failed transport retains each task and schedules the same event for retry', async () => {
        assert.equal(await runOutboxOnce(), 0);
        assert.equal(transportAttempts, 3);
        for (const [id, original] of saved) {
            const e = await event(id);
            assert.equal(e.attempts, 1);
            assert.equal(e.publishedAt, null);
            assert.ok(e.nextAttemptAt);
            assert.ok(e.lastError);
            assert.equal(e.lockToken, null);
            assert.equal(e.payload, original.payload);
            assert.equal((await task(id)).status, 'pending');
        }
    });

    closePublisher();
    const rabbitPort = await launch('rabbit', 'rabbitmq:4-management-alpine', 5672, ['RABBITMQ_DEFAULT_USER=test', `RABBITMQ_DEFAULT_PASS=${token}`]);
    process.env.RABBITMQ_URL = `amqp://test:${token}@127.0.0.1:${rabbitPort}`;
    for (let attempt = 0; ; attempt += 1) {
        try {
            brokerConnection = await amqplib.connect(process.env.RABBITMQ_URL, { timeout: 1000 });
            brokerConnection.on('error', () => {});
            break;
        } catch (error) { if (attempt === 89) throw error; await delay(500); }
    }
    const channel = await brokerConnection.createChannel();
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

    await check('an unroutable real broker publish stays pending despite publisher confirm', async () => {
        await due();
        assert.equal(await runOutboxOnce(), 0);
        for (const id of saved.keys()) {
            const e = await event(id);
            assert.equal(e.publishedAt, null);
            assert.match(e.lastError, /unroutable/);
        }
    });

    const { queue } = await channel.assertQueue(`ai-request-test-${token}`, { durable: true });
    for (const item of cases) await channel.bindQueue(queue, EXCHANGE, `ai.${item.type}`);
    const take = async () => {
        const msg = await channel.get(queue, { noAck: true });
        assert.ok(msg, 'Expected a confirmed message in the test queue');
        assert.equal(msg.properties.deliveryMode, 2);
        return readEventMessage(msg);
    };
    await check('recovery publishes intact payloads with stable worker identities and marks rows after confirm', async () => {
        await due();
        assert.equal(await runOutboxOnce(), 3);
        const received = new Set();
        for (let i = 0; i < 3; i += 1) {
            const { payload, metadata } = await take();
            const original = saved.get(metadata.eventId);
            assert.ok(original);
            assert.deepEqual(payload, JSON.parse(original.payload));
            assert.equal(metadata.aggregateId, payload.taskId);
            assert.equal(metadata.occurredAt, original.createdAt.toISOString());
            assert.equal(metadata.producer, 'job-core-service');
            assert.equal(taskIdentity(payload, metadata.eventType, metadata).key, `event:${payload.taskId}`);
            assert.ok((await event(payload.taskId)).publishedAt);
            received.add(payload.taskId);
        }
        assert.equal(received.size, 3);
        assert.equal(await channel.get(queue, { noAck: true }), false);
    });

    await check('a failed DB marker after broker confirm causes an identical replay, not a new task', async () => {
        const { taskId } = await submit(parseResume, { fileBase64: 'synthetic-replay' });
        await pool.query(`CREATE TRIGGER fail_publish_marker BEFORE UPDATE ON outbox_events FOR EACH ROW
            BEGIN IF NEW.publishedAt IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test marker failure'; END IF; END`);
        try { assert.equal(await runOutboxOnce(), 0); }
        finally { await pool.query('DROP TRIGGER fail_publish_marker'); }
        const first = await take();
        assert.equal(first.payload.taskId, taskId);
        assert.equal((await event(taskId)).publishedAt, null);
        await due();
        assert.equal(await runOutboxOnce(), 1);
        const replay = await take();
        assert.deepEqual(replay, first);
        assert.equal((await task(taskId)).status, 'pending');
        assert.equal(await runOutboxOnce(), 0);
        assert.equal(await channel.get(queue, { noAck: true }), false);
    });

    await check('the returned task ID works with the result inbox/polling API; legacy pending work is not backfilled', async () => {
        const taskId = saved.keys().next().value;
        const data = { taskId, type: 'parse_resume', ok: true, result: { fullName: 'Synthetic candidate' } };
        const metadata = { eventId: randomUUID(), aggregateId: taskId };
        assert.equal((await handleAiResult(data, metadata)).outcome, 'applied');
        assert.equal((await handleAiResult(data, metadata)).outcome, 'duplicate');
        const res = response();
        await getTask(req({}, taskId), res);
        assert.equal(res.body.data.status, 'done');
        assert.deepEqual(res.body.data.result, data.result);
        assert.equal((await task(legacyId)).status, 'pending');
        assert.equal(await event(legacyId), undefined);
    });
    // Exercise the actual HTTP handlers and trusted-service guards with a local
    // server. A response can be dropped AFTER commit without mocking MySQL.
    const { default: express } = await import('express');
    const { requireTrustedGateway, requireServicePermission, PERMISSIONS } = await import('../shared/accessControl.js');
    process.env.INTERNAL_SECRET = token;
    const app = express();
    let dropAcceptedResponse = false;
    app.use(express.json({ limit: '50mb' }));
    app.use(requireTrustedGateway, requireServicePermission(PERMISSIONS.AI_CANDIDATE_USE));
    app.use((_req, res, next) => {
        const json = res.json.bind(res);
        res.json = (body) => {
            if (dropAcceptedResponse && res.statusCode === 202) {
                dropAcceptedResponse = false;
                res.destroy();
                return res;
            }
            return json(body);
        };
        next();
    });
    app.post('/ai/parse-resume', parseResume);
    app.post('/ai/match-cv', matchCv);
    app.post('/ai/cover-letter', coverLetter);
    await new Promise((resolve) => { httpServer = app.listen(0, '127.0.0.1', resolve); });
    const http = async (path, body, key, user = '9') => {
        const result = await fetch(`http://127.0.0.1:${httpServer.address().port}${path}`, {
            method: 'POST', signal: AbortSignal.timeout(10000),
            headers: { 'content-type': 'application/json', 'x-internal-secret': token,
                'x-user-id': user, 'x-user-role': 'CANDIDATE', 'Idempotency-Key': key },
            body: JSON.stringify(body)
        });
        return { status: result.status, body: await result.json() };
    };
    const totals = async () => [await count('ai_request_keys'), await count('ai_tasks'), await count('outbox_events')];
    const keyedCases = [
        ['/ai/parse-resume', { fileBase64: 'synthetic-http-cv', fileName: 'test.pdf' }],
        ['/ai/match-cv', { resumeText: 'Synthetic CV', jobId: 1 }],
        ['/ai/cover-letter', { resumeText: 'Synthetic CV', jobId: 1, language: 'en' }]
    ];
    const keyed = [];

    await check('20 concurrent HTTP copies per endpoint create exactly one key, task and outbox record', async () => {
        for (const [path, body] of keyedCases) {
            const key = randomUUID();
            const before = await totals();
            const responses = await Promise.all(Array.from({ length: 20 }, () => http(path, body, key)));
            assert.ok(responses.every((res) => res.status === 202), JSON.stringify(responses));
            assert.equal(new Set(responses.map((res) => res.body.taskId)).size, 1);
            assert.deepEqual(await totals(), before.map((n) => n + 1));
            keyed.push({ path, body, key, taskId: responses[0].body.taskId });
        }
    });

    await check('same-key replays survive edits and deletion of the source job without recreating work', async () => {
        const before = await totals();
        await pool.query("UPDATE posts SET statusCode = 'PS4' WHERE id = 1");
        await pool.query("UPDATE detailposts SET descriptionHTML = 'changed again' WHERE id = 1");
        try {
            for (const item of keyed) {
                const res = await http(item.path, { ...item.body, jobId: item.body.jobId ? '1' : undefined }, item.key);
                assert.equal(res.status, 202);
                assert.equal(res.body.taskId, item.taskId);
            }
        } finally { await pool.query("UPDATE posts SET statusCode = 'PS1' WHERE id = 1"); }
        assert.deepEqual(await totals(), before);
    });

    await check('changed inputs and endpoint changes conflict without revealing or overwriting the original task', async () => {
        const before = await totals();
        for (const item of keyed) {
            const body = item.body.fileBase64 ? { ...item.body, fileBase64: 'changed' } : { ...item.body, resumeText: 'changed' };
            const res = await http(item.path, body, item.key);
            assert.equal(res.status, 409);
            assert.equal(res.body.taskId, undefined);
        }
        assert.equal((await http('/ai/cover-letter', { resumeText: 'Synthetic CV', jobId: 1 }, keyed[1].key)).status, 409);
        assert.deepEqual(await totals(), before);
    });

    await check('a lost real HTTP response after commit is recovered with the same task ID', async () => {
        const key = randomUUID();
        const body = { fileBase64: 'synthetic-lost-response' };
        const before = await totals();
        dropAcceptedResponse = true;
        await assert.rejects(http('/ai/parse-resume', body, key), /fetch failed/);
        const [[mapping]] = await pool.query('SELECT taskId FROM ai_request_keys WHERE userId = 9 AND requestKey = ?', [key]);
        assert.ok(mapping);
        assert.ok(await task(mapping.taskId));
        assert.ok(await event(mapping.taskId));
        const res = await http('/ai/parse-resume', body, key);
        assert.equal(res.status, 202);
        assert.equal(res.body.taskId, mapping.taskId);
        assert.deepEqual(await totals(), before.map((n) => n + 1));
    });

    await check('SQL rollback releases the key together with task/outbox, so a later retry may succeed', async () => {
        const key = randomUUID();
        const body = { fileBase64: 'synthetic-rollback' };
        const before = await totals();
        await pool.query("CREATE TRIGGER fail_keyed_outbox AFTER INSERT ON outbox_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'keyed rollback test'");
        try {
            assert.equal((await http('/ai/parse-resume', body, key)).status, 500);
            assert.deepEqual(await totals(), before);
        } finally { await pool.query('DROP TRIGGER fail_keyed_outbox'); }
        assert.equal((await http('/ai/parse-resume', body, key)).status, 202);
        assert.deepEqual(await totals(), before.map((n) => n + 1));
    });

    await check('a nonexistent job does not reserve a key; a corrected retry can be accepted', async () => {
        const key = randomUUID();
        const before = await totals();
        assert.equal((await http('/ai/match-cv', { resumeText: 'CV', jobId: 404 }, key)).status, 404);
        assert.deepEqual(await totals(), before);
        assert.equal((await http('/ai/match-cv', { resumeText: 'CV', jobId: 1 }, key)).status, 202);
    });

    await check('user scoping and case-sensitive keys are enforced by real MySQL', async () => {
        const key = `Scoped-${randomUUID()}`;
        const body = { fileBase64: 'synthetic-scope' };
        const first = await http('/ai/parse-resume', body, key);
        const otherUser = await http('/ai/parse-resume', body, key, '10');
        const otherCase = await http('/ai/parse-resume', body, key.toLowerCase());
        assert.ok([first, otherUser, otherCase].every((res) => res.status === 202));
        assert.equal(new Set([first, otherUser, otherCase].map((res) => res.body.taskId)).size, 3);
        assert.equal((await http('/ai/parse-resume', body, key)).body.taskId, first.body.taskId);
    });

    await check('retries keep done/failed tasks intact and refuse to recreate a missing mapped task', async () => {
        const before = await totals();
        for (const [index, status] of ['done', 'failed'].entries()) {
            const item = keyed[index];
            await pool.query('UPDATE ai_tasks SET status = ? WHERE id = ?', [status, item.taskId]);
            const res = await http(item.path, item.body, item.key);
            assert.equal(res.body.taskId, item.taskId);
            assert.equal((await task(item.taskId)).status, status);
        }
        const missing = keyed[2];
        // Deliberate corruption in the disposable fixture; no production cleanup.
        await pool.query('DELETE FROM ai_tasks WHERE id = ?', [missing.taskId]);
        const rejected = await http(missing.path, missing.body, missing.key);
        assert.equal(rejected.status, 409);
        assert.equal(rejected.body.taskId, undefined);
        assert.deepEqual(await totals(), [before[0], before[1] - 1, before[2]]);
        await ensureAiRequestTable();
        assert.deepEqual(await totals(), [before[0], before[1] - 1, before[2]]);
    });
    console.log(`AI request integration: ${passed} checks passed on disposable MySQL/RabbitMQ and local HTTP; no real AI or SMTP calls.`);
} finally {
    closePublisher?.();
    httpServer?.closeAllConnections();
    const closed = await Promise.allSettled([
        brokerConnection?.close(), pool?.end(),
        httpServer && new Promise((resolve) => httpServer.close(resolve)),
        new Promise((resolve) => faultServer.close(resolve))
    ]);
    for (const item of closed) if (item.status === 'rejected') console.error('Test connection cleanup failed:', item.reason.message);
    const removed = await Promise.allSettled(containers.map(async (id) => {
        assert.match(id, /^[a-f0-9]{64}$/);
        const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', id));
        assert.equal(labels[label], token, 'Refusing to remove an unowned container');
        await docker('rm', '--force', '--volumes', id);
    }));
    for (const item of removed) {
        if (item.status === 'rejected') { console.error('Temporary container cleanup failed:', item.reason.message); process.exitCode = 1; }
    }
    if (removed.every((item) => item.status === 'fulfilled')) console.log('Removed only the owned temporary containers and their disposable data.');
}
