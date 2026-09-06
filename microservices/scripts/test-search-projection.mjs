import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createEventEnvelope, eventProperties, readEventMessage } from '../shared/eventEnvelope.js';

// Opt-in, real ES + a controlled HTTP source double. Never connects to project
// ES/MySQL/RabbitMQ, downloads images, or restarts deployed services.
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout.trim();
const image = 'docker.elastic.co/elasticsearch/elasticsearch:8.15.0';
const token = randomUUID();
const jobs = new Map();
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
};
const job = (id, name = 'Node developer') => ({
    id, name, statusCode: 'PS1', companyId: 3, companyName: 'Test company',
    companyStatusCode: 'S1', companyCensorCode: 'CS1', categoryJobCode: 'IT',
    descriptionHTML: '<p>Build reliable Node services</p>'
});
let containerId;
let es;
let held;
let sourceFailure;
let passed = 0;
const gates = new Set();
const pauseNextRead = (id) => {
    const gate = { id: String(id), entered: deferred(), release: deferred() };
    held = gate;
    gates.add(gate);
    return gate;
};
const check = async (name, fn) => { await fn(); passed += 1; console.log(`PASS: ${name}`); };
const source = createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
        if (req.headers['x-internal-secret'] !== token) return send(403, { errCode: 1 });
        if (sourceFailure) return send(sourceFailure, sourceFailure === 404 ? { error: 'route absent' } : { errCode: -1 });
        if (req.url === '/internal/jobs') {
            return send(200, { errCode: 0, data: [...jobs.values()] });
        }
        const id = /^\/internal\/jobs\/([1-9][0-9]*)$/.exec(req.url)?.[1];
        if (!id) return send(404, { error: 'route absent' });
        const snapshot = structuredClone(jobs.get(id) || null);
        const gate = held?.id === id ? held : null;
        if (gate) {
            held = null;
            gate.entered.resolve();
            await gate.release.promise;
        }
        send(snapshot ? 200 : 404, snapshot ? { errCode: 0, data: snapshot } : { errCode: 2 });
    } catch (error) { send(500, { errCode: -1, message: error.message }); }
});

try {
    await docker('image', 'inspect', image, '--format', '{{.Id}}');
    containerId = await docker('run', '--detach', '--rm', '--pull=never',
        '--name', `jobfind-search-test-${token.slice(0, 8)}`, '--label', `jobfind.search-test=${token}`,
        '--publish', '127.0.0.1::9200', '--env', 'discovery.type=single-node',
        '--env', 'xpack.security.enabled=false', '--env', 'ES_JAVA_OPTS=-Xms256m -Xmx256m', image);
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const port = await docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "9200/tcp") 0).HostPort}}', containerId);
    assert.match(port, /^\d+$/);
    await new Promise((resolve, reject) => { source.once('error', reject); source.listen(0, '127.0.0.1', resolve); });
    // Override URLs in this test process BEFORE importing production modules.
    process.env.ELASTICSEARCH_URL = `http://127.0.0.1:${port}`;
    process.env.JOB_CORE_URL = `http://127.0.0.1:${source.address().port}`;
    process.env.INTERNAL_SECRET = token;
    // Wait on bounded, fresh HTTP connections BEFORE constructing the SDK pool.
    // A pool first used while Docker's port is not ready can retain a dead
    // connection/backoff long after a fresh loopback connection succeeds.
    const readyBy = Date.now() + 120000;
    for (;;) {
        try {
            const probe = await fetch(process.env.ELASTICSEARCH_URL, { signal: AbortSignal.timeout(1500) });
            const info = await probe.json();
            if (!probe.ok || info.version?.number !== '8.15.0') throw new Error('Disposable Elasticsearch not ready');
            break;
        } catch (error) {
            if (Date.now() >= readyBy) throw new Error('Disposable Elasticsearch startup timed out', { cause: error });
            await delay(500);
        }
    }
    const elastic = await import('../search-service/src/libs/elastic.js');
    es = elastic.es;
    const { INDEX, ensureIndex, liveIndexQuery } = elastic;
    const { synchronizeJob, createJobSynchronizer } = await import('../search-service/src/libs/jobProjection.js');
    const { handleSearchEvent, rebuildIndex, listIndexedIds } = await import('../search-service/src/consumers/jobIndexer.js');
    const { searchJobs, suggest, facets } = await import('../search-service/src/controllers/searchController.js');
    await es.ping({}, { requestTimeout: 1500, maxRetries: 0 });
    const read = async (id) => (await es.get({ index: INDEX, id: String(id) }))._source;
    const signal = (id, eventId = token) => handleSearchEvent({ job: { id, name: 'stale payload', statusCode: 'PS1' } }, 'job.updated', { eventId, aggregateId: String(id) });
    const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

    await check('additive mappings preserve an existing index and documents', async () => {
        await es.indices.create({ index: INDEX, settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings: { properties: { id: { type: 'integer' } } } });
        await es.index({ index: INDEX, id: '900', document: { id: 900 } });
        await ensureIndex();
        await ensureIndex();
        assert.equal((await read(900)).id, 900);
        const mappings = await es.indices.getMapping({ index: INDEX });
        assert.equal(mappings[INDEX].mappings.properties.searchSync.enabled, false);
    });

    await check('concurrent duplicate events produce one business document and preserve indexedAt', async () => {
        jobs.set('7', job(7));
        await signal(7, 'same-event');
        const before = await read(7);
        await Promise.all(Array.from({ length: 4 }, () => signal(7, 'same-event')));
        const after = await read(7);
        assert.equal(after.name, jobs.get('7').name);
        assert.equal(after.indexedAt, before.indexedAt);
        assert.equal(after.searchSync.hash, before.searchSync.hash);
    });

    await check('a delayed old event loses the real ES CAS race and rereads the current source', async () => {
        const gate = pauseNextRead(7);
        const old = signal(7, 'older-event');
        await gate.entered.promise;
        jobs.set('7', job(7, 'Newest title'));
        try { await signal(7, 'newer-event'); } finally { gate.release.resolve(); }
        await old;
        assert.equal((await read(7)).name, 'Newest title');
    });

    await check('op_type=create protects concurrent first-time indexing', async () => {
        jobs.set('8', job(8, 'Old first snapshot'));
        const gate = pauseNextRead(8);
        const old = signal(8);
        await gate.entered.promise;
        jobs.set('8', job(8, 'New first snapshot'));
        try { await signal(8); } finally { gate.release.resolve(); }
        await old;
        assert.equal((await read(8)).name, 'New first snapshot');
    });

    await check('unchanged A refresh still fences a delayed B snapshot in A -> B -> A', async () => {
        jobs.set('9', job(9, 'A'));
        await signal(9);
        jobs.set('9', job(9, 'B'));
        const gate = pauseNextRead(9);
        const delayed = signal(9);
        await gate.entered.promise;
        jobs.set('9', job(9, 'A'));
        try { assert.equal((await synchronizeJob(9)).changed, false); } finally { gate.release.resolve(); }
        await delayed;
        assert.equal((await read(9)).name, 'A');
    });

    await check('a delayed reconciliation cannot resurrect a job removed by a newer event', async () => {
        const gate = pauseNextRead(7);
        const rebuild = rebuildIndex();
        await gate.entered.promise;
        jobs.set('7', { ...jobs.get('7'), statusCode: 'PS4' });
        try { await handleSearchEvent({ jobId: 7 }, 'job.deleted', { eventId: 'delete-7' }); }
        finally { gate.release.resolve(); }
        await rebuild;
        await signal(7, 'ancient-create');
        const removed = await read(7);
        assert.equal(removed.searchDeleted, true);
        assert.equal(removed.name, undefined);
        // A genuinely restored source row is allowed; an old delete is only a refresh signal.
        jobs.set('7', job(7, 'Restored in source'));
        await handleSearchEvent({ jobId: 7 }, 'job.deleted', { eventId: 'old-delete' });
        assert.equal((await read(7)).searchDeleted, false);
    });

    await check('out-of-order moderation/company payloads cannot unhide current hidden data', async () => {
        jobs.set('10', job(10));
        await signal(10);
        jobs.set('10', { ...job(10), statusCode: 'PS2', companyStatusCode: 'S2' });
        await handleSearchEvent({ jobId: 10, statusCode: 'PS1', approved: true }, 'job.moderated', {});
        await handleSearchEvent({ companyId: 3, statusCode: 'S1', censorCode: 'CS1' }, 'company.updated', {});
        const hidden = await read(10);
        assert.equal(hidden.statusCode, 'PS2');
        assert.equal(hidden.companyStatusCode, 'S2');
        await es.indices.refresh({ index: INDEX });
        const res = response();
        await searchJobs({ query: {} }, res);
        assert.equal(res.statusCode, 200);
        assert.ok(!res.body.data.some((doc) => doc.id === 10));
        assert.ok(res.body.data.every((doc) => !('searchSync' in doc) && !('searchDeleted' in doc)));
    });

    await check('HTTP source outages and an undeployed endpoint never turn existing jobs into tombstones', async () => {
        const before = await read(8);
        try {
            for (const status of [500, 404]) {
                sourceFailure = status;
                await assert.rejects(signal(8));
                assert.deepEqual(await read(8), before);
            }
        } finally { sourceFailure = null; }
    });

    await check('a lost client response after an actual ES commit is safe to retry', async () => {
        jobs.set('12', job(12));
        let lost = true;
        const sync = createJobSynchronizer({ client: {
            get: (...args) => es.get(...args),
            index: async (...args) => {
                const result = await es.index(...args);
                if (lost) { lost = false; throw new Error('simulated response lost'); }
                return result;
            }
        } });
        await assert.rejects(sync(12), /simulated response lost/);
        assert.equal((await sync(12)).changed, false);
        assert.equal((await read(12)).searchDeleted, false);
    });

    await check('empty-source rebuild checks all indexed orphans, retains fences and hides them from public APIs/counts', async () => {
        jobs.clear();
        await rebuildIndex();
        const all = await es.count({ index: INDEX });
        assert.equal(all.count, 6);
        assert.equal((await es.count({ index: INDEX, query: liveIndexQuery })).count, 0);
        for (const handler of [searchJobs, suggest, facets]) {
            const res = response();
            await handler({ query: { q: 'Node' } }, res);
            assert.equal(res.statusCode, 200);
            if (handler === facets) assert.deepEqual(res.body.data, { categories: [], provinces: [], salaries: [] });
            else assert.deepEqual(res.body.data, []);
        }
    });

    // Legacy outbox uses the existing job.created/updated contracts. Decode the
    // exact envelope used by its relay, then call the real Search consumer.
    const legacySignal = (snapshot, eventId, eventType = 'job.updated') => {
        const id = snapshot.id;
        const event = createEventEnvelope({ eventId, eventType, aggregateId: id,
            occurredAt: '2026-09-06T00:00:00Z', producer: 'legacy-backend', payloadVersion: 1,
            data: { job: snapshot } });
        const { payload, metadata } = readEventMessage({ content: Buffer.from(JSON.stringify(event.data)),
            properties: eventProperties(event), fields: { routingKey: eventType } });
        assert.equal(metadata.producer, 'legacy-backend');
        return handleSearchEvent(payload, eventType, metadata);
    };
    const manualSignal = (id, statusCode, eventId) => legacySignal({ ...job(id, 'Historical manual snapshot'), statusCode }, eventId);
    const isPublic = async id => {
        await es.indices.refresh({ index: INDEX });
        const res = response(); await searchJobs({ query: {} }, res);
        assert.equal(res.statusCode, 200);
        return res.body.data.some(row => row.id === id);
    };
    await check('manual approve/ban/reopen/reject events use CURRENT source state; old approval cannot resurrect a hidden job', async () => {
        jobs.set('20', job(20, 'Current approved title'));
        await manualSignal(20, 'PS1', 'manual-approved-20');
        assert.equal((await read(20)).name, 'Current approved title'); assert.equal(await isPublic(20), true);
        const first = await read(20);
        await Promise.all([manualSignal(20, 'PS1', 'manual-approved-20'), manualSignal(20, 'PS1', 'manual-approved-20')]);
        assert.equal((await read(20)).indexedAt, first.indexedAt);
        for (const status of ['PS4', 'PS3', 'PS2']) {
            jobs.set('20', { ...job(20), statusCode: status });
            await manualSignal(20, status, `manual-${status}-20`);
            await manualSignal(20, 'PS1', 'manual-approved-20');
            assert.equal(await isPublic(20), false);
            if (status === 'PS4') { assert.equal((await read(20)).searchDeleted, true); assert.equal((await read(20)).name, undefined); }
            else assert.equal((await read(20)).statusCode, status);
        }
        jobs.set('20', job(20, 'Approved again in source'));
        await manualSignal(20, 'PS4', 'manual-PS4-20');
        assert.equal(await isPublic(20), true); assert.equal((await read(20)).name, 'Approved again in source');
    });
    await check('a late manual approval cannot bypass current company public policy', async () => {
        for (const policy of [{ companyStatusCode: 'S2' }, { companyCensorCode: 'CS2' }, { companyId: null, companyStatusCode: null, companyCensorCode: null }]) {
            jobs.set('21', { ...job(21), ...policy });
            await manualSignal(21, 'PS1', 'manual-approval-21');
            assert.equal(await isPublic(21), false);
        }
    });
    await check('source outage leaves the prior projection intact; replaying the saved manual event after recovery applies the ban', async () => {
        jobs.set('22', job(22)); await manualSignal(22, 'PS1', 'manual-approval-22');
        const before = await read(22); jobs.set('22', { ...job(22), statusCode: 'PS4' });
        sourceFailure = 503;
        try { await assert.rejects(manualSignal(22, 'PS4', 'manual-ban-22')); assert.deepEqual(await read(22), before); }
        finally { sourceFailure = null; }
        await manualSignal(22, 'PS4', 'manual-ban-22');
        assert.equal((await read(22)).searchDeleted, true); assert.equal(await isPublic(22), false);
    });
    await check('a paused manual approval loses the CAS race against a later ban and rereads the hidden source', async () => {
        jobs.set('23', job(23)); await manualSignal(23, 'PS1', 'manual-approval-23');
        const gate = pauseNextRead(23), delayed = manualSignal(23, 'PS1', 'manual-approval-23');
        await gate.entered.promise;
        jobs.set('23', { ...job(23), statusCode: 'PS4' });
        try { await manualSignal(23, 'PS4', 'manual-ban-23'); } finally { gate.release.resolve(); }
        await delayed; assert.equal((await read(23)).searchDeleted, true); assert.equal(await isPublic(23), false);
    });

    await check('legacy edit signals project the latest PS3 content and raw codes; older approval/edit cannot restore stale content or status', async () => {
        const approved = job(24, 'Originally approved'), firstEdit = { ...job(24, 'First draft'), statusCode: 'PS3', amount: 2 };
        jobs.set('24', approved); await legacySignal(approved, 'approve-24');
        const latest = { ...firstEdit, name: 'Latest draft', descriptionHTML: '<p>Newest content</p>', amount: 9, categoryJobCode: 'OTHER', addressCode: 'HCM' };
        jobs.set('24', latest);
        await legacySignal(firstEdit, 'edit-24-first'); await legacySignal(approved, 'approve-24');
        const current = await read(24);
        assert.equal(current.name, latest.name); assert.equal(current.description, 'Newest content');
        assert.equal(current.amount, 9); assert.equal(current.categoryJobCode, 'OTHER'); assert.equal(current.addressCode, 'HCM');
        assert.equal(current.statusCode, 'PS3'); assert.equal(await isPublic(24), false);
        jobs.set('24', { ...latest, statusCode: 'PS1' }); // a later manual decision
        await legacySignal(firstEdit, 'edit-24-first');
        assert.equal((await read(24)).name, latest.name); assert.equal(await isPublic(24), true);
    });
    await check('retrying a saved legacy edit after source recovery applies new content/PS3 without treating outage as deletion', async () => {
        const original = job(25), edited = { ...job(25, 'Saved while source down'), statusCode: 'PS3' };
        jobs.set('25', original); await legacySignal(original, 'approve-25'); const before = await read(25);
        jobs.set('25', edited); sourceFailure = 503;
        try { await assert.rejects(legacySignal(edited, 'edit-25')); assert.deepEqual(await read(25), before); }
        finally { sourceFailure = null; }
        await legacySignal(edited, 'edit-25'); const saved = await read(25);
        assert.equal(saved.name, edited.name); assert.equal(saved.statusCode, 'PS3'); assert.equal(await isPublic(25), false);
        await Promise.all([legacySignal(edited, 'edit-25'), legacySignal(edited, 'edit-25')]);
        assert.equal((await read(25)).indexedAt, saved.indexedAt); assert.equal((await read(25)).searchSync.hash, saved.searchSync.hash);
    });
    await check('a paused legacy edit loses CAS against a newer edit and rereads current content', async () => {
        const original = job(26), older = { ...job(26, 'Older edit'), statusCode: 'PS3' }, newer = { ...older, name: 'Newer edit', amount: 7 };
        jobs.set('26', original); await legacySignal(original, 'approve-26'); jobs.set('26', older);
        const gate = pauseNextRead(26), delayed = legacySignal(older, 'edit-26-old'); await gate.entered.promise;
        jobs.set('26', newer);
        try { await legacySignal(newer, 'edit-26-new'); } finally { gate.release.resolve(); }
        await delayed;
        assert.equal((await read(26)).name, newer.name); assert.equal((await read(26)).amount, 7); assert.equal(await isPublic(26), false);
    });

    await check('saved legacy creation remains private in PS3; duplicate/late creation reads current approval, edit or deletion', async () => {
        const created = { ...job(27, 'Created pending'), statusCode: 'PS3', amount: 2 };
        jobs.set('27', created); await legacySignal(created, 'create-27', 'job.created');
        assert.equal((await read(27)).name, created.name); assert.equal(await isPublic(27), false);
        const first = await read(27); await legacySignal(created, 'create-27', 'job.created');
        assert.equal((await read(27)).indexedAt, first.indexedAt);
        jobs.set('27', { ...job(27, 'Approved latest'), amount: 5 });
        await legacySignal(created, 'create-27', 'job.created');
        assert.equal((await read(27)).name, 'Approved latest'); assert.equal(await isPublic(27), true);
        jobs.set('27', { ...created, name: 'Later edited', amount: 9 });
        await legacySignal(created, 'create-27', 'job.created');
        assert.equal((await read(27)).amount, 9); assert.equal(await isPublic(27), false);
        jobs.delete('27'); await legacySignal(created, 'create-27', 'job.created');
        assert.equal((await read(27)).searchDeleted, true); assert.equal(await isPublic(27), false);
    });
    await check('first legacy creation projection retries after source failure without indexing the event snapshot', async () => {
        const created = { ...job(28, 'Created during outage'), statusCode: 'PS3' };
        jobs.set('28', created); sourceFailure = 503;
        try { await assert.rejects(legacySignal(created, 'create-28', 'job.created')); assert.equal(await es.exists({ index: INDEX, id: '28' }), false); }
        finally { sourceFailure = null; }
        await legacySignal(created, 'create-28', 'job.created');
        assert.equal((await read(28)).name, created.name); assert.equal(await isPublic(28), false);
    });

    await check('legacy repost indexes the new ID independently; old source changes/deletion cannot overwrite the pending copy', async () => {
        const sourceJob = job(50, 'Original source'), copy = { ...job(51, 'Copied snapshot'), statusCode: 'PS3' };
        jobs.set('50', sourceJob); jobs.set('51', copy);
        await legacySignal(sourceJob, 'source-50'); await legacySignal(copy, 'repost-51', 'job.created');
        assert.equal((await read(50)).name, sourceJob.name); assert.equal((await read(51)).name, copy.name);
        assert.equal(await isPublic(51), false);
        jobs.delete('50'); await legacySignal(sourceJob, 'source-50');
        assert.equal((await read(50)).searchDeleted, true); assert.equal((await read(51)).name, copy.name);
        jobs.set('51', { ...copy, name: 'Copy later approved', statusCode: 'PS1' });
        await legacySignal(copy, 'repost-51', 'job.created');
        assert.equal((await read(51)).name, 'Copy later approved'); assert.equal(await isPublic(51), true);
        assert.equal((await read(50)).searchDeleted, true);
    });

    await check('real scroll scans past 10000 IDs and leaves no open search contexts', async () => {
        const operations = Array.from({ length: 10005 }, (_, i) => [
            { index: { _index: INDEX, _id: String(i + 1000) } }, { id: i + 1000, searchDeleted: true }
        ]).flat();
        const result = await es.bulk({ operations, refresh: true });
        assert.equal(result.errors, false);
        const ids = await listIndexedIds();
        assert.ok(ids.length > 10000);
        assert.ok(ids.includes('11004'));
        const stats = await es.indices.stats({ index: INDEX, metric: 'search' });
        assert.equal(stats.indices[INDEX].total.search.open_contexts, 0);
    });
    await check('approval notification policy does not bypass Search visibility or apply delayed creation snapshots', async () => {
        jobs.set('61', { ...job(61), statusCode: 'PS3' });
        const payload = { job: { ...job(61), statusCode: 'PS3' }, notificationPolicy: 'approval-v1' };
        const event = createEventEnvelope({ eventId: 'policy-create-61', eventType: 'job.created', aggregateId: '61',
            occurredAt: '2026-09-06T00:00:00Z', producer: 'job-core-service', payloadVersion: 1, data: payload });
        const decoded = readEventMessage({ content: Buffer.from(JSON.stringify(payload)), fields: { routingKey: 'job.created' }, properties: eventProperties(event) });
        await handleSearchEvent(decoded.payload, 'job.created', decoded.metadata);
        assert.equal((await read(61)).statusCode, 'PS3');
        assert.equal(await isPublic(61), false);
        jobs.set('61', job(61, 'Approved current title'));
        await handleSearchEvent({ jobId: 61, approved: true, statusCode: 'PS1' }, 'job.moderated', { eventId: 'approved-61' });
        await handleSearchEvent(decoded.payload, 'job.created', decoded.metadata);
        assert.equal((await read(61)).name, 'Approved current title');
        assert.equal(await isPublic(61), true);
        jobs.set('61', { ...job(61), statusCode: 'PS4' });
        await handleSearchEvent(decoded.payload, 'job.created', decoded.metadata);
        // Removed jobs retain only a tombstone, not public status/content.
        assert.equal((await read(61)).searchDeleted, true);
        assert.equal((await read(61)).name, undefined);
        assert.equal(await isPublic(61), false);
    });
    console.log(`Search projection integration: ${passed} checks passed.`);
} finally {
    for (const gate of gates) gate.release.resolve();
    source.closeAllConnections();
    await new Promise((resolve) => source.close(resolve));
    try { await es?.close(); }
    finally {
        if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
            const labels = JSON.parse(await docker('inspect', '--format', '{{json .Config.Labels}}', containerId));
            assert.equal(labels['jobfind.search-test'], token, 'Refusing to remove an unowned container');
            await docker('rm', '--force', '--volumes', containerId);
            console.log('Removed only the temporary test container and its disposable data.');
        }
    }
}
