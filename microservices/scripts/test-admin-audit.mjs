import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { AuditLog, ensureAuditIndexes } from '../admin-service/src/models/AuditLog.js';
import { recordEvent, recordAction } from '../admin-service/src/controllers/auditController.js';

// Opt-in integration test. Never reads MONGO_URL or connects to the project's DB.
// Requires an already installed mongo:7 image; does not download images or deploy services.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const token = randomUUID();
const name = `jobfind-audit-test-${token.slice(0, 8)}`;
let containerId;
let passed = 0;
const check = async (name, fn) => {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
};

try {
    await docker('image', 'inspect', 'mongo:7', '--format', '{{.Id}}');
    containerId = await docker('run', '--detach', '--rm', '--pull=never', '--name', name,
        '--label', `jobfind.audit-test=${token}`, '--publish', '127.0.0.1::27017',
        'mongo:7', '--bind_ip_all', '--setParameter', 'ttlMonitorSleepSecs=3600');
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const port = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "27017/tcp") 0).HostPort}}', containerId);
    assert.match(port, /^\d+$/);
    const uri = `mongodb://127.0.0.1:${port}/jobfind_audit_integration`;
    let connected = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
        try {
            await mongoose.connect(uri, { serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500, autoIndex: false });
            connected = true;
            break;
        } catch (error) {
            if (attempt === 14) throw error;
            await delay(500);
        }
    }
    assert.equal(connected, true);
    assert.equal(mongoose.connection.name, 'jobfind_audit_integration');
    await AuditLog.init();
    const oldRecords = [
        { kind: 'event', name: 'legacy.one', createdAt: new Date() },
        { kind: 'event', name: 'legacy.two', createdAt: new Date() },
        { kind: 'action', name: 'POST /legacy', eventId: 'event-1', createdAt: new Date() },
        { kind: 'action', name: 'POST /legacy', eventId: 'event-1', createdAt: new Date() }
    ];
    await AuditLog.collection.insertMany(oldRecords);
    await AuditLog.collection.createIndex({ actorRole: 1 }, { name: 'existing_custom_index' });
    await check('additive index startup preserves existing logs and custom indexes', async () => {
        await ensureAuditIndexes();
        await ensureAuditIndexes();
        assert.equal(await AuditLog.countDocuments(), oldRecords.length);
        const indexes = await AuditLog.collection.indexes();
        const unique = indexes.find((index) => index.name === 'audit_event_id_unique');
        assert.equal(unique.unique, true);
        assert.deepEqual(unique.partialFilterExpression, { kind: 'event', eventId: { $type: 'string' } });
        assert.ok(indexes.some((index) => index.name === 'existing_custom_index'));
        assert.ok(indexes.some((index) => index.expireAfterSeconds === 180 * 24 * 3600));
    });

    const metadata = {
        eventId: 'event-1', eventType: 'job.created', eventVersion: 1, aggregateId: '7',
        occurredAt: '2026-09-04T01:02:03.456Z', producer: 'job-core-service', correlationId: 'corr-1'
    };
    const payload = { jobId: 7, description: 'original', nested: { password: 'do-not-store', fileBase64: 'do-not-store' } };
    await check('50 concurrent real MongoDB upserts create exactly one identified audit entry', async () => {
        const results = await Promise.all(Array.from({ length: 50 }, () => recordEvent('job.created', payload, metadata)));
        assert.equal(results.filter((result) => !result.duplicate).length, 1);
        assert.equal(await AuditLog.countDocuments({ kind: 'event', eventId: 'event-1' }), 1);
        const doc = await AuditLog.findOne({ kind: 'event', eventId: 'event-1' }).lean();
        assert.equal(doc.service, 'job-core-service');
        assert.equal(doc.correlationId, 'corr-1');
        assert.equal(doc.occurredAt.toISOString(), metadata.occurredAt);
        assert.equal(doc.payload.nested.password, '[đã lược bỏ]');
        assert.equal(doc.payload.nested.fileBase64, '[đã lược bỏ]');
    });

    await check('replay preserves first payload and retention timestamp; new IDs remain independent', async () => {
        const before = await AuditLog.findOne({ kind: 'event', eventId: 'event-1' }).lean();
        await recordEvent('job.created', { jobId: 7, description: 'changed on replay' }, metadata);
        const after = await AuditLog.findById(before._id).lean();
        assert.deepEqual(after.payload, before.payload);
        assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
        await recordEvent('job.created', payload, { ...metadata, eventId: 'event-2' });
        assert.equal(await AuditLog.countDocuments({ kind: 'event', eventId: { $in: ['event-1', 'event-2'] } }), 2);
    });

    await check('real committed write followed by a simulated lost response is safe to retry', async () => {
        const actualUpdate = AuditLog.updateOne;
        AuditLog.updateOne = async function (...args) {
            await actualUpdate.apply(this, args);
            throw Object.assign(new Error('simulated reply lost after MongoDB commit'), { name: 'MongoNetworkError' });
        };
        try {
            await assert.rejects(recordEvent('job.created', payload, { ...metadata, eventId: 'lost-reply' }), /simulated reply lost/);
        } finally {
            AuditLog.updateOne = actualUpdate;
        }
        assert.equal((await recordEvent('job.created', payload, { ...metadata, eventId: 'lost-reply' })).duplicate, true);
        assert.equal(await AuditLog.countDocuments({ kind: 'event', eventId: 'lost-reply' }), 1);
    });

    await check('identity remains case-sensitive and legacy events/actions remain compatible', async () => {
        await recordEvent('job.created', payload, { ...metadata, eventId: 'EVENT-1' });
        assert.equal(await AuditLog.countDocuments({ kind: 'event', eventId: { $in: ['event-1', 'EVENT-1'] } }), 2);
        await recordEvent('legacy.event', { jobId: 7 });
        await recordEvent('legacy.event', { jobId: 7 });
        await recordAction({ method: 'POST', route: '/test' });
        await recordAction({ method: 'POST', route: '/test' });
        assert.equal(await AuditLog.countDocuments({ name: 'legacy.event' }), 2);
        assert.equal(await AuditLog.countDocuments({ kind: 'action', name: 'POST /test' }), 2);
    });

    await check('conflicting historical IDs stop index startup without deleting records', async () => {
        // Fault fixture inside this disposable DB only, never the project database.
        await AuditLog.collection.dropIndex('audit_event_id_unique');
        await AuditLog.collection.insertMany([
            { kind: 'event', name: 'test.conflict', eventId: 'conflict' },
            { kind: 'event', name: 'test.conflict', eventId: 'conflict' }
        ]);
        await assert.rejects(ensureAuditIndexes(), (error) => error.code === 11000);
        assert.equal(await AuditLog.countDocuments({ eventId: 'conflict' }), 2);
    });
    console.log(`Admin audit integration: ${passed} checks passed.`);
} finally {
    await mongoose.disconnect();
    if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
        // Resolve/verify the exact freshly created container before removing it.
        const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', containerId));
        assert.equal(labels['jobfind.audit-test'], token, 'Refusing to remove an unowned container');
        await docker('rm', '--force', '--volumes', containerId);
        console.log('Removed only the temporary test container and its disposable data.');
    }
}
