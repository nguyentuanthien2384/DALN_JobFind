import assert from 'node:assert/strict';
import { assertEventPayload } from '../shared/eventContract.js';
import { DETAIL_FIELDS } from '../job-core-service/src/libs/jobEdit.js';

// Owned disposable DB and fixture-only trusted HTTP identity. Never starts a
// provider/relay, reads project .env or touches serving data/containers.
export const runLegacyRepostChecks = async ({ pool, check, core, managed, legacyReupHttp: repost, edit, counts, balance, waitForRowWait }) => {
    await pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
    const read = async id => { const r = await managed(id); assert.equal(r.status, 200); return r.body.data; };
    const events = async id => (await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ? ORDER BY id', [String(id)]))[0];
    const post = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const state = async id => (await pool.query('SELECT * FROM job_moderation_state WHERE jobId = ?', [id]))[0];
    const make = async (hot = 0, status = 'PS1') => {
        const r = await core(hot, 8); assert.equal(r.status, 201);
        await pool.query("UPDATE posts SET statusCode = ?, timeEnd = '1700000000000' WHERE id = ?", [status, r.id]);
        return read(r.id);
    };
    const before = async job => ({ post: await post(job.id), state: await state(job.id), events: await events(job.id), counts: await counts(), quota: await balance() });
    const unchanged = async (job, baseline) => assert.deepEqual(await before(job), baseline);
    const saved = async (job, baseline, id) => {
        assert.notEqual(id, job.id); const copy = await post(id), rows = await events(id);
        assert.equal(copy.userId, 7); assert.equal(copy.statusCode, 'PS3'); assert.equal(copy.isHot, job.isHot);
        assert.equal(copy.detailPostId, baseline.post.detailPostId); assert.ok(Number(copy.timeEnd) > Date.now());
        assert.equal(copy.timePost, null); assert.deepEqual(await state(id), []);
        assert.equal(rows.length, 1); const [event] = rows, payload = JSON.parse(event.payload);
        assert.equal(event.eventType, 'job.created'); assert.equal(event.aggregateType, 'legacy-job');
        assert.equal(event.publishedAt, null); assert.equal(event.attempts, 0); assert.equal(event.lockToken, null);
        assert.equal(assertEventPayload('job.created', payload, { aggregateId: event.aggregateId }), String(id));
        for (const field of ['id', 'userId', 'timeEnd', 'timePost', 'isHot', 'statusCode']) assert.deepEqual(payload.job[field], copy[field], field);
        for (const field of DETAIL_FIELDS) assert.deepEqual(payload.job[field], job[field], field);
        assert.equal(payload.job.companyId, 3); assert.notEqual(payload.job.name, 'Ignored body');
        assert.deepEqual(await post(job.id), baseline.post); assert.deepEqual(await state(job.id), baseline.state); assert.deepEqual(await events(job.id), baseline.events);
        assert.deepEqual(await counts(), baseline.counts.map((n, i) => n + ([0, 2].includes(i) ? 1 : 0)));
        assert.deepEqual(await balance(), baseline.quota.map((n, i) => n - (i === job.isHot ? 1 : 0)));
        return { copy, event, payload };
    };
    for (const status of ['PS1', 'PS2', 'PS3']) for (const hot of [0, 1]) {
        await check(`legacy repost ${status}/${hot} preserves source snapshot/fence and commits new actor/ID/event with one correct charge`, async () => {
            const job = await make(hot, status), baseline = await before(job), r = await repost(job);
            assert.equal(r.status, 200); assert.equal(r.body.errCode, 0, JSON.stringify(r)); await saved(job, baseline, r.body.postId);
        });
    }
    await check('repost response loss retains one charged copy/event; source revision alone is NOT HTTP idempotency', async () => {
        const job = await make(), baseline = await before(job);
        await assert.rejects(repost(job, { drop: true }), /fetch failed|socket|other side closed/i);
        const [[{ id }]] = await pool.query('SELECT MAX(id) AS id FROM posts'); const first = await saved(job, baseline, id);
        // Explicit demonstration on synthetic data: same source revision still
        // matches because repost never changes the source. UI must NOT retry.
        const after = await before(job), again = await repost(job);
        const second = await saved(job, after, again.body.postId);
        assert.notEqual(second.copy.id, first.copy.id); assert.notEqual(second.event.id, first.event.id);
    });
    for (const table of ['companies', 'posts', 'outbox_events']) {
        await check(`legacy repost ${table} failure rolls back copy, charge and event without modifying source`, async () => {
            const job = await make(), baseline = await before(job);
            await pool.query(`CREATE TRIGGER fail_repost AFTER ${table === 'companies' ? 'UPDATE' : 'INSERT'} ON ${table}
                FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic repost failure'`);
            try { const r = await repost(job); assert.equal(r.body.errCode, -1); assert.equal(r.body.postId, undefined); await unchanged(job, baseline); }
            finally { await pool.query('DROP TRIGGER fail_repost'); }
        });
    }
    for (const problem of ['missing', 'MyISAM']) {
        await check(`legacy repost with ${problem} outbox leaves source/quota/copies untouched`, async () => {
            const job = await make(), baseline = await before(job);
            await pool.query(problem === 'missing' ? 'RENAME TABLE outbox_events TO held_repost_outbox' : 'ALTER TABLE outbox_events ENGINE=MyISAM');
            try { assert.equal((await repost(job)).body.errCode, 2); }
            finally { await pool.query(problem === 'missing' ? 'RENAME TABLE held_repost_outbox TO outbox_events' : 'ALTER TABLE outbox_events ENGINE=InnoDB'); }
            await unchanged(job, baseline);
        });
    }
    await check('stale revision/invalid deadline/removed source cannot consume a repost slot', async () => {
        const job = await make(); await edit(job.id, { name: 'New source', expectedRevision: job.editRevision });
        const baseline = await before(job); assert.equal((await repost(job)).status, 409); await unchanged(job, baseline);
        for (const timeEnd of [0, -1, '2030-01-01', {}, null, Date.now() - 1]) assert.equal((await repost(await read(job.id), { timeEnd })).body.errCode, 1);
        await unchanged(job, baseline);
        await pool.query("UPDATE posts SET statusCode = 'PS4' WHERE id = ?", [job.id]);
        const removed = await before(job); assert.equal((await repost(job)).body.errCode, 2); await unchanged(job, removed);
    });
    for (const change of ['actor', 'owner', 'company', 'sourceOwner', 'sourceStatus']) {
        await check(`legacy repost rechecks ${change} after a lock wait even though controller precheck saw the old tenant/state`, async () => {
            const job = await make(), baseline = await before(job), blocker = await pool.getConnection(); let pending;
            try {
                await blocker.beginTransaction();
                if (['actor', 'owner'].includes(change)) await blocker.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [change === 'actor' ? 7 : 8]);
                else if (change === 'company') await blocker.query('SELECT id FROM companies WHERE id = 3 FOR UPDATE');
                else await blocker.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [job.id]);
                pending = repost(job); await waitForRowWait();
                if (['actor', 'owner'].includes(change)) await blocker.query('UPDATE users SET companyId = 4 WHERE id = ?', [change === 'actor' ? 7 : 8]);
                else if (change === 'company') await blocker.query("UPDATE companies SET statusCode = 'S2' WHERE id = 3");
                else if (change === 'sourceOwner') await blocker.query('UPDATE posts SET userId = 9 WHERE id = ?', [job.id]);
                else await blocker.query("UPDATE posts SET statusCode = 'PS4' WHERE id = ?", [job.id]);
                await blocker.commit(); const r = await pending;
                assert.equal(r.body.errCode, 2, JSON.stringify(r)); assert.deepEqual(await counts(), baseline.counts); assert.deepEqual(await balance(), baseline.quota);
                assert.deepEqual(await events(job.id), baseline.events); assert.deepEqual(await state(job.id), baseline.state);
            } finally {
                await blocker.rollback(); blocker.release(); await pending;
                await pool.query('UPDATE users SET companyId = 3 WHERE id IN (7,8)'); await pool.query("UPDATE companies SET statusCode = 'S1' WHERE id = 3");
            }
        });
    }
    await check('20 simultaneous guarded reposts cannot exceed three slots; each successful copy has one new stable event', async () => {
        const job = await make(); await pool.query('UPDATE companies SET allowPost = 3 WHERE id = 3'); const baseline = await before(job);
        const results = await Promise.all(Array.from({ length: 20 }, () => repost(job))), ok = results.filter(r => r.body.errCode === 0);
        assert.equal(ok.length, 3); assert.equal(results.filter(r => r.body.errCode === 2).length, 17);
        assert.deepEqual(await counts(), baseline.counts.map((n, i) => n + ([0, 2].includes(i) ? 3 : 0)));
        assert.deepEqual(await balance(), [0, baseline.quota[1]]); assert.deepEqual(await post(job.id), baseline.post);
        for (const r of ok) { const rows = await events(r.body.postId); assert.equal(rows.length, 1); assert.equal(rows[0].eventType, 'job.created'); }
    });
};
