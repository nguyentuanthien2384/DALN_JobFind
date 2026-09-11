import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient, BSON } from '/app/node_modules/mongodb/lib/index.js';
import amqp from '/app/node_modules/amqplib/channel_api.js';
import mysql from '/app/node_modules/mysql2/promise.js';
import pg from '/app/node_modules/pg/lib/index.js';
import { publishOutboxEvent, closeOutboxPublisher } from '/app/shared/outboxPublisher.js';
import { EXCHANGE, EVENTS, QUEUES } from '/app/shared/events.js';

const phase = process.argv[2];
assert.ok(['baseline', 'blocked', 'admin-ready', 'running', 'restart'].includes(phase));
const token = process.env.REHEARSAL_ID;
assert.match(token, /^[a-f0-9-]{36}$/);
assert.equal(process.env.MYSQL_HOST, 'mysql');
const mongo = new MongoClient('mongodb://mongo:27017', { serverSelectionTimeoutMS: 1500 });
const pool = mysql.createPool({ host: 'mysql', user: 'root', password: process.env.MYSQL_PASSWORD, database: 'rehearsal' });
const postgres = new pg.Pool({ connectionString: process.env.POSTGRES_URL });
let broker, channel;
const eventually = async (name, fn) => {
    const until = Date.now() + 90000;
    while (Date.now() < until) {
        try { if (await fn()) return; } catch { /* Dependencies may still be starting. */ }
        await delay(500);
    }
    throw Error(`Timeout: ${name}`);
};
const audit = mongo.db('admin_db').collection('auditlogs');
const ledger = mongo.db('ai_worker_db').collection('task_executions');
const saved = mongo.db(`rehearsal_${token.replaceAll('-', '')}`).collection('evidence');
const eventId = `rehearsal-${token}`;
const ready = async (services = [['admin-service', 4006], ['ai-worker', 4007]]) => {
    for (const [service, port] of services) {
        await eventually(`${service} readiness`, async () => (await fetch(`http://${service}:${port}/readyz`, { signal: AbortSignal.timeout(3000) })).ok);
    }
};
const providerCalls = async () => (await (await fetch('http://mock:4010/state')).json()).calls.length;
const drained = async () => {
    const response = await fetch('http://rabbitmq:15672/api/queues', { headers: {
        authorization: 'Basic ' + Buffer.from(`rehearsal:${process.env.MYSQL_PASSWORD}`).toString('base64')
    } });
    assert.ok(response.ok);
    const queues = await response.json();
    return queues.every(q => q.messages_ready === 0 && q.messages_unacknowledged === 0);
};
const snapshot = async (collection, query = {}) => {
    const hash = createHash('sha256'); let count = 0;
    for await (const doc of collection.find(query).sort({ _id: 1 })) {
        hash.update(BSON.EJSON.stringify(doc, { relaxed: false })); hash.update('\n'); count++;
    }
    return { count, sha256: hash.digest('hex') };
};
const publish = () => publishOutboxEvent(EVENTS.AI_MODERATE_JOB, {
    jobId: 987654321, name: 'Synthetic rehearsal job', descriptionHTML: '<p>Synthetic test only</p>', moderationRequestId: token
}, { messageId: eventId, aggregateId: '987654321', occurredAt: '2026-09-11T00:00:00Z', producer: 'job-core-service' });
const pass = message => console.log(`PASS: ${message}`);
try {
    await eventually('MongoDB', () => mongo.connect());
    await eventually('MySQL', () => pool.query('SELECT 1'));
    await eventually('PostgreSQL', () => postgres.query('SELECT 1'));
    await eventually('RabbitMQ', async () => { broker = await amqp.connect(process.env.RABBITMQ_URL); return true; });
    channel = await broker.createConfirmChannel();
    await eventually('mock HTTP', async () => (await fetch('http://mock:4010/healthz')).ok);
    if (phase === 'baseline') {
        assert.equal(await saved.countDocuments(), 0);
        const metadata = await mongo.db('admin_db').listCollections({ name: 'auditlogs' }).toArray();
        assert.equal(metadata.length, 1, 'Source audit collection missing');
        const indexes = await audit.listIndexes().toArray();
        const plain = indexes.find(i => i.key?.createdAt === 1 && Object.keys(i.key).length === 1 && i.expireAfterSeconds == null);
        if (plain) {
            // Reproduce the old failing startup command exclusively on the copy.
            await assert.rejects(audit.createIndex({ createdAt: 1 }, { expireAfterSeconds: 15552000 }), e => [85, 86].includes(e.code));
            pass('original TTL index conflict reproduced on the offline copy');
        }
        const baseline = { _id: 'baseline', audit: await snapshot(audit), ledger: await snapshot(ledger),
            indexes, collation: metadata[0].options?.collation || { locale: 'simple' },
            olderThan180Days: await audit.countDocuments({ createdAt: { $lt: new Date(Date.now() - 15552000000) } }),
            plainRetention: Boolean(plain) };
        await saved.insertOne(baseline);
        console.log('EVIDENCE: ' + JSON.stringify({ audit: baseline.audit, ledger: baseline.ledger,
            collation: baseline.collation, olderThan180Days: baseline.olderThan180Days,
            plainRetention: baseline.plainRetention, indexes }));
        await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
        await channel.assertQueue(QUEUES.AI_WORKER, { durable: true });
        await channel.bindQueue(QUEUES.AI_WORKER, EXCHANGE, EVENTS.AI_MODERATE_JOB);
        await publish();
        pass('copy inventory saved; synthetic backlog queued on separate broker');
    } else {
        const baseline = await saved.findOne({ _id: 'baseline' });
        assert.ok(baseline);
        if (phase === 'blocked') {
            const queue = await channel.checkQueue(QUEUES.AI_WORKER);
            assert.equal(queue.consumerCount, 0); assert.equal(queue.messageCount, 1);
            assert.equal(await providerCalls(), 0);
            assert.deepEqual(await snapshot(ledger), baseline.ledger);
            assert.deepEqual(await snapshot(audit), baseline.audit);
            pass('incomplete worker exits without consuming queued work, calling AI or writing a result');
        } else if (phase === 'admin-ready') {
            await ready([['admin-service', 4006]]);
            assert.deepEqual(await snapshot(audit), baseline.audit);
            const indexes = await audit.listIndexes().toArray();
            for (const index of baseline.indexes) assert.deepEqual(indexes.find(i => i.name === index.name), index);
            pass('Admin reader and audit consumer ready before Worker releases queued results');
        } else {
            await ready();
            if (phase === 'restart') await publish();
            await eventually('durable published task', async () => (await ledger.findOne({ _id: `event:${eventId}` }))?.state === 'published');
            const task = await ledger.findOne({ _id: `event:${eventId}` });
            await eventually('successful result in Admin audit', async () => {
                const result = await audit.findOne({ eventId: task.resultEventId });
                return result?.payload?.ok === true;
            });
            await eventually('all queues drained including unacknowledged messages', drained);
            assert.equal(await providerCalls(), 1);
            assert.equal(await audit.countDocuments({ eventId: task.resultEventId }), 1);
            assert.deepEqual(await snapshot(audit, { eventId: { $nin: [eventId, task.resultEventId] } }), baseline.audit);
            assert.deepEqual(await snapshot(ledger, { _id: { $ne: `event:${eventId}` } }), baseline.ledger);
            const indexes = await audit.listIndexes().toArray();
            for (const index of baseline.indexes) assert.deepEqual(indexes.find(i => i.name === index.name), index);
            if (baseline.plainRetention) assert.ok(!indexes.some(i => i.expireAfterSeconds != null), 'Retention must not be silently enabled');
            const unique = indexes.find(i => i.name === 'audit_event_id_unique');
            assert.equal(unique?.unique, true);
            assert.deepEqual(unique.partialFilterExpression, { kind: 'event', eventId: { $type: 'string' } });
            assert.equal(unique.collation?.locale || baseline.collation.locale, 'simple');
            pass(`${phase}: Admin and Worker ready; one successful mock call/result; original audit and ledger unchanged`);
            console.log('EVIDENCE: ' + JSON.stringify({ ready: ['admin-service', 'ai-worker'], providerCalls: 1,
                oldAuditPreserved: baseline.audit.count, oldLedgerPreserved: baseline.ledger.count,
                existingIndexesPreserved: true, expiryEnabledByStartup: false }));
        }
    }
} finally {
    await closeOutboxPublisher(); await channel?.close(); await broker?.close();
    await pool.end(); await postgres.end(); await mongo.close();
}
