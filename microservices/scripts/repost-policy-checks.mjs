import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Only the caller's owned disposable MySQL and fixture HTTP identities are used.
// Exercise actual current reads, transactions and HTTP validation in both writers.
export const runRepostPolicyChecks = async ({ pool, check, core, managed, repost, edit, legacyReupHttp, counts, balance, waitForRowWait }) => {
    const future = () => String(Date.now() + 86400000);
    const quota = () => pool.query('UPDATE companies SET allowPost = 100, allowHotPost = 100 WHERE id = 3');
    const read = async id => { const r = await managed(id); assert.equal(r.status, 200); return r.body.data; };
    const make = async (hot = 0, status = 'PS1') => {
        await quota(); const r = await core(hot, 8); assert.equal(r.status, 201);
        await pool.query("UPDATE posts SET statusCode = ?, timeEnd = '1700000000000' WHERE id = ?", [status, r.id]);
        return read(r.id);
    };
    const state = async () => ({ counts: await counts(), quota: await balance(),
        keys: (await pool.query('SELECT COUNT(*) AS n FROM job_request_keys'))[0][0].n });
    const post = async id => (await pool.query('SELECT * FROM posts WHERE id = ?', [id]))[0][0];
    const events = async id => (await pool.query('SELECT * FROM outbox_events WHERE aggregateId = ? ORDER BY id', [String(id)]))[0];
    const writers = [
        { name: 'Core', keyed: true, send: (job, { key = randomUUID(), timeEnd = future(), role = 'COMPANY', ...patch } = {}) =>
            repost(job.id, key, timeEnd, 7, { 'x-user-role': role }, { expectedRevision: job.editRevision, ...patch }),
        id: r => r.id },
        ...[true, false].map(keyed => ({ name: keyed ? 'legacy keyed' : 'legacy unkeyed', keyed,
            send: (job, { key = randomUUID(), timeEnd = future(), role = 'COMPANY', ...patch } = {}) =>
                legacyReupHttp(job, { ...(keyed && { key }), timeEnd, actorRole: role, ...patch }), id: r => r.body.postId }))
    ];
    for (const writer of writers) {
        const { name, send, id } = writer;
        await check(`${name}: expired PS1/PS2/PS3 and COMPANY/EMPLOYER/ADMIN stay in the same company, charge the source bucket once`, async () => {
            for (const status of ['PS1', 'PS2', 'PS3']) for (const role of ['COMPANY', 'EMPLOYER', 'ADMIN']) for (const hot of [0, 1]) {
                const job = await make(hot, status), original = await post(job.id), sourceEvents = await events(job.id), before = await state();
                const r = await send(job, { role }); assert.equal(r.body.errCode, 0, JSON.stringify(r));
                const copy = await post(id(r)); assert.notEqual(copy.id, job.id); assert.equal(copy.userId, 7);
                assert.equal(copy.statusCode, 'PS3'); assert.equal(copy.isHot, hot);
                assert.deepEqual(await post(job.id), original); assert.deepEqual(await events(job.id), sourceEvents);
                assert.deepEqual(await balance(), before.quota.map((n, i) => n - (i === hot ? 1 : 0)));
                assert.equal((await state()).keys, before.keys + Number(writer.keyed));
                assert.deepEqual(await counts(), before.counts.map((n, i) => n + (name === 'Core' ? [1, 1, 2, 1] : [1, 0, 1, 0])[i]));
            }
        });
        await check(`${name}: active, malformed and unknown source states fail closed without a claim/copy/charge/event`, async () => {
            const job = await make();
            for (const timeEnd of [future(), null, '', 'bad', '1e3', ' 1700000000000 ', '0', '-1', '1700000000000.0', '8640000000000001']) {
                await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [timeEnd, job.id]);
                const before = await state(); assert.notEqual((await send(job)).body.errCode, 0); assert.deepEqual(await state(), before);
            }
            for (const status of ['PS4', 'PS0', '', null]) {
                await pool.query("UPDATE posts SET timeEnd = '1700000000000', statusCode = ? WHERE id = ?", [status, job.id]);
                const before = await state(); assert.notEqual((await send(job)).body.errCode, 0); assert.deepEqual(await state(), before);
            }
        });
        await check(`${name}: new deadlines must be canonical future milliseconds`, async () => {
            const job = await make(), before = await state();
            for (const timeEnd of ['1700000000000', '0', '-1', '2e12', ' 2000000000000 ', '2000000000000.0', '8640000000000001', true, null]) {
                assert.notEqual((await send(job, { timeEnd })).body.errCode, 0, String(timeEnd));
            }
            assert.deepEqual(await state(), before);
        });
        await check(`${name}: ADMIN cannot repost another company's source`, async () => {
            const job = await make(); await pool.query('UPDATE posts SET userId = 99 WHERE id = ?', [job.id]);
            // Refresh the revision so a stale revision cannot mask a permission bug.
            const adminRead = await managed(job.id, 7, { 'x-user-role': 'ADMIN' }); assert.equal(adminRead.status, 200);
            const before = await state(), other = (await pool.query('SELECT * FROM companies WHERE id = 4'))[0][0];
            assert.notEqual((await send(adminRead.body.data, { role: 'ADMIN' })).body.errCode, 0);
            assert.deepEqual(await state(), before); assert.deepEqual((await pool.query('SELECT * FROM companies WHERE id = 4'))[0][0], other);
        });
        await check(`${name}: ADMIN still needs an active approved company`, async () => {
            const job = await make(), before = await state();
            for (const field of ['statusCode', 'censorCode']) {
                await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S2' : 'CS2']);
                try { assert.notEqual((await send(job, { role: 'ADMIN' })).body.errCode, 0); assert.deepEqual(await state(), before); }
                finally { await pool.query(`UPDATE companies SET ${field} = ? WHERE id = 3`, [field === 'statusCode' ? 'S1' : 'CS1']); }
            }
        });
        await check(`${name}: changed source revision rolls back, then refreshed revision succeeds${writer.keyed ? ' with the same key' : ''}`, async () => {
            const job = await make(), key = randomUUID();
            assert.equal((await edit(job.id, { name: 'New source content', expectedRevision: job.editRevision }, 8)).status, 200);
            const before = await state(), rejected = await send(job, { key });
            assert.equal(rejected.status, 409); assert.equal(rejected.body.conflict, true); assert.deepEqual(await state(), before);
            const r = await send(await read(job.id), { key }); assert.equal(r.body.errCode, 0);
            const created = (await events(id(r))).find(e => e.eventType === 'job.created');
            assert.equal(JSON.parse(created.payload).job.name, 'New source content');
        });
        await check(`${name}: expiration is rechecked after waiting for the source lock${name === 'legacy keyed' ? '' : ' even without a revision'}`, async () => {
            const job = await make(), conn = await pool.getConnection(); let pending;
            try {
                await conn.beginTransaction(); await conn.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [job.id]);
                // Core's omitted revision remains compatible. Legacy keyed needs a revision.
                pending = send(job, writer.name === 'legacy keyed' ? {} : { expectedRevision: undefined });
                await waitForRowWait(); await conn.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [future(), job.id]); await conn.commit();
                const before = await state(); assert.notEqual((await pending).body.errCode, 0); assert.deepEqual(await state(), before);
            } finally { await conn.rollback(); conn.release(); await pending; }
        });
        await check(`${name}: source author's membership is rechecked under its user lock, including ADMIN`, async () => {
            const job = await make(), before = await state(), conn = await pool.getConnection(); let pending;
            try {
                await conn.beginTransaction(); await conn.query('SELECT id FROM users WHERE id = 8 FOR UPDATE');
                pending = send(job, { role: 'ADMIN' }); await waitForRowWait();
                await conn.query('UPDATE users SET companyId = 4 WHERE id = 8'); await conn.commit();
                assert.notEqual((await pending).body.errCode, 0); assert.deepEqual(await state(), before);
            } finally { await conn.rollback(); conn.release(); await pending; await pool.query('UPDATE users SET companyId = 3 WHERE id = 8'); }
        });
        await check(`${name}: a submitted deadline that expires while waiting for detail lock cannot charge or create`, async () => {
            const job = await make(), source = await post(job.id), before = await state(), conn = await pool.getConnection(); let pending;
            try {
                await conn.beginTransaction();
                // Management HTTP intentionally hides the internal detail pointer.
                const [[locked]] = await conn.query('SELECT id FROM detailposts WHERE id = ? FOR UPDATE', [source.detailPostId]);
                assert.equal(locked?.id, source.detailPostId);
                const timeEnd = String(Date.now() + 1500); pending = send(job, { timeEnd }); await waitForRowWait();
                await delay(Math.max(0, Number(timeEnd) - Date.now() + 10)); await conn.commit();
                assert.notEqual((await pending).body.errCode, 0); assert.deepEqual(await state(), before);
            } finally { await conn.rollback(); conn.release(); await pending; }
        });
        if (writer.keyed) await check(`${name}: original receipt survives extended or malformed source deadline and stale revision, with no second charge`, async () => {
            const job = await make(), key = randomUUID(), timeEnd = future(), first = await send(job, { key, timeEnd });
            assert.equal(first.body.errCode, 0); const before = await state(), copy = await post(id(first)), savedEvents = await events(id(first));
            for (const deadline of [future(), null]) {
                await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [deadline, job.id]);
                const again = await send(job, { key, timeEnd }); assert.equal(again.status, first.status);
                assert.deepEqual(again.body, name === 'Core' ? first.body : { ...first.body, replayed: true });
                assert.deepEqual(await state(), before); assert.deepEqual(await post(id(first)), copy); assert.deepEqual(await events(id(first)), savedEvents);
                assert.notEqual((await send(job)).body.errCode, 0); assert.deepEqual(await state(), before);
            }
        });
    }
    await check('Core: omission preserves the pre-2o request hash and original receipt; adding/changing revision under an accepted key conflicts', async () => {
        const job = await make(), key = randomUUID(), timeEnd = future(), first = await repost(job.id, key, timeEnd);
        assert.equal(first.status, 201); const before = await state();
        const [[receipt]] = await pool.query('SELECT requestHash FROM job_request_keys WHERE userId = 7 AND requestKey = ?', [key]);
        assert.equal(receipt.requestHash, createHash('sha256').update(JSON.stringify({ version: 1, operation: 'repost', input: { sourceId: job.id, timeEnd } })).digest('hex'));
        await pool.query('UPDATE posts SET timeEnd = ? WHERE id = ?', [future(), job.id]);
        assert.deepEqual((await repost(job.id, key, timeEnd)).body, first.body);
        assert.equal((await repost(job.id, key, timeEnd, 7, {}, { expectedRevision: job.editRevision })).status, 409);
        assert.deepEqual(await state(), before);
        const fresh = await make(), revisionKey = randomUUID();
        assert.equal((await repost(fresh.id, revisionKey, timeEnd, 7, {}, { expectedRevision: fresh.editRevision })).status, 201);
        const after = await state();
        for (const patch of [{}, { expectedRevision: 'jv1-' + '0'.repeat(64) }]) {
            assert.equal((await repost(fresh.id, revisionKey, timeEnd, 7, {}, patch)).status, 409);
        }
        assert.deepEqual(await state(), after);
    });
    await check('Core: 20 simultaneous revision-aware reposts with one key create one copy and one charge', async () => {
        const job = await make(), key = randomUUID(), timeEnd = future(), before = await state();
        const results = await Promise.all(Array.from({ length: 20 }, () => writers[0].send(job, { key, timeEnd })));
        assert.ok(results.every(r => r.status === 201), JSON.stringify(results)); assert.equal(new Set(results.map(r => r.id)).size, 1);
        assert.deepEqual(await counts(), before.counts.map((n, i) => n + [1, 1, 2, 1][i]));
        assert.deepEqual(await balance(), [before.quota[0] - 1, before.quota[1]]); assert.equal((await state()).keys, before.keys + 1);
    });
};
