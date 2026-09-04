import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { createTaskStore } from '../ai-worker/src/libs/taskStore.js';
import { createTaskProcessor } from '../ai-worker/src/libs/taskProcessor.js';
import { taskIdentity } from '../ai-worker/src/libs/taskIdentity.js';

// Opt-in real MongoDB tests. Never reads AI_MONGO_URL, uses a real AI key,
// publishes RabbitMQ messages, or mutates the deployed project's databases.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const token = randomUUID();
let containerId;
let client;
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS: ${name}`); };
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};

try {
    await docker('image', 'inspect', 'mongo:7', '--format', '{{.Id}}');
    containerId = await docker('run', '--detach', '--rm', '--pull=never',
        '--name', `jobfind-ai-test-${token.slice(0, 8)}`, '--label', `jobfind.ai-test=${token}`,
        '--publish', '127.0.0.1::27017', 'mongo:7', '--bind_ip_all');
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const port = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "27017/tcp") 0).HostPort}}', containerId);
    assert.match(port, /^\d+$/);
    client = new MongoClient(`mongodb://127.0.0.1:${port}/ai_worker_integration`, {
        serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500, socketTimeoutMS: 5000,
        retryWrites: false, writeConcern: { w: 'majority', j: true, wtimeoutMS: 5000 }
    });
    for (let attempt = 0; ; attempt += 1) {
        try { await client.connect(); break; }
        catch (error) { if (attempt === 19) throw error; await delay(500); }
    }
    const db = client.db();
    assert.equal(db.databaseName, 'ai_worker_integration');
    const collection = db.collection('task_executions');
    const store = createTaskStore(collection);
    const sent = [];
    let calls = 0;
    const options = {
        store, isConfigured: () => true,
        handlers: {
            'ai.moderate_job': { type: 'moderate_job', run: async () => { calls += 1; return { approved: true }; } },
            'ai.match_cv': { type: 'match_cv', run: async () => { calls += 1; return { score: 91, note: 'private result' }; } }
        },
        publishResult: async (output) => { sent.push(structuredClone(output)); }
    };
    const moderation = { jobId: 7, name: 'Test title', descriptionHTML: '<p>test</p>' };
    const invoke = (eventId, overrides = {}) => createTaskProcessor({ ...options, ...overrides })(moderation, 'ai.moderate_job', { eventId });

    await check('startup preserves existing documents/custom indexes and adds no TTL', async () => {
        await collection.insertOne({ _id: 'historic-marker', state: 'published' });
        await collection.createIndex({ routingKey: 1 }, { name: 'custom_existing' });
        await store.ensureIndexes();
        await store.ensureIndexes();
        assert.equal(await collection.countDocuments({ _id: 'historic-marker' }), 1);
        const indexes = await collection.indexes();
        assert.ok(indexes.some((index) => index.name === 'custom_existing'));
        assert.ok(indexes.some((index) => index.name === 'ai_task_state_started'));
        assert.ok(indexes.every((index) => index.expireAfterSeconds === undefined));
    });

    await check('30 independent workers claim one event atomically and invoke the model once', async () => {
        const entered = deferred();
        const release = deferred();
        const before = calls;
        const handlers = { 'ai.moderate_job': { type: 'moderate_job', run: async () => {
            calls += 1; entered.resolve(); await release.promise; return { approved: true };
        } } };
        const owner = invoke('concurrent', { handlers });
        await entered.promise;
        try {
            const rivals = await Promise.allSettled(Array.from({ length: 29 }, () => invoke('concurrent', { handlers })));
            assert.ok(rivals.every((result) => result.status === 'rejected' && result.reason.code === 'AI_TASK_UNRESOLVED'));
        } finally { release.resolve(); }
        await owner;
        assert.equal(calls - before, 1);
        assert.equal(await collection.countDocuments({ _id: 'event:concurrent' }), 1);
        assert.equal((await collection.findOne({ _id: 'event:concurrent' })).state, 'published');
        await invoke('concurrent');
        assert.equal(calls - before, 1);
    });

    await check('different input with the same ID fails closed; new IDs and case remain independent', async () => {
        const before = calls;
        await assert.rejects(createTaskProcessor(options)({ ...moderation, name: 'different' }, 'ai.moderate_job', { eventId: 'concurrent' }), { code: 'AI_TASK_ID_CONFLICT' });
        assert.equal(calls, before);
        await invoke('CONCURRENT');
        await invoke('new-content-event');
        assert.equal(calls - before, 2);
    });

    await check('saved output survives a new connection and is resent identically without another model call', async () => {
        const before = calls;
        await assert.rejects(invoke('publish-failure', { publishResult: async () => { throw new Error('simulated broker unavailable'); } }), /broker unavailable/);
        const ready = await collection.findOne({ _id: 'event:publish-failure' });
        assert.equal(ready.state, 'ready');
        assert.equal(ready.output.data.ok, true);
        const restarted = new MongoClient(`mongodb://127.0.0.1:${port}/ai_worker_integration`, {
            writeConcern: { w: 'majority', j: true, wtimeoutMS: 5000 }, retryWrites: false
        });
        try {
            await restarted.connect();
            await invoke('publish-failure', { store: createTaskStore(restarted.db().collection('task_executions')) });
        } finally { await restarted.close(); }
        assert.deepEqual(sent.at(-1), ready.output);
        assert.equal(calls - before, 1);
        const published = await collection.findOne({ _id: ready._id });
        assert.equal(published.state, 'published');
        assert.equal(published.output, undefined);
        assert.equal(published.owner, undefined);
    });

    await check('lost claim acknowledgement prevents any paid call and never reclaims the unresolved entry', async () => {
        const before = calls;
        const ambiguous = { ...store, claim: async (identity) => { await store.claim(identity); throw new Error('claim reply lost'); } };
        await assert.rejects(invoke('lost-claim', { store: ambiguous }), /claim reply lost/);
        // A very old timestamp must not silently permit another paid call.
        await collection.updateOne({ _id: 'event:lost-claim' }, { $set: { startedAt: new Date('2000-01-01') } });
        await assert.rejects(invoke('lost-claim'), { code: 'AI_TASK_UNRESOLVED' });
        assert.equal(calls, before);
    });

    await check('crash window after model completion but before result save stays unresolved', async () => {
        const before = calls;
        const failSave = { ...store, complete: async () => { throw new Error('simulated result save failure'); } };
        await assert.rejects(invoke('unsaved-result', { store: failSave }), /save failure/);
        await assert.rejects(invoke('unsaved-result'), { code: 'AI_TASK_UNRESOLVED' });
        assert.equal(calls - before, 1);
        assert.equal((await collection.findOne({ _id: 'event:unsaved-result' })).state, 'started');
    });

    await check('lost response after a real result-save commit reuses the committed output', async () => {
        const before = calls;
        const lostSave = { ...store, complete: async (...args) => { await store.complete(...args); throw new Error('save reply lost'); } };
        await assert.rejects(invoke('lost-save', { store: lostSave }), /save reply lost/);
        const ready = await collection.findOne({ _id: 'event:lost-save' });
        await invoke('lost-save');
        assert.deepEqual(sent.at(-1), ready.output);
        assert.equal(calls - before, 1);
    });

    await check('lost confirmation/marker allows duplicate result delivery with the same ID, never duplicate computation', async () => {
        const before = calls;
        const failedMarker = { ...store, markPublished: async () => { throw new Error('marker unavailable'); } };
        await assert.rejects(invoke('marker-failure', { store: failedMarker }), /marker unavailable/);
        const first = structuredClone(sent.at(-1));
        await invoke('marker-failure');
        assert.deepEqual(sent.at(-1), first);
        assert.equal(calls - before, 1);
        const lostMarker = { ...store, markPublished: async (...args) => { await store.markPublished(...args); throw new Error('marker reply lost'); } };
        await assert.rejects(invoke('lost-marker', { store: lostMarker }), /marker reply lost/);
        const count = sent.length;
        await invoke('lost-marker');
        assert.equal(sent.length, count);
    });

    await check('taskId protects legacy CV tasks; raw CV is never in the ledger and published output is removed', async () => {
        const before = calls;
        const payload = { taskId: 'legacy-task-1', resumeText: 'private CV body' };
        await createTaskProcessor(options)(payload, 'ai.match_cv');
        await createTaskProcessor(options)({ resumeText: payload.resumeText, taskId: payload.taskId }, 'ai.match_cv');
        assert.equal(calls - before, 1);
        const doc = await collection.findOne({ _id: taskIdentity(payload, 'ai.match_cv').key });
        assert.ok(!JSON.stringify(doc).includes('private CV body'));
        assert.ok(!JSON.stringify(doc).includes('private result'));
    });

    await check('legacy moderation is explicitly not deduplicated by jobId', async () => {
        const before = calls;
        await createTaskProcessor(options)(moderation, 'ai.moderate_job');
        await createTaskProcessor(options)(moderation, 'ai.moderate_job');
        assert.equal(calls - before, 2);
        assert.notEqual(sent.at(-1).eventId, sent.at(-2).eventId);
    });

    await check('model failure is frozen and a later replay never silently starts a new paid attempt', async () => {
        const before = calls;
        const handlers = { 'ai.moderate_job': { type: 'moderate_job', run: async () => { calls += 1; throw new Error('simulated provider timeout'); } } };
        await invoke('model-timeout', { handlers });
        assert.equal(sent.at(-1).data.ok, false);
        await invoke('model-timeout');
        assert.equal(calls - before, 1);
    });
    console.log(`AI task integration: ${passed} checks passed; no real AI or RabbitMQ calls.`);
} finally {
    try { await client?.close(); }
    finally {
        if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
            const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', containerId));
            assert.equal(labels['jobfind.ai-test'], token, 'Refusing to remove an unowned container');
            await docker('rm', '--force', '--volumes', containerId);
            console.log('Removed only the temporary test container and its disposable data.');
        }
    }
}
