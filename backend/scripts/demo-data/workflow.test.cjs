'use strict';

const test = globalThis.test || require('node:test');
const assert = require('node:assert/strict');
const { STAGES, buildWorkflowPlan, seedWorkflow, canAdoptProjection } = require('./workflow.cjs');

const now = new Date('2026-09-27T12:00:00Z');
// Compare persisted values across Node/Jest VM realms, ignoring clone prototypes.
const snapshot = value => JSON.stringify(value, (_, item) =>
    Object.prototype.toString.call(item) === '[object Map]' ? [...item] : item);
function manifest() {
    return {
        seedId: 'jobfind-demo-v1',
        companies: [1, 2].map(id => ({ id, name: `Công ty demo ${id}`, recruiterId: id + 100 })),
        candidates: Array.from({ length: 12 }, (_, index) => ({
            id: index + 10, name: `Ứng viên ${index + 1}`, email: `candidate${index + 1}@jobfind.example`,
            phone: `09000000${String(index).padStart(2, '0')}`, skills: ['React', 'SQL']
        })),
        posts: [1, 2].map(id => ({ id: id + 20, companyId: id, title: `Kỹ sư phần mềm ${id}` })),
        cvs: Array.from({ length: 12 }, (_, index) => ({
            id: index + 30, userId: index + 10, postId: index < 6 ? 21 : 22,
            createdAt: new Date(now.getTime() - (30 - index) * 86400000).toISOString(),
            description: 'Tôi mong muốn trao đổi thêm về công việc.'
        }))
    };
}

// A stateful fake checks externally important behavior across repeated runs,
// including preserving edits and atomic rollback. Real SQL/schema compatibility
// is also verified by the companion seed's PostgreSQL readback when applied.
class MemoryClient {
    constructor() {
        this.connectionParameters = { host: '127.0.0.1' };
        this.apps = new Map(); this.events = []; this.notes = []; this.talent = new Map();
        this.calls = []; this.nextId = 1;
    }
    async query(sql, values = []) {
        this.calls.push({ sql, values });
        if (sql === 'BEGIN') {
            this.backup = structuredClone({ apps: this.apps, events: this.events, notes: this.notes, talent: this.talent });
            return { rows: [] };
        }
        if (sql === 'COMMIT') return { rows: [] };
        if (sql === 'ROLLBACK') { Object.assign(this, this.backup); return { rows: [] }; }
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.startsWith('INSERT INTO applications')) {
            if (this.apps.has(values[0])) return { rows: [], rowCount: 0 };
            const row = this.application(values, this.nextId++);
            this.apps.set(row.legacy_cv_id, row);
            return { rows: [{ id: row.id }], rowCount: 1 };
        }
        if (sql.startsWith('SELECT * FROM applications')) return { rows: [this.apps.get(values[0])].filter(Boolean) };
        if (sql.includes('AS has_history')) return { rows: [{ has_history:
            this.events.some(row => row[0] === values[0]) || this.notes.some(row => row[0] === values[0]) }] };
        if (sql.startsWith('UPDATE applications')) {
            const row = this.application(values, values[17]);
            this.apps.set(row.legacy_cv_id, row);
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO application_events')) {
            if (this.failEvents) throw new Error('Event write failed');
            this.events.push(structuredClone(values)); return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO application_notes')) { this.notes.push(structuredClone(values)); return { rows: [], rowCount: 1 }; }
        if (sql.startsWith('INSERT INTO talent_pool')) {
            const key = `${values[0]}:${values[1]}`;
            if (this.talent.has(key)) return { rows: [], rowCount: 0 };
            this.talent.set(key, structuredClone(values)); return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    }
    application(values, id) {
        const names = ['legacy_cv_id', 'job_id', 'job_title', 'candidate_id', 'candidate_name', 'candidate_email',
            'candidate_phone', 'company_id', 'stage', 'rating', 'match_score', 'cover_letter', 'cv_snapshot',
            'is_read', 'applied_at', 'stage_changed_at', 'updated_at'];
        const row = { id, ...Object.fromEntries(names.map((name, index) => [name, values[index]])) };
        row.cv_snapshot = JSON.parse(row.cv_snapshot);
        return row;
    }
}

test('every company has all six stages and chronological history without fabricated AI scores', () => {
    const data = manifest();
    const plan = buildWorkflowPlan(data, { now });
    for (const company of data.companies) {
        assert.deepEqual(plan.applications.filter(app => app.companyId === company.id).map(app => app.stage), STAGES);
    }
    for (const app of plan.applications) {
        assert.equal(app.matchScore, null);
        assert.equal(app.appliedAt, data.cvs.find(cv => cv.id === app.legacyCvId).createdAt);
        let previous = null;
        let lastTime = new Date(app.appliedAt).getTime();
        for (const event of app.events) {
            assert.equal(event.fromStage, previous);
            assert.ok(new Date(event.createdAt).getTime() >= lastTime);
            assert.ok(new Date(event.createdAt).getTime() <= now.getTime());
            assert.match(event.reason, /^\[DEMO\]/);
            previous = event.toStage; lastTime = new Date(event.createdAt).getTime();
        }
        assert.equal(previous, app.stage);
        assert.equal(app.stageChangedAt, app.events.at(-1).createdAt);
        if (app.stage === 'de_nghi') {
            const offer = app.events.at(-1).decisionSnapshot.offer;
            assert.ok(new Date(`${offer.responseDeadline}:00+07:00`) > now);
            assert.ok(new Date(`${offer.startDate}T${offer.startTime}:00+07:00`) > now);
        }
    }
});

test('manifest references, duplicate applications, stages and dates fail before database writes', async () => {
    const mutations = [
        data => { data.cvs[0].userId = 99999; },
        data => { data.posts[0].companyId = 99999; },
        data => { data.cvs[1].userId = data.cvs[0].userId; },
        data => { data.cvs[0].stage = 'invented'; },
        data => { data.cvs[0].createdAt = '2027-01-01'; },
        data => { data.seedId = 'production'; }
    ];
    for (const mutate of mutations) {
        const data = manifest(); mutate(data);
        const client = new MemoryClient();
        await assert.rejects(seedWorkflow({ client, manifest: data, now, databaseHost: '127.0.0.1', apply: true }));
        assert.equal(client.calls.length, 0);
    }
});

test('default preview performs no queries; nonlocal connection and Pool targets cannot apply', async () => {
    const client = new MemoryClient();
    const preview = await seedWorkflow({ client, manifest: manifest(), now });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.applications, 12);
    assert.equal(client.calls.length, 0);
    await assert.rejects(seedWorkflow({ client, manifest: manifest(), now, databaseHost: 'db.example.com', apply: true }), /local development/);
    client.connectionParameters.host = 'remote.example.com';
    await assert.rejects(seedWorkflow({ client, manifest: manifest(), now, databaseHost: '127.0.0.1', apply: true }), /local development/);
    client.connectionParameters.host = '127.0.0.1'; client.totalCount = 1;
    await assert.rejects(seedWorkflow({ client, manifest: manifest(), now, databaseHost: '127.0.0.1', apply: true }), /not a Pool/);
    assert.equal(client.calls.length, 0);
});

test('repeat seeding preserves manual stage, rating, notes and talent edits without duplicate history', async () => {
    const client = new MemoryClient();
    const options = { client, manifest: manifest(), now, databaseHost: '127.0.0.1', apply: true };
    const first = await seedWorkflow(options);
    assert.equal(first.inserted, 12);
    assert.ok(first.events > 12 && first.notes > 0 && first.talent > 0);
    const manual = client.apps.get(30);
    manual.stage = 'nhan_viec'; manual.rating = 5;
    client.notes.push([manual.id, 101, 'Ghi chú thật sau khi demo', now.toISOString()]);
    const removedTalent = client.talent.keys().next().value;
    client.talent.delete(removedTalent);
    const existingTalent = client.talent.values().next().value;
    existingTalent[5] = 'Ghi chú đã chỉnh sửa';
    const before = structuredClone({ apps: client.apps, events: client.events, notes: client.notes, talent: client.talent });
    const second = await seedWorkflow({ ...options, now: new Date('2026-10-01T12:00:00Z') });
    assert.equal(second.inserted, 0); assert.equal(second.adopted, 0); assert.equal(second.preserved, 12);
    assert.equal(second.events, 0); assert.equal(second.notes, 0); assert.equal(second.talent, 0);
    assert.equal(snapshot({ apps: client.apps, events: client.events, notes: client.notes, talent: client.talent }), snapshot(before));
    assert.ok(client.calls.every(call => !/outbox|notification|email_requested/i.test(call.sql)));
});

test('adopts pristine sync projections while preserving projections with manual history or different owners', async () => {
    const data = manifest();
    const client = new MemoryClient();
    await seedWorkflow({ client, manifest: data, now, databaseHost: '127.0.0.1', apply: true });
    client.events = []; client.notes = []; client.talent.clear();
    for (const app of client.apps.values()) {
        app.cv_snapshot = { source: 'legacy_mysql' }; app.stage = 'dang_xem_xet'; app.rating = null; app.match_score = null;
    }
    client.notes.push([client.apps.get(31).id, 101, 'HR has edited this projection']);
    client.apps.get(32).company_id = 99;
    client.apps.get(33).rating = 4;
    client.apps.get(34).stage = 'phong_van';
    client.apps.get(35).cv_snapshot.source = 'unknown_source';
    const preserved = new Map([31, 32, 33, 34, 35].map(id => [id, structuredClone(client.apps.get(id))]));
    const result = await seedWorkflow({ client, manifest: data, now, databaseHost: '127.0.0.1', apply: true });
    assert.equal(result.adopted, 7);
    assert.deepEqual(result.skippedConflict, [31, 32, 33, 34, 35]);
    for (const [id, expected] of preserved) assert.equal(snapshot(client.apps.get(id)), snapshot(expected));
    assert.equal(client.apps.get(30).cv_snapshot.demoSeedId, data.seedId);
});

test('any failed history write rolls back applications and all related fixture data', async () => {
    const client = new MemoryClient(); client.failEvents = true;
    await assert.rejects(seedWorkflow({ client, manifest: manifest(), now, databaseHost: '127.0.0.1', apply: true }), /Event write failed/);
    assert.equal(client.apps.size, 0); assert.equal(client.events.length, 0); assert.equal(client.notes.length, 0);
    assert.equal(client.talent.size, 0);
    assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('pristine adoption checks exact identity, import source, manual rating and history', () => {
    const app = buildWorkflowPlan(manifest(), { now }).applications[0];
    const existing = {
        job_id: app.jobId, candidate_id: app.candidateId, company_id: app.companyId,
        candidate_email: app.candidateEmail, stage: 'moi_ung_tuyen',
        cv_snapshot: { source: 'legacy_event' }, rating: null, match_score: null
    };
    assert.equal(canAdoptProjection(existing, app, false), true);
    assert.equal(canAdoptProjection(existing, app, true), false);
    assert.equal(canAdoptProjection({ ...existing, candidate_email: 'somebodyelse@jobfind.example' }, app, false), false);
    assert.equal(canAdoptProjection({ ...existing, match_score: 90 }, app, false), false);
    assert.equal(canAdoptProjection({ ...existing, cv_snapshot: { source: 'legacy_event', demoSeedId: 'other-seed' } }, app, false), false);
});
