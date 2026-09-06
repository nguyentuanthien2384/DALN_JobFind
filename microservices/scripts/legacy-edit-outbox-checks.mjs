import assert from 'node:assert/strict';
import { DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';
import { assertEventPayload } from '../shared/eventContract.js';

// Only the owned disposable MySQL and loopback real-controller fixture. No
// broker/worker/provider; pending events are deliberately not marked delivered.
export const runLegacyEditOutboxChecks = async ({ pool, check, core, managed, legacyEditHttp, counts, balance, waitForRowWait }) => {
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
    const read = async id => { const r = await managed(id); assert.equal(r.status, 200); return r.body.data; };
    const make = async (status = 'PS3') => {
        const r = await core(1, 8); assert.equal(r.status, 201);
        await pool.query('UPDATE posts SET statusCode = ? WHERE id = ?', [status, r.id]);
        return read(r.id);
    };
    const row = async (table, key, id) => (await pool.query(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]))[0][0];
    const updates = async id => (await pool.query("SELECT * FROM outbox_events WHERE aggregateId = ? AND aggregateType = 'legacy-job' ORDER BY id", [String(id)]))[0];
    const snapshot = async job => {
        const post = await row('posts', 'id', job.id);
        return { post, detail: await row('detailposts', 'id', post.detailPostId),
            state: await row('job_moderation_state', 'jobId', job.id), counts: await counts(), quota: await balance(),
            events: await updates(job.id), notes: (await pool.query('SELECT * FROM notes WHERE postId = ?', [job.id]))[0] };
    };
    const oneEdit = async (job, before, result) => {
        assert.equal(result.status, 200); assert.equal(result.body.errCode, 0, JSON.stringify(result)); assert.equal(result.body.changed, true);
        const current = await read(job.id), after = await snapshot(current);
        assert.equal(result.body.editRevision, current.editRevision); assert.notEqual(current.editRevision, job.editRevision);
        assert.equal(current.statusCode, 'PS3'); assert.equal(after.state.state, 'cancelled');
        for (const field of ['userId', 'timePost', 'timeEnd', 'isHot', 'createdAt']) assert.deepEqual(after.post[field], before.post[field], field);
        assert.deepEqual(await row('detailposts', 'id', before.post.detailPostId), before.detail);
        assert.deepEqual(after.counts, before.counts.map((n, i) => n + ([1, 2].includes(i) ? 1 : 0)));
        assert.deepEqual(after.quota, before.quota); assert.deepEqual(after.notes, before.notes);
        const fresh = after.events.filter(event => !before.events.some(old => old.id === event.id)); assert.equal(fresh.length, 1);
        const [event] = fresh, payload = JSON.parse(event.payload);
        assert.equal(event.eventType, 'job.updated'); assert.equal(event.aggregateId, String(job.id));
        assert.equal(event.publishedAt, null); assert.equal(event.attempts, 0); assert.equal(event.lockToken, null);
        assert.equal(assertEventPayload('job.updated', payload, { aggregateId: event.aggregateId }), String(job.id));
        for (const field of [...DETAIL_FIELDS, 'id', 'userId', 'statusCode', 'timeEnd', 'isHot']) assert.deepEqual(payload.job[field], current[field], field);
        assert.equal(payload.job.companyId, 3); assert.equal(payload.job.companyStatusCode, 'S1'); assert.equal(payload.job.companyCensorCode, 'CS1');
        assert.equal(payload.job.editRevision, undefined); assert.equal(payload.job.email, undefined);
        return current;
    };

    for (const status of ['PS1', 'PS2', 'PS3']) {
        await check(`legacy ${status} HTTP edit atomically saves one PS3 snapshot/event; preserves quota/owner and ignores spoofed body identity`, async () => {
            const job = await make(status), before = await snapshot(job);
            const current = await oneEdit(job, before, await legacyEditHttp(job, { name: `Edited from ${status}` }));
            const saved = await snapshot(current), noop = await legacyEditHttp(current);
            assert.equal(noop.body.changed, false); assert.equal(noop.body.editRevision, current.editRevision);
            assert.deepEqual(await snapshot(current), saved);
        });
    }
    await check('legacy metadata-only edit emits one update and no new AI/notification intent', async () => {
        const job = await make('PS1'), before = await snapshot(job);
        const current = await oneEdit(job, before, await legacyEditHttp(job, { amount: 9, categoryJobCode: 'OTHER' }));
        assert.equal(current.name, job.name); assert.equal(current.descriptionHTML, job.descriptionHTML);
        assert.equal(current.amount, 9); assert.equal(current.categoryJobCode, 'OTHER');
    });
    await check('legacy HTTP response lost after commit retains one event; stale retry conflicts and fresh no-op never duplicates', async () => {
        const job = await make('PS1'), before = await snapshot(job);
        await assert.rejects(legacyEditHttp(job, { name: 'Committed without response', drop: true }), /fetch failed|socket|other side closed/i);
        const current = await read(job.id);
        await oneEdit(job, before, { status: 200, body: { errCode: 0, changed: true, editRevision: current.editRevision } });
        const saved = await snapshot(current);
        assert.equal((await legacyEditHttp(job, { name: current.name })).status, 409);
        assert.equal((await legacyEditHttp(current)).body.changed, false);
        assert.deepEqual(await snapshot(current), saved);
    });
    await check('real outbox INSERT failure rolls back legacy HTTP edit and fence; original revision remains usable', async () => {
        const job = await make('PS1'), before = await snapshot(job);
        await pool.query("CREATE TRIGGER fail_legacy_edit_event BEFORE INSERT ON outbox_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic legacy edit outbox failure'");
        try {
            const result = await legacyEditHttp(job, { name: 'Must roll back' });
            assert.equal(result.status, 200); assert.equal(result.body.errCode, -1); // unchanged legacy error envelope
            assert.equal(JSON.stringify(result.body).includes('synthetic'), false);
            assert.deepEqual(await snapshot(job), before); assert.equal((await read(job.id)).editRevision, job.editRevision);
        } finally { await pool.query('DROP TRIGGER fail_legacy_edit_event'); }
        await oneEdit(job, before, await legacyEditHttp(job, { name: 'Saved after recovery' }));
    });
    for (const unavailable of ['missing', 'MyISAM']) {
        await check(`legacy edit fails closed for ${unavailable} outbox; true no-op remains safe without outbox`, async () => {
            const job = await make(), before = await snapshot(job);
            await pool.query(unavailable === 'missing' ? 'RENAME TABLE outbox_events TO held_legacy_edit_outbox' : 'ALTER TABLE outbox_events ENGINE=MyISAM');
            try {
                const result = await legacyEditHttp(job, { amount: 6 });
                assert.equal(result.status, 200); assert.equal(result.body.errCode, 2); assert.match(result.body.errMessage, /đồng bộ/);
                assert.equal((await legacyEditHttp(job)).body.changed, false);
            } finally {
                await pool.query(unavailable === 'missing' ? 'RENAME TABLE held_legacy_edit_outbox TO outbox_events' : 'ALTER TABLE outbox_events ENGINE=InnoDB');
            }
            assert.deepEqual(await snapshot(job), before);
        });
    }
    await check('legacy edit event and response revision use the actual inserted DB row, not the submitted/create-input snapshot', async () => {
        const job = await make(), before = await snapshot(job);
        await pool.query("CREATE TRIGGER normalize_legacy_detail BEFORE INSERT ON detailposts FOR EACH ROW SET NEW.name = 'Normalized by disposable DB'");
        try {
            const current = await oneEdit(job, before, await legacyEditHttp(job, { name: 'Submitted title' }));
            assert.equal(current.name, 'Normalized by disposable DB');
        } finally { await pool.query('DROP TRIGGER normalize_legacy_detail'); }
    });
    for (const blockCompany of [false, true]) {
        await check(`legacy edit rereads company after lock wait: ${blockCompany ? 'revoked approval rejects without an event' : 'event uses fresh company context'}`, async () => {
            const job = await make(), before = await snapshot(job);
            const original = await row('companies', 'id', 3), blocker = await pool.getConnection(); let pending;
            try {
                await blocker.beginTransaction(); await blocker.query('SELECT id FROM companies WHERE id = 3 FOR UPDATE');
                pending = legacyEditHttp(job, { name: 'Waited edit' });
                await waitForRowWait(); assert.deepEqual(await counts(), before.counts);
                await blocker.query('UPDATE companies SET name = ?, thumbnail = ?, statusCode = ? WHERE id = 3', ['Fresh locked company', 'fresh-logo', blockCompany ? 'S2' : 'S1']);
                await blocker.commit(); const result = await pending;
                if (blockCompany) { assert.equal(result.body.errCode, 2); assert.deepEqual(await snapshot(job), before); }
                else {
                    await oneEdit(job, before, result);
                    const { job: payload } = JSON.parse((await updates(job.id))[0].payload);
                    assert.equal(payload.companyName, 'Fresh locked company'); assert.equal(payload.companyLogo, 'fresh-logo');
                }
            } finally {
                await blocker.rollback(); blocker.release(); await pending;
                await pool.query('UPDATE companies SET name = ?, thumbnail = ?, statusCode = ? WHERE id = 3', [original.name, original.thumbnail, original.statusCode]);
            }
        });
    }
    await check('20 concurrent identical old-client edits without revisions collapse to one fork/event under row locks', async () => {
        const job = await make(), before = await snapshot(job);
        const results = await Promise.all(Array.from({ length: 20 }, () => legacyEditHttp(job, { name: 'Same simultaneous edit', expectedRevision: undefined })));
        assert.equal(results.every(r => r.status === 200 && r.body.errCode === 0), true, JSON.stringify(results));
        assert.equal(results.filter(r => r.body.changed).length, 1);
        await oneEdit(job, before, results.find(r => r.body.changed));
    });
};
