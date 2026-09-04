import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

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
    const elastic = await import('../search-service/src/libs/elastic.js');
    es = elastic.es;
    const { INDEX, ensureIndex, liveIndexQuery } = elastic;
    const { synchronizeJob, createJobSynchronizer } = await import('../search-service/src/libs/jobProjection.js');
    const { handleSearchEvent, rebuildIndex, listIndexedIds } = await import('../search-service/src/consumers/jobIndexer.js');
    const { searchJobs, suggest, facets } = await import('../search-service/src/controllers/searchController.js');
    for (let attempt = 0; ; attempt += 1) {
        try { await es.ping({}, { requestTimeout: 1500, maxRetries: 0 }); break; }
        catch (error) { if (attempt === 59) throw error; await delay(500); }
    }
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
