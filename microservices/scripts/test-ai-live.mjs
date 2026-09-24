import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import amqplib from 'amqplib';

// Explicit opt-in: up to seven paid requests, synthetic data only, no retries.
// All database and broker settings are overwritten with disposable containers.
// The HTTP boundary is a local authenticated-caller fixture, not a login test.
if (!process.argv.includes('--live')) {
    console.log('Run with --live to make up to 7 paid Claude calls using only synthetic fixtures. Requires cached mysql:8.0, mongo:7 and rabbitmq:4-management-alpine images.');
    process.exit(2);
}
const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_MODEL']) {
    if (env[name]?.trim()) process.env[name] = env[name].trim();
}
if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error('ANTHROPIC_API_KEY is not configured');
const selected = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const token = randomUUID(), label = 'jobfind.ai-live-test', database = 'jobfind_ai_live_test';
const containers = [];
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const report = { startedAt: new Date().toISOString(), syntheticOnly: true, realProvider: true,
    model: process.env.CLAUDE_MODEL || 'claude-opus-5', customGateway: Boolean(process.env.ANTHROPIC_BASE_URL),
    scope: 'local HTTP controllers -> MySQL outbox -> RabbitMQ -> production worker -> MongoDB ledger -> RabbitMQ -> MySQL result -> HTTP polling; login/Gateway excluded',
    providerCalls: 0, checks: [] };
let pool, mongo, server, closePublisher, closeBroker, closeStore;
let worker, publish, relay, collection;
const results = new Map(), deliveries = new Map();
const reportDir = new URL('../../.local/ai-live/', import.meta.url);
const reportUrl = new URL(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, reportDir);
const save = async () => { await mkdir(reportDir, { recursive: true }); await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`); };
const eventually = async (fn, timeout = 125000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await fn(); if (value) return value; await delay(250); }
    throw Object.assign(new Error('Timed out waiting for the isolated AI workflow'), { code: 'AI_LIVE_TIMEOUT' });
};
const launch = async (kind, image, port, values = []) => {
    const id = await docker('run', '--detach', '--rm', '--pull=never', '--name', `jobfind-ai-live-${kind}-${token.slice(0, 8)}`,
        '--label', `${label}=${token}`, '--publish', `127.0.0.1::${port}`, ...values.flatMap(v => ['--env', v]), image);
    assert.match(id, /^[a-f0-9]{64}$/); containers.push(id);
    return await docker('inspect', '--format', `{{(index (index .NetworkSettings.Ports "${port}/tcp") 0).HostPort}}`, id);
};
const check = async (name, fn) => {
    const started = Date.now(), calls = report.providerCalls;
    try {
        const details = await fn();
        report.checks.push({ name, passed: true, durationMs: Date.now() - started, providerCalls: report.providerCalls - calls, ...details });
        console.log(`PASS: ${name}`);
    } catch (error) {
        // Never print provider bodies, headers, credentials or candidate content.
        report.checks.push({ name, passed: false, durationMs: Date.now() - started, providerCalls: report.providerCalls - calls,
            error: error.code === 'ERR_ASSERTION' ? 'Assertion failed' : error.code || 'AI_LIVE_CHECK_FAILED',
            ...(Number.isInteger(error.status) && { httpStatus: error.status }) });
        console.log(`FAIL: ${name}`); process.exitCode = 1;
    }
    await save();
};

try {
    for (const image of ['mysql:8.0', 'mongo:7', 'rabbitmq:4-management-alpine']) await docker('image', 'inspect', image, '--format', '{{.Id}}');
    const sqlPort = await launch('mysql', 'mysql:8.0', 3306, [`MYSQL_ROOT_PASSWORD=${token}`, 'MYSQL_ROOT_HOST=%', `MYSQL_DATABASE=${database}`]);
    const mongoPort = await launch('mongo', 'mongo:7', 27017);
    const rabbitPort = await launch('rabbit', 'rabbitmq:4-management-alpine', 5672, ['RABBITMQ_DEFAULT_USER=test', `RABBITMQ_DEFAULT_PASS=${token}`]);
    const rabbitUrl = `amqp://test:${token}@127.0.0.1:${rabbitPort}`;
    Object.assign(process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: sqlPort, MYSQL_USER: 'root', MYSQL_PASSWORD: token,
        MYSQL_DATABASE: database, RABBITMQ_URL: rabbitUrl, AI_MONGO_URL: `mongodb://127.0.0.1:${mongoPort}/${database}`, AI_CONCURRENCY: '1' });
    await eventually(async () => {
        let probe;
        try { probe = await mysql.createConnection({ host: '127.0.0.1', port: Number(sqlPort), user: 'root', password: token, database, connectTimeout: 1000 }); await probe.ping(); return true; }
        catch { return false; } finally { await probe?.end(); }
    }, 90000);
    await eventually(async () => { let c; try { c = await amqplib.connect(rabbitUrl); return true; } catch { return false; } finally { await c?.close(); } }, 90000);
    mongo = new MongoClient(process.env.AI_MONGO_URL, { retryWrites: false, writeConcern: { w: 'majority', j: true } });
    await mongo.connect(); collection = mongo.db().collection('task_executions');
    ({ pool } = await import('../job-core-service/src/libs/db.js'));
    const controllers = await import('../job-core-service/src/controllers/aiController.js');
    const { ensureOutboxTable, runOutboxOnce } = await import('../job-core-service/src/libs/outbox.js'); relay = runOutboxOnce;
    const { ensureAiRequestTable } = await import('../job-core-service/src/libs/aiTaskRequest.js');
    const { ensureAiResultTables } = await import('../job-core-service/src/libs/moderationState.js');
    const { handleAiResult } = await import('../job-core-service/src/libs/aiResultHandler.js');
    const { consume, closeConnection } = await import('../shared/rabbitmq.js'); closeBroker = closeConnection;
    const publisher = await import('../shared/outboxPublisher.js'); publish = publisher.publishOutboxEvent; closePublisher = publisher.closeOutboxPublisher;
    const { startTaskConsumer, handleTask } = await import('../ai-worker/src/consumers/taskConsumer.js'); worker = handleTask;
    ({ closeTaskStore: closeStore } = await import('../ai-worker/src/libs/taskStore.js'));
    const { client } = await import('../ai-worker/src/libs/claude.js');
    // The SDK stream helper calls messages.create internally. Count/create at
    // that boundary once, otherwise each letter is incorrectly counted twice.
    const createMessage = client.beta.messages.create.bind(client.beta.messages);
    client.beta.messages.create = (...args) => {
        if (report.providerCalls >= 7) throw new Error('Live call budget exceeded');
        report.providerCalls += 1;
        return createMessage(args[0], { ...args[1], timeout: 90000, maxRetries: 0 });
    };
    await pool.query('CREATE TABLE detailposts (id INT PRIMARY KEY, name VARCHAR(255), descriptionHTML LONGTEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    await pool.query('CREATE TABLE posts (id INT PRIMARY KEY, detailPostId INT, userId INT, statusCode VARCHAR(10)) ENGINE=InnoDB');
    await pool.query('CREATE TABLE users (id INT PRIMARY KEY, companyId INT) ENGINE=InnoDB');
    await pool.query('CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(100), statusCode VARCHAR(10), censorCode VARCHAR(10)) ENGINE=InnoDB');
    await pool.query('INSERT INTO detailposts VALUES (1, ?, ?)', ['Frontend Developer', '<p>Build accessible React and TypeScript web applications. Requirements: two years of React, TypeScript, HTML, CSS, Git and automated testing. No fee or deposit.</p>']);
    await pool.query("INSERT INTO companies VALUES (3, 'Synthetic Demo Studio', 'S1', 'CS1')");
    await pool.query('INSERT INTO users VALUES (5, 3)'); await pool.query("INSERT INTO posts VALUES (1, 1, 5, 'PS1')");
    await controllers.ensureAiTaskTable(); await ensureOutboxTable(); await ensureAiRequestTable(); await ensureAiResultTables();
    const app = express(); app.use(express.json({ limit: '8mb' }));
    // Fixed test identity only, listening on loopback in an ephemeral isolated server.
    app.use((req, res, next) => { req.headers['x-user-id'] = '9'; req.headers['x-user-role'] = 'CANDIDATE'; next(); });
    app.post('/parse-resume', controllers.parseResume); app.post('/match-cv', controllers.matchCv); app.post('/cover-letter', controllers.coverLetter); app.get('/tasks/:taskId', controllers.getTask);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    await consume('ai-live.results', ['ai.result'], async (data, key, metadata) => {
        if (data.type !== 'moderate_job') await handleAiResult(data, metadata);
        results.set(data.taskId || String(data.jobId), data);
        deliveries.set(data.taskId || String(data.jobId), (deliveries.get(data.taskId || String(data.jobId)) || 0) + 1);
    });
    await startTaskConsumer();
    const submit = async (path, body) => {
        const key = randomUUID(), options = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) };
        const response = await fetch(`${base}/${path}`, options); assert.equal(response.status, 202);
        const { taskId } = await response.json();
        await relay();
        const result = await eventually(async () => {
            const polled = await fetch(`${base}/tasks/${taskId}`); assert.equal(polled.status, 200);
            const { data } = await polled.json(); return data.status !== 'pending' && data;
        });
        await eventually(async () => (await collection.findOne({ eventId: taskId }))?.state === 'published');
        const calls = report.providerCalls;
        const repeated = await fetch(`${base}/${path}`, options); assert.equal((await repeated.json()).taskId, taskId);
        const [[event]] = await pool.query('SELECT * FROM outbox_events WHERE id = ?', [taskId]);
        await worker(JSON.parse(event.payload), event.eventType, { eventId: taskId, aggregateId: taskId, payloadVersion: 1 });
        assert.equal(report.providerCalls, calls); assert.equal(deliveries.get(taskId), 1);
        assert.equal(result.status, 'done'); assert.equal(result.error, null);
        return result.result;
    };
    const cv = 'Synthetic demo candidate TRAN MINH AN. Frontend Developer. Three years developing React and TypeScript applications, HTML, CSS, Git, Jest, React Testing Library. Built accessible forms and tested responsive interfaces. English B2. No backend/cloud/AI experience claimed.';
    const cases = [
        ['parse_resume', async () => {
            const pdf = await readFile(new URL('../tests/fixtures/ai-synthetic-resume.pdf', import.meta.url));
            const data = await submit('parse-resume', { fileBase64: pdf.toString('base64'), fileName: 'ai-synthetic-resume.pdf' });
            assert.match(data.fullName, /TRAN MINH AN/i); assert.equal(data.email, 'minhan@example.test');
            assert.ok(data.skills.some(s => /React/i.test(s)));
            return { structuredCv: true, repeatedRequestCalls: 0 };
        }],
        ['match_relevant', async () => {
            const data = await submit('match-cv', { resumeText: cv, jobId: 1 });
            assert.ok(Number.isInteger(data.score) && data.score >= 65 && data.score <= 100); assert.ok(data.matchedSkills.some(s => /React/i.test(s)));
            return { score: data.score, repeatedRequestCalls: 0 };
        }],
        ['match_irrelevant', async () => {
            const data = await submit('match-cv', { resumeText: 'Synthetic candidate: pastry baker with one year of bread preparation and kitchen cleaning. No programming experience or software skills.', jobId: 1 });
            assert.ok(Number.isInteger(data.score) && data.score >= 0 && data.score <= 40); return { score: data.score, repeatedRequestCalls: 0 };
        }],
        ...['vi', 'en'].map(language => [`cover_letter_${language}`, async () => {
            const data = await submit('cover-letter', { resumeText: cv, jobId: 1, language });
            assert.equal(data.language, language); assert.equal(data.wordCount, data.letter.trim().split(/\s+/).length);
            assert.ok(data.wordCount >= 120 && data.wordCount <= 400); assert.match(data.letter, /React/i);
            assert.ok(!/\[(?:your|company|name|tên)/i.test(data.letter));
            if (language === 'vi') assert.match(data.letter, /[ăâđêôơưáàảãạéèẻẽẹ]/i);
            return { wordCount: data.wordCount, repeatedRequestCalls: 0 };
        }]),
        ...[false, true].map(scam => [`moderation_${scam ? 'scam' : 'safe'}`, async () => {
            const jobId = scam ? 22 : 21, eventId = randomUUID();
            const payload = { jobId, moderationRequestId: randomUUID(), name: scam ? 'Việc nhẹ lương 100 triệu không cần kỹ năng' : 'Lập trình viên React',
                descriptionHTML: scam ? '<p>Ứng viên phải chuyển khoản đặt cọc 5 triệu đồng và mua khóa đào tạo trước khi phỏng vấn. Tuyển thêm người để nhận hoa hồng theo tầng.</p>' : '<p>Phát triển giao diện React và TypeScript. Yêu cầu 2 năm kinh nghiệm, làm việc tại Hà Nội. Lương 20–30 triệu theo năng lực, bảo hiểm và nghỉ phép đầy đủ. Không thu phí ứng viên.</p>' };
            await publish('ai.moderate_job', payload, { messageId: eventId, aggregateId: String(jobId), producer: 'job-core-service', occurredAt: new Date().toISOString() });
            const data = await eventually(() => results.get(String(jobId)));
            assert.equal(data.ok, true); assert.equal(data.result.approved, !scam);
            if (scam) assert.ok(data.result.violations.includes('thu_phi_ung_vien'));
            await eventually(async () => (await collection.findOne({ eventId }))?.state === 'published');
            const calls = report.providerCalls; await worker(payload, 'ai.moderate_job', { eventId, aggregateId: String(jobId), payloadVersion: 1 });
            assert.equal(report.providerCalls, calls);
            return { approved: data.result.approved, riskLevel: data.result.riskLevel, repeatedRequestCalls: 0 };
        }])
    ];
    if (selected) assert.ok(selected.every(name => cases.some(([candidate]) => candidate === name)), 'Unknown --only case');
    for (const [name, run] of cases) if (!selected || selected.includes(name)) await check(name, run);
    report.status = report.checks.every(c => c.passed) ? 'passed' : 'failed';
} catch (error) {
    report.status = 'infrastructure_failed'; report.error = error.code || 'AI_LIVE_INFRASTRUCTURE_FAILED';
    process.exitCode = 1; console.log(`Live AI test stopped: ${report.error}`);
} finally {
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await closeBroker?.(); await closePublisher?.(); await closeStore?.(); await mongo?.close(); await pool?.end();
    for (const id of containers.reverse()) {
        const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', id));
        assert.equal(labels[label], token, 'Refusing to remove an unowned container');
        await docker('rm', '--force', '--volumes', id);
    }
    report.completedAt = new Date().toISOString(); report.cleanedUp = true; await save();
    console.log(`Live AI checks: ${report.checks.filter(c => c.passed).length}/${report.checks.length}; provider calls: ${report.providerCalls}; report: ${fileURLToPath(reportUrl)}`);
}
