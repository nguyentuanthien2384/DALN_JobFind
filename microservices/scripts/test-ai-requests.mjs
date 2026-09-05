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
    const { MAX_AI_REQUEST_BYTES } = await import('../job-core-service/src/libs/aiTaskRequest.js');
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
    console.log(`AI request integration: ${passed} checks passed on disposable MySQL/RabbitMQ; no real AI or SMTP calls.`);
} finally {
    closePublisher?.();
    const closed = await Promise.allSettled([
        brokerConnection?.close(), pool?.end(),
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
