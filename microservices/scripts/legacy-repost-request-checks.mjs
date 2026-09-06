import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Receives the owned disposable MySQL/HTTP fixture only; no serving data or providers.
export const runLegacyRepostRequestChecks = async ({ pool, check, core, managed, edit, legacyReupHttp, legacyCreateHttp, counts, balance, waitForRowWait }) => {
    const deadline = String(Date.now() + 86400000);
    const quota = (n = 30) => pool.query('UPDATE companies SET allowPost = ?, allowHotPost = ? WHERE id = 3', [n, n]);
    const read = async id => { const r = await managed(id); assert.equal(r.status, 200); return r.body.data; };
    const make = async (hot = 0) => {
        await quota(); const source = await core(hot, 8); assert.equal(source.status, 201);
        await pool.query("UPDATE posts SET statusCode = 'PS1', timeEnd = '1700000000000' WHERE id = ?", [source.id]);
        return read(source.id);
    };
    const send = (job, key, patch = {}) => legacyReupHttp(job, { key, timeEnd: deadline, ...patch });
    const keys = async () => (await pool.query('SELECT COUNT(*) AS n FROM job_request_keys'))[0][0].n;
    const snapshot = async () => ({ counts: await counts(), quota: await balance(), keys: await keys() });
    const events = async id => (await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ? ORDER BY id', [String(id)]))[0];
    const row = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const replay = (r, first) => { assert.equal(r.status, 200); assert.deepEqual(r.body, { ...first.body, replayed: true }); };
    for (const hot of [0, 1]) await check(`keyed legacy repost: 20 simultaneous requests spend the last ${hot ? 'hot' : 'normal'} slot once`, async () => {
        const job = await make(hot), original = await row(job.id), sourceEvents = await events(job.id), key = randomUUID();
        await quota(1); const before = await snapshot();
        const results = await Promise.all(Array.from({ length: 20 }, () => send(job, key)));
        assert.ok(results.every(r => r.status === 200 && r.body.errCode === 0), JSON.stringify(results));
        assert.equal(new Set(results.map(r => r.body.postId)).size, 1);
        assert.equal(results.filter(r => r.body.replayed === false).length, 1);
        assert.equal(results.filter(r => r.body.replayed === true).length, 19);
        const first = results.find(r => !r.body.replayed), copy = await row(first.body.postId);
        assert.notEqual(copy.id, job.id); assert.equal(first.body.sourcePostId, job.id); assert.equal(first.body.idempotencyKey, key);
        assert.equal(copy.userId, 7); assert.equal(copy.detailPostId, original.detailPostId); assert.equal(copy.statusCode, 'PS3');
        assert.deepEqual(await row(job.id), original); assert.deepEqual(await events(job.id), sourceEvents);
        assert.deepEqual(await counts(), before.counts.map((n, i) => n + ([0, 2].includes(i) ? 1 : 0)));
        assert.deepEqual(await balance(), hot ? [1, 0] : [0, 1]); assert.equal(await keys(), before.keys + 1);
        const [event] = await events(copy.id); assert.equal((await events(copy.id)).length, 1);
        assert.equal(event.eventType, 'job.created'); assert.equal(event.aggregateType, 'legacy-job'); assert.equal(event.publishedAt, null);
        assert.equal(JSON.parse(event.payload).job.id, copy.id);
        const [[ledger]] = await pool.query('SELECT * FROM job_request_keys WHERE userId = 7 AND requestKey = ?', [key]);
        assert.equal(ledger.operation, 'legacy-repost'); assert.equal(ledger.companyId, 3); assert.deepEqual(JSON.parse(ledger.responseJson), first.body);
    });
    await check('keyed repost recovers lost response with one copy, charge and immutable event', async () => {
        const job = await make(), key = randomUUID(); await quota(1); const before = await snapshot();
        await assert.rejects(send(job, key, { drop: true }), /fetch failed|socket|other side closed/i);
        const committed = await snapshot(), result = await send(job, key);
        assert.equal(result.body.replayed, true); assert.equal(result.body.sourcePostId, job.id);
        assert.deepEqual(committed.counts, before.counts.map((n, i) => n + ([0, 2].includes(i) ? 1 : 0)));
        const savedEvents = await events(result.body.postId); replay(await send(job, key), result);
        assert.deepEqual(await snapshot(), committed); assert.deepEqual(await events(result.body.postId), savedEvents);
    });
    await check('repost intent canonicalizes numeric values, ignores body overrides and rejects source/date/revision changes', async () => {
        const job = await make(), other = await make(), key = randomUUID(), first = await send(job, key), before = await snapshot();
        replay(await send(job, key, { postId: String(job.id), timeEnd: Number(deadline), name: 'Unsaved', userId: 999, companyId: 4, roleCode: 'ADMIN', isHot: 1 }), first);
        for (const patch of [{ postId: other.id }, { timeEnd: String(Number(deadline) + 1) }, { expectedRevision: 'jv1-' + '0'.repeat(64) }]) {
            assert.equal((await send(job, key, patch)).status, 409);
        }
        assert.deepEqual(await snapshot(), before);
    });
    await check('same-key different repost dates racing accept exactly one intent', async () => {
        const job = await make(), key = randomUUID(), before = await snapshot();
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => send(job, key, { timeEnd: String(Number(deadline) + i) })));
        assert.equal(results.filter(r => r.body.errCode === 0).length, 1); assert.equal(results.filter(r => r.status === 409).length, 11);
        assert.deepEqual(await counts(), before.counts.map((n, i) => n + ([0, 2].includes(i) ? 1 : 0)));
    });
    await check('repost/create legacy and Core reject cross-operation key reuse in both directions', async () => {
        const job = await make(), repostKey = randomUUID(), createKey = randomUUID(), coreKey = randomUUID();
        assert.equal((await send(job, repostKey)).body.errCode, 0);
        assert.equal((await legacyCreateHttp({ key: createKey, timeEnd: deadline })).body.errCode, 0);
        assert.equal((await core(0, 7, { 'idempotency-key': coreKey }, { timeEnd: deadline })).status, 201);
        const before = await snapshot();
        assert.equal((await send(job, createKey)).status, 409); assert.equal((await send(job, coreKey)).status, 409);
        assert.equal((await legacyCreateHttp({ key: repostKey, timeEnd: deadline })).status, 409);
        assert.equal((await core(0, 7, { 'idempotency-key': repostKey }, { timeEnd: deadline })).status, 409);
        assert.deepEqual(await snapshot(), before);
    });
    await check('source revision conflict rolls back the claimed key and permits the same key with freshly loaded revision', async () => {
        const job = await make(), key = randomUUID();
        assert.equal((await edit(job.id, { name: 'Changed source', expectedRevision: job.editRevision }, 8)).status, 200);
        const before = await snapshot(); assert.equal((await send(job, key)).status, 409); assert.deepEqual(await snapshot(), before);
        const refreshed = await read(job.id), result = await send(refreshed, key); assert.equal(result.body.errCode, 0); assert.equal(result.body.replayed, false);
        assert.equal(JSON.parse((await events(result.body.postId))[0].payload).job.name, 'Changed source');
    });
    await check('receipt lookup works after the submitted deadline; a fresh expired repost rolls back', async () => {
        const job = await make(), key = randomUUID(), timeEnd = String(Date.now() + 1200), first = await send(job, key, { timeEnd });
        assert.equal(first.body.errCode, 0); await delay(Math.max(0, Number(timeEnd) - Date.now() + 10));
        const before = await snapshot(); replay(await send(job, key, { timeEnd }), first);
        assert.notEqual((await send(job, randomUUID(), { timeEnd })).body.errCode, 0); assert.deepEqual(await snapshot(), before);
    });
    for (const change of ['edited', 'PS4', 'deleted', 'other-company']) await check(`repost receipt survives source ${change} without rerunning source preconditions or changing its copy`, async () => {
        const job = await make(), key = randomUUID(), first = await send(job, key), copy = await row(first.body.postId), savedEvents = await events(copy.id);
        if (change === 'edited') await edit(job.id, { name: 'Source changed later', expectedRevision: job.editRevision }, 8);
        if (change === 'PS4') await pool.query("UPDATE posts SET statusCode = 'PS4' WHERE id = ?", [job.id]);
        if (change === 'deleted') await pool.query('DELETE FROM posts WHERE id = ?', [job.id]);
        if (change === 'other-company') await pool.query('UPDATE posts SET userId = 99 WHERE id = ?', [job.id]);
        const before = await snapshot(); replay(await send(job, key), first);
        assert.deepEqual(await snapshot(), before); assert.deepEqual(await row(copy.id), copy); assert.deepEqual(await events(copy.id), savedEvents);
        // A NEW key still enforces current source access/status/revision.
        assert.notEqual((await send(job, randomUUID())).body.errCode, 0); assert.deepEqual(await snapshot(), before);
    });
    for (const change of ['PS4', 'deleted', 'reassigned', 'corrupt-receipt']) await check(`repost replay checks resulting copy ${change} without creating a replacement`, async () => {
        const job = await make(), key = randomUUID(), first = await send(job, key);
        if (change === 'PS4') await pool.query("UPDATE posts SET statusCode = 'PS4' WHERE id = ?", [first.body.postId]);
        if (change === 'deleted') await pool.query('DELETE FROM posts WHERE id = ?', [first.body.postId]);
        if (change === 'reassigned') await pool.query('UPDATE posts SET userId = 8 WHERE id = ?', [first.body.postId]);
        if (change === 'corrupt-receipt') await pool.query("UPDATE job_request_keys SET responseJson = '{}' WHERE userId = 7 AND requestKey = ?", [key]);
        const before = await snapshot(), r = await send(job, key);
        if (change === 'PS4') replay(r, first); else assert.equal(r.status, 409);
        assert.deepEqual(await snapshot(), before);
    });
    for (const field of ['statusCode', 'censorCode']) await check(`repost receipt rechecks actor company ${field}`, async () => {
        const job = await make(), key = randomUUID(), first = await send(job, key), before = await snapshot();
        await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S2' : 'CS2']);
        try { assert.equal((await send(job, key)).body.errCode, 2); assert.deepEqual(await snapshot(), before); }
        finally { await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S1' : 'CS1']); }
        replay(await send(job, key), first);
    });
    await check('repost receipt waits for actor membership lock then denies changed company without charging either company', async () => {
        const job = await make(), key = randomUUID(); await send(job, key); const before = await snapshot();
        const [[otherCompany]] = await pool.query('SELECT * FROM companies WHERE id = 4');
        const conn = await pool.getConnection(); let pending;
        try {
            await conn.beginTransaction(); await conn.query('SELECT id FROM users WHERE id = 7 FOR UPDATE');
            pending = send(job, key); await waitForRowWait();
            await conn.query('UPDATE users SET companyId = 4 WHERE id = 7'); await conn.commit();
            assert.equal((await pending).status, 403); assert.deepEqual(await snapshot(), before);
            assert.deepEqual((await pool.query('SELECT * FROM companies WHERE id = 4'))[0][0], otherCompany);
        } finally { await conn.rollback(); conn.release(); await pending; await pool.query('UPDATE users SET companyId = 3 WHERE id = 7'); }
    });
    for (const table of ['companies', 'posts', 'outbox_events', 'job_request_keys']) await check(`keyed repost ${table} failure rolls back claim/copy/quota/event then same key succeeds`, async () => {
        const job = await make(), key = randomUUID(), before = await snapshot(), original = await row(job.id);
        await pool.query(`CREATE TRIGGER fail_keyed_repost AFTER ${['companies', 'job_request_keys'].includes(table) ? 'UPDATE' : 'INSERT'} ON ${table}
            FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic keyed repost rollback'`);
        try { assert.equal((await send(job, key)).body.errCode, -1); assert.deepEqual(await snapshot(), before); assert.deepEqual(await row(job.id), original); }
        finally { await pool.query('DROP TRIGGER fail_keyed_repost'); }
        const r = await send(job, key); assert.equal(r.body.errCode, 0); assert.equal(r.body.replayed, false);
    });
    for (const table of ['job_request_keys', 'outbox_events']) for (const problem of ['missing', 'MyISAM']) await check(`keyed repost rejects ${problem} ${table} and retains no pending claim`, async () => {
        const job = await make(), before = await snapshot();
        await pool.query(problem === 'missing' ? `RENAME TABLE ${table} TO held_repost_request_table` : `ALTER TABLE ${table} ENGINE=MyISAM`);
        try { const r = await send(job, randomUUID()); assert.notEqual(r.body.errCode, 0); }
        finally { await pool.query(problem === 'missing' ? `RENAME TABLE held_repost_request_table TO ${table}` : `ALTER TABLE ${table} ENGINE=InnoDB`); }
        assert.deepEqual(await snapshot(), before);
    });
    await check('keyed repost requires a valid key/revision/deadline before claiming; case-sensitive distinct keys remain distinct intents', async () => {
        const job = await make(), before = await snapshot();
        for (const key of ['', 'bad key', 'x'.repeat(129)]) assert.equal((await send(job, key)).status, 400);
        for (const patch of [{ expectedRevision: undefined }, { expectedRevision: null }, { timeEnd: true }, { timeEnd: '2031-01-01' }, { postId: true }]) {
            assert.notEqual((await send(job, randomUUID(), patch)).body.errCode, 0);
        }
        assert.deepEqual(await snapshot(), before);
        const key = randomUUID(), a = await send(job, 'a-' + key), b = await send(job, 'A-' + key);
        assert.equal(a.body.errCode, 0); assert.equal(b.body.errCode, 0); assert.notEqual(a.body.postId, b.body.postId);
    });
};
