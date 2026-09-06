import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import amqplib from 'amqplib';
import { eventCatalog, eventExamples } from '../shared/contracts/eventCatalog.js';
import { assertEventPayload } from '../shared/eventContract.js';
import { createEventEnvelope, eventProperties, readEventMessage } from '../shared/eventEnvelope.js';
import { publishOutboxEvent, closeOutboxPublisher } from '../shared/outboxPublisher.js';
import { createDeliveryHandler } from '../shared/consumeDelivery.js';
import { closeTransferPublisher, DEAD_LETTER_EXCHANGE } from '../shared/messageTransfer.js';

// Disposable broker only. Never loads .env, production queues, DB, SMTP or paid AI.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const token = randomUUID();
const label = 'jobfind.event-contract-test';
const queue = 'contract-source';
const deadQueue = 'contract-dead';
let containerId;
let connection;
let checks = 0;
const check = async (title, work) => { await work(); checks += 1; console.log(`PASS: ${title}`); };
try {
    await docker('image', 'inspect', 'rabbitmq:4-management-alpine', '--format', '{{.Id}}');
    containerId = await docker('run', '--detach', '--rm', '--pull=never', '--name', `jobfind-event-contract-${token.slice(0, 8)}`,
        '--label', `${label}=${token}`, '--publish', '127.0.0.1::5672', '-e', 'RABBITMQ_DEFAULT_USER=contract', '-e', `RABBITMQ_DEFAULT_PASS=${token}`, 'rabbitmq:4-management-alpine');
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const port = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "5672/tcp") 0).HostPort}}', containerId);
    assert.match(port, /^\d+$/);
    process.env.RABBITMQ_URL = `amqp://contract:${token}@127.0.0.1:${port}`;
    for (let attempt = 0; ; attempt += 1) {
        try { connection = await amqplib.connect(process.env.RABBITMQ_URL, { timeout: 1500 }); break; }
        catch (error) { if (attempt >= 89) throw error; await delay(500); }
    }
    const channel = await connection.createConfirmChannel();
    await channel.assertExchange('jobportal.events', 'topic', { durable: true });
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.assertQueue(deadQueue, { durable: true });
    await channel.bindQueue(queue, 'jobportal.events', '#');
    await channel.bindQueue(deadQueue, DEAD_LETTER_EXCHANGE, queue);
    const get = async (name) => {
        for (let n = 0; n < 40; n += 1) {
            const msg = await channel.get(name, { noAck: false });
            if (msg) return msg;
            await delay(50);
        }
        throw new Error(`Expected message in isolated ${name}`);
    };
    const rawPublish = async (body, properties) => {
        channel.publish('jobportal.events', 'job.deleted', body, { persistent: true, contentType: 'application/json', ...properties });
        await channel.waitForConfirms();
    };
    await check(`all ${Object.keys(eventCatalog).length} payload contracts survive confirmed RabbitMQ transport with unchanged IDs and bodies`, async () => {
        for (const [key, data] of Object.entries(eventExamples)) {
            const id = randomUUID();
            const aggregateId = assertEventPayload(key, data);
            await publishOutboxEvent(key, data, { messageId: id, aggregateId, occurredAt: '2026-09-05T01:02:03.456Z', producer: eventCatalog[key].producers[0] });
            const msg = await get(queue);
            const decoded = readEventMessage(msg);
            assert.deepEqual(decoded.payload, data);
            assert.equal(decoded.metadata.eventId, id);
            assert.equal(decoded.metadata.payloadVersion, 1);
            channel.ack(msg);
        }
    });
    await check('manual job.updated preserves legacy origin and stable ID on repeated confirmed transport for all four states', async () => {
        for (const statusCode of ['PS1', 'PS2', 'PS3', 'PS4']) {
            const data = { job: { id: 7, name: 'Manual snapshot', statusCode, companyId: 3, companyStatusCode: 'S2', companyCensorCode: 'CS2' } };
            const id = randomUUID();
            for (let attempt = 0; attempt < 2; attempt += 1) {
                await publishOutboxEvent('job.updated', data, { messageId: id, aggregateId: '7', occurredAt: '2026-09-06T00:00:00.000Z', producer: 'legacy-backend' });
                const msg = await get(queue), decoded = readEventMessage(msg);
                assert.equal(msg.properties.deliveryMode, 2); assert.deepEqual(decoded.payload, data);
                assert.equal(decoded.metadata.eventId, id); assert.equal(decoded.metadata.producer, 'legacy-backend');
                assert.equal(decoded.metadata.payloadVersion, 1); assert.equal(decoded.metadata.occurredAt, '2026-09-06T00:00:00.000Z');
                channel.ack(msg);
            }
        }
    });
    const valid = createEventEnvelope({ eventId: randomUUID(), eventType: 'job.deleted', aggregateId: 7,
        occurredAt: '2026-09-05T01:02:03Z', producer: 'job-core-service', payloadVersion: 1, data: { jobId: 7 } });
    let calls = 0;
    const handler = createDeliveryHandler({ channel, queueName: queue, handler: async () => { calls += 1; }, isActive: () => true });
    await check('invalid payload and unknown version go to confirmed DLQ unchanged without business effects', async () => {
        for (const [body, version, code] of [
            [Buffer.from('{"jobId":{"private":"SENTINEL"}}'), 1, 'EVENT_PAYLOAD_INVALID'],
            [Buffer.from('{"jobId":7}'), 2, 'EVENT_PAYLOAD_VERSION_UNSUPPORTED']
        ]) {
            const properties = eventProperties(valid);
            properties.headers['x-payload-version'] = version;
            await rawPublish(body, properties);
            await handler(await get(queue));
            const dead = await get(deadQueue);
            assert.deepEqual(dead.content, body);
            assert.equal(dead.properties.messageId, valid.eventId);
            assert.equal(dead.properties.headers['x-payload-version'], version);
            assert.equal(dead.properties.headers['x-error'], code);
            assert.ok(!dead.properties.headers['x-error'].includes('SENTINEL'));
            channel.ack(dead);
        }
        assert.equal(calls, 0);
    });
    await check('unmarked old messages retain the compatibility path without minting identity', async () => {
        await rawPublish(Buffer.from('{"legacy":true}'), {});
        const msg = await get(queue);
        assert.equal(readEventMessage(msg).metadata, undefined);
        await handler(msg);
        assert.equal(calls, 1);
    });
    await check('targeted retry retains payload version, original routing and stable identity on real broker', async () => {
        const body = Buffer.from('{ "jobId": 7 }');
        await rawPublish(body, eventProperties(valid));
        let attempts = 0;
        const retryHandler = createDeliveryHandler({ channel, queueName: queue, isActive: () => true,
            retry: { delaysMs: [1000], shouldRetry: () => true }, handler: async (_, key, metadata) => {
                assert.equal(key, 'job.deleted');
                assert.equal(metadata.payloadVersion, 1);
                assert.equal(metadata.eventId, valid.eventId);
                attempts += 1;
                if (attempts === 1) throw new Error('synthetic transient failure');
            }
        });
        await retryHandler(await get(queue));
        const retry = await get(queue);
        assert.deepEqual(retry.content, body);
        assert.equal(retry.properties.headers['x-retry-count'], 1);
        await retryHandler(retry);
        assert.equal(attempts, 2);
    });
    await check('legacy saved AI result replays retain their original unmarked contract and ID', async () => {
        const data = { taskId: 'old-task', type: 'parse_resume', ok: true, result: { legacyOutput: true } };
        await publishOutboxEvent('ai.result', data, { messageId: 'old-result', aggregateId: 'old-task', occurredAt: '2026-09-05T00:00:00Z', producer: 'ai-worker', payloadVersion: null });
        const msg = await get(queue);
        assert.equal(msg.properties.headers['x-payload-version'], undefined);
        assert.equal(readEventMessage(msg).metadata.eventId, 'old-result');
        assert.deepEqual(readEventMessage(msg).payload, data);
        channel.ack(msg);
    });
    console.log(`Event contract integration: ${checks} checks passed; no production resources or paid APIs used.`);
} finally {
    closeOutboxPublisher();
    closeTransferPublisher();
    try { await connection?.close(); } catch { /* Still clean up the owned broker if the test lost its connection. */ }
    if (containerId) {
        assert.match(containerId, /^[a-f0-9]{64}$/);
        const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', containerId));
        assert.equal(labels[label], token, 'Refusing to remove an unowned container');
        await docker('rm', '--force', '--volumes', containerId);
        console.log('Removed only the owned temporary broker and its disposable data.');
    }
}
