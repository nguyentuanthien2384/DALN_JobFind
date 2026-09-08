import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import amqp from 'amqplib';
import jwt from 'jsonwebtoken';
import { publishOutboxEvent, closeOutboxPublisher } from '/app/shared/outboxPublisher.js';

assert.equal(process.env.MYSQL_HOST, 'mysql');
assert.equal(process.env.MYSQL_DATABASE, 'acceptance');
const phase = process.argv[2];
assert.ok(['seed','main','offline','recovery','broker-offline','broker-recovery'].includes(phase));
const pool = mysql.createPool({ host: 'mysql', user: 'root', password: process.env.MYSQL_PASSWORD,
    database: 'acceptance', connectTimeout: 1500, timezone: '+07:00' });
const mongo = new MongoClient('mongodb://mongo:27017', { serverSelectionTimeoutMS: 2000 });
let broker, channel;
const rows = async (sql, values = []) => (await pool.query(sql, values))[0];
const one = async (sql, values = []) => (await rows(sql, values))[0];
const eventually = async (name, fn, ms = 90000) => {
    const deadline = Date.now() + ms; let last;
    while (Date.now() < deadline) {
        try { const result = await fn(); if (result) return result; }
        catch (error) { last = error; }
        await delay(500);
    }
    throw Error(`Timeout: ${name}${last ? ': ' + last.message : ''}`);
};
const http = async (url, options = {}) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), ...options });
    const body = await response.json();
    assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(body)}`);
    return body;
};
const control = body => http('http://mock:4010/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = () => http('http://mock:4010/state');
const token = jwt.sign({}, process.env.JWT_SECRET, { subject: '7', algorithm: 'HS256', issuer: 'jobfind-auth', audience: 'jobfind-api', expiresIn: 900 });
const api = (route, method = 'GET', body, key) => http(`http://api-gateway:4000/api${route}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key && { 'idempotency-key': key }) },
    ...(body && { body: JSON.stringify(body) })
});
const body = name => ({ name, descriptionHTML: '<p>Synthetic Compose job</p>', descriptionMarkdown: 'Synthetic Compose job',
    categoryJobCode: 'IT', addressCode: 'HN', salaryJobCode: 'SAL1', amount: 1, categoryJoblevelCode: 'JL1',
    categoryWorktypeCode: 'WT1', experienceJobCode: 'EXP1', genderPostCode: 'G1', timeEnd: String(Date.now() + 86400000), isHot: 0 });
const create = async name => (await api('/jobs', 'POST', body(name), randomUUID())).data;
const countCalls = async () => (await state()).calls.length;
const status = async (id, expected) => eventually(`job ${id} -> ${expected}`, async () => (await one('SELECT statusCode FROM posts WHERE id=?', [id]))?.statusCode === expected);
const settled = async id => eventually(`moderation ${id} settled`, async () => {
    const row = await one('SELECT state FROM job_moderation_state WHERE jobId=?', [id]);
    return row && row.state !== 'pending';
});
const notifications = id => rows(`SELECT n.* FROM notifications n
    JOIN notification_inbox i ON i.notificationId=n.id
    JOIN outbox_events e ON e.id=i.eventId WHERE e.aggregateId=? ORDER BY n.id`, [String(id)]);
const searchHas = async (id, expected) => eventually(`search ${id} visible=${expected}`, async () => {
    const result = await api('/search/jobs?limit=100');
    return result.data.some(job => job.id === id) === expected;
});
const ready = async () => {
    for (const [service, port] of [['job-core-service',4002],['search-service',4003],['notification-service',4005],['admin-service',4006],['identity-service',4001],['application-service',4004],['api-gateway',4000],['ai-worker',4007]]) {
        await eventually(`${service} ready`, async () => (await fetch(`http://${service}:${port}/readyz`, { signal: AbortSignal.timeout(3000) })).ok);
    }
};
const drained = async () => eventually('outbox and live queues drained', async () => {
    if ((await one('SELECT COUNT(*) AS n FROM outbox_events WHERE publishedAt IS NULL')).n !== 0) return false;
    // Management API includes unacked messages; checkQueue alone does not.
    const queues = await http('http://rabbitmq:15672/api/queues', { headers: { authorization: 'Basic ' + Buffer.from(`acceptance:${process.env.MYSQL_PASSWORD}`).toString('base64') } });
    return queues.filter(q => !q.name.includes('.dead-letter')).every(q => (q.messages || 0) === 0);
});
const publishRow = row => publishOutboxEvent(row.eventType, JSON.parse(row.payload), { messageId: row.id,
    aggregateId: row.aggregateId, occurredAt: new Date(row.createdAt).toISOString(), producer: 'job-core-service' });
const pass = name => console.log(`PASS: ${name}`);
try {
    await eventually('MySQL startup', () => pool.query('SELECT 1'));
    if (phase === 'seed') {
        const ddl = [
            'CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(255), thumbnail VARCHAR(255), statusCode VARCHAR(10), censorCode VARCHAR(10), allowPost INT, allowHotPost INT, createdAt DATETIME, updatedAt DATETIME)',
            'CREATE TABLE users (id INT PRIMARY KEY, companyId INT, email VARCHAR(255), firstName VARCHAR(255), lastName VARCHAR(255))',
            'CREATE TABLE accounts (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, roleCode VARCHAR(32), statusCode VARCHAR(10), phonenumber VARCHAR(32))',
            'CREATE TABLE cvs (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, postId INT, isChecked TINYINT, description TEXT, createdAt DATETIME)',
            'CREATE TABLE followcompanies (id INT AUTO_INCREMENT PRIMARY KEY, companyId INT, userId INT, createdAt DATETIME, updatedAt DATETIME)',
            'CREATE TABLE detailposts (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), descriptionHTML LONGTEXT, descriptionMarkdown LONGTEXT, categoryJobCode VARCHAR(64), addressCode VARCHAR(64), salaryJobCode VARCHAR(64), amount INT, categoryJoblevelCode VARCHAR(64), categoryWorktypeCode VARCHAR(64), experienceJobCode VARCHAR(64), genderPostCode VARCHAR(64))',
            'CREATE TABLE posts (id INT AUTO_INCREMENT PRIMARY KEY, statusCode VARCHAR(10), timeEnd VARCHAR(32), timePost VARCHAR(32), userId INT, isHot TINYINT, detailPostId INT, createdAt DATETIME, updatedAt DATETIME)',
            'CREATE TABLE notifications (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, typeCode VARCHAR(32), isChecked TINYINT, content VARCHAR(500), link VARCHAR(255), createdAt DATETIME, updatedAt DATETIME)',
            'CREATE TABLE acceptance_state (name VARCHAR(32) PRIMARY KEY, data JSON)'
        ];
        for (const sql of ddl) await pool.query(sql + ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
        await pool.query("INSERT INTO companies VALUES (3,'Synthetic company',NULL,'S1','CS1',100,100,NOW(),NOW())");
        await pool.query("INSERT INTO users VALUES (7,3,'author@example.invalid','Synthetic','Author'),(8,NULL,'follower@example.invalid','Synthetic','Follower')");
        await pool.query("INSERT INTO accounts(userId,roleCode,statusCode) VALUES (7,'COMPANY','S1'),(8,'CANDIDATE','S1')");
        await pool.query('INSERT INTO followcompanies(companyId,userId) VALUES (3,8)');
        await eventually('Mongo startup', () => mongo.connect());
        await eventually('Rabbit startup', async () => { const connection = await amqp.connect(process.env.RABBITMQ_URL); await connection.close(); return true; });
        await eventually('Elasticsearch startup', async () => (await fetch('http://elasticsearch:9200/_cluster/health')).ok);
        pass('synthetic InnoDB fixture and isolated infrastructure ready');
    } else {
        await mongo.connect();
        if (phase !== 'broker-offline') {
            await eventually('broker connection', async () => { broker = await amqp.connect(process.env.RABBITMQ_URL); return true; });
            channel = await broker.createConfirmChannel();
        }
        if (!['offline','broker-offline'].includes(phase)) await ready();
        if (phase === 'main') {
            pass('eight actual service entrypoints ready');
            await control({ mode: 'hold' });
            const input = body('Compose accepted'); const key = randomUUID();
            const job = (await api('/jobs', 'POST', input, key)).data;
            await eventually('AI HTTP request held', async () => (await state()).held === 1);
            await status(job.id, 'PS3'); await searchHas(job.id, false);
            assert.equal((await notifications(job.id)).length, 0);
            const quota = (await one('SELECT allowPost FROM companies WHERE id=3')).allowPost;
            assert.equal((await api('/jobs', 'POST', input, key)).data.id, job.id);
            assert.equal((await one('SELECT allowPost FROM companies WHERE id=3')).allowPost, quota);
            assert.equal(await countCalls(), 1);
            pass('pending review stays private; HTTP replay preserves quota and AI count');
            await control({ mode: 'approve', release: 'approve' });
            await status(job.id, 'PS1'); await searchHas(job.id, true);
            await eventually('author and follower notifications', async () => (await notifications(job.id)).length === 2);
            await eventually('realtime delivered', async () => (await state()).pushes.length === 2);
            await drained();
            assert.equal(await mongo.db('ai_worker_db').collection('task_executions').countDocuments({ state: 'published' }), 1);
            const outbox = await rows('SELECT * FROM outbox_events ORDER BY createdAt,id');
            for (const event of outbox) assert.equal(await mongo.db('admin_db').collection('auditlogs').countDocuments({ eventId: event.id }), 1);
            pass('outbox -> RabbitMQ -> SDK HTTP mock -> durable result -> PS1 -> Search, Notification and audit');
            const before = { calls: await countCalls(), notices: (await rows('SELECT id FROM notifications')).length,
                inbox: (await rows('SELECT eventId FROM ai_result_inbox')).length };
            for (const event of outbox) { await publishRow(event); await publishRow(event); }
            const aiResult = await mongo.db('admin_db').collection('auditlogs').findOne({ name: 'ai.result', kind: 'event' });
            assert.ok(aiResult);
            for (let repeat = 0; repeat < 2; repeat++) await publishOutboxEvent('ai.result', aiResult.payload, {
                messageId: aiResult.eventId, aggregateId: aiResult.aggregateId,
                occurredAt: aiResult.occurredAt.toISOString(), producer: 'ai-worker'
            });
            await delay(3000); await drained();
            assert.equal(await countCalls(), before.calls);
            assert.equal((await rows('SELECT id FROM notifications')).length, before.notices);
            assert.equal((await rows('SELECT eventId FROM ai_result_inbox')).length, before.inbox);
            for (const event of outbox) assert.equal(await mongo.db('admin_db').collection('auditlogs').countDocuments({ eventId: event.id }), 1);
            pass('duplicate committed events do not repeat AI, notification or audit');

            await control({ mode: 'reject' }); const rejected = await create('Compose rejected');
            await status(rejected.id, 'PS2'); await searchHas(rejected.id, false);
            await eventually('rejection author notification', async () => (await notifications(rejected.id)).length === 1);
            assert.equal((await notifications(rejected.id))[0].userId, 7);
            pass('rejected result stays out of Search; only author notified');

            for (const mode of ['invalid','error']) {
                await control({ mode }); const calls = await countCalls(); const failed = await create(`Compose ${mode}`);
                await settled(failed.id); await status(failed.id, 'PS3'); await searchHas(failed.id, false);
                await drained(); assert.equal(await countCalls(), calls + 1);
                assert.equal((await notifications(failed.id)).length, 0);
                assert.equal((await one('SELECT state FROM job_moderation_state WHERE jobId=?', [failed.id])).state, 'failed');
                pass(`${mode}: one model call, durable failure, no automatic approval/retry`);
            }

            await control({ mode: 'hold' }); const stale = await create('Compose stale revision');
            await eventually('old revision held', async () => (await state()).held === 1);
            const oldRequest = (await one('SELECT requestId FROM job_moderation_state WHERE jobId=?', [stale.id])).requestId;
            const managed = (await api(`/jobs/${stale.id}/manage`)).data;
            await control({ mode: 'reject' });
            await api(`/jobs/${stale.id}`, 'PUT', { amount: 2, expectedRevision: managed.editRevision });
            await status(stale.id, 'PS2');
            const currentRequest = (await one('SELECT requestId FROM job_moderation_state WHERE jobId=?', [stale.id])).requestId;
            assert.notEqual(currentRequest, oldRequest);
            await control({ release: 'approve' }); await drained(); await delay(2000);
            await status(stale.id, 'PS2'); await searchHas(stale.id, false);
            assert.equal((await one('SELECT requestId FROM job_moderation_state WHERE jobId=?', [stale.id])).requestId, currentRequest);
            pass('late approval from old generation cannot overwrite newer rejection');

            await control({ mode: 'approve', realtimeFail: true });
            const retry = await create('Compose realtime retry'); await status(retry.id, 'PS1');
            await eventually('realtime retry recorded', async () => (await rows("SELECT id FROM notification_deliveries WHERE channel='realtime' AND status='pending' AND attempts>0")).length >= 2);
            const noticeIds = (await notifications(retry.id)).map(n => n.id);
            await control({ realtimeFail: false });
            await eventually('realtime recovered', async () => (await rows("SELECT id FROM notification_deliveries WHERE channel='realtime' AND status<>'sent'")).length === 0);
            assert.deepEqual((await notifications(retry.id)).map(n => n.id), noticeIds);
            pass('delivery retries after HTTP 503 without inserting duplicate notifications');

            const calls = await countCalls(); const poisonId = randomUUID();
            channel.publish('jobportal.events', 'ai.moderate_job', Buffer.from('{}'), { persistent: true, messageId: poisonId,
                type: 'ai.moderate_job', appId: 'fixture', headers: { 'x-event-version': 1, 'x-payload-version': 1,
                    'x-aggregate-id': '999', 'x-occurred-at': new Date().toISOString() } });
            await channel.waitForConfirms();
            const poison = await eventually('invalid payload in worker DLQ', async () => channel.get('ai-worker.jobs.dead-letter', { noAck: false }));
            assert.equal(poison.properties.messageId, poisonId); assert.equal(poison.content.toString(), '{}'); channel.ack(poison);
            assert.equal(await countCalls(), calls);
            pass('invalid event goes to DLQ with original identity/body and no provider call');
            await drained();
            await pool.query('INSERT INTO acceptance_state VALUES (?,?)', ['main', JSON.stringify({ calls: await countCalls() })]);
        } else if (phase === 'offline') {
            await control({ mode: 'approve' });
            const calls = await countCalls(); const job = await create('Compose offline consumers');
            await status(job.id, 'PS3');
            await eventually('durable worker backlog', async () => (await channel.checkQueue('ai-worker.jobs')).messageCount >= 1);
            assert.equal(await countCalls(), calls);
            assert.equal((await notifications(job.id)).length, 0);
            await pool.query('INSERT INTO acceptance_state VALUES (?,?)', ['offline', JSON.stringify({ id: job.id, calls })]);
            pass('HTTP commits while consumers stopped; persistent work remains queued');
        } else if (phase === 'broker-offline') {
            const calls = await countCalls(); const job = await create('Compose broker unavailable');
            await status(job.id, 'PS3');
            await eventually('unpublished outbox survives broker failure', async () => {
                const events = await rows('SELECT * FROM outbox_events WHERE aggregateId=? AND publishedAt IS NULL', [String(job.id)]);
                return events.length === 2 && events.some(event => event.attempts > 0);
            });
            assert.equal(await countCalls(), calls);
            await pool.query('INSERT INTO acceptance_state VALUES (?,?)', ['broker-offline', JSON.stringify({ id: job.id, calls })]);
            pass('broker unavailable: HTTP commit and two durable unpublished outbox events retained');
        } else {
            const stored = (await one('SELECT data FROM acceptance_state WHERE name=?', [phase === 'recovery' ? 'offline' : 'broker-offline'])).data;
            const data = typeof stored === 'string' ? JSON.parse(stored) : stored;
            await status(data.id, 'PS1'); await searchHas(data.id, true);
            await eventually('recovered notifications', async () => (await notifications(data.id)).length === 2);
            await drained(); assert.equal(await countCalls(), data.calls + 1);
            await eventually('recovered realtime deliveries complete', async () =>
                (await rows("SELECT id FROM notification_deliveries WHERE channel='realtime' AND status<>'sent'")).length === 0);
            assert.equal((await rows("SELECT * FROM notification_deliveries WHERE channel='email' AND status='sent'")).length, 0);
            pass(`${phase}: backlog processed once; Search and notifications converge; no real email sent`);
        }
    }
} finally {
    await closeOutboxPublisher(); await channel?.close(); await broker?.close(); await mongo.close(); await pool.end();
}
